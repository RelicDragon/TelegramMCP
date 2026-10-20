import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT, '.env');
dotenv.config({ path: ENV_FILE, quiet: true });

export const SESSION_FILE = process.env.TG_SESSION_FILE || path.join(ROOT, 'session.txt');

export function credentials() {
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  if (!apiId || !apiHash) throw new Error(`API_ID / API_HASH missing. Run \`npm run login\` (or fill ${ENV_FILE}).`);
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
