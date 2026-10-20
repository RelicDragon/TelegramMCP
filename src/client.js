import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Credentials and session live outside the install dir so updates / reinstalls never wipe them.
export const DATA_DIR = process.env.TELEGRAM_MCP_HOME || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'telegram-mcp')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'telegram-mcp'));
export const ENV_FILE = path.join(DATA_DIR, '.env');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// One-time migration from the old layout (.env / session.txt inside the checkout).
for (const name of ['.env', 'session.txt']) {
  const legacy = path.join(ROOT, name);
  const target = path.join(DATA_DIR, name);
  if (fs.existsSync(legacy) && !fs.existsSync(target)) fs.copyFileSync(legacy, target);
}

dotenv.config({ path: ENV_FILE, quiet: true });

export const SESSION_FILE = process.env.TG_SESSION_FILE || path.join(DATA_DIR, 'session.txt');

export function credentials() {
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  if (!apiId || !apiHash) throw new Error(`API_ID / API_HASH missing. Run \`telegramcp login\` (or fill ${ENV_FILE}).`);
  return { apiId, apiHash };
}

// Upsert KEY=value lines into .env (created with 0600 if absent).
export function saveEnv(values) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, line) : `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`;
    process.env[key] = String(value);
  }
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
}

// TG_SESSION (env) wins over the session file, for deployments that inject secrets via env.
export function readSession(file = SESSION_FILE) {
  if (process.env.TG_SESSION) return process.env.TG_SESSION.trim();
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
}

export function writeSession(value, file = SESSION_FILE) {
  fs.writeFileSync(file, value, { mode: 0o600 });
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(patch) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2) + '\n');
}

// GramJS logs to stdout by default, which would corrupt the MCP stdio stream.
export function createClient(session = readSession()) {
  const { apiId, apiHash } = credentials();
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
    baseLogger: new Logger(LogLevel.ERROR),
    deviceModel: process.env.TG_DEVICE_NAME || `Telegram MCP (${os.hostname()})`,
    appVersion: '1.0.0',
  });
}
