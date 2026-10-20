#!/usr/bin/env node
// Interactive (any machine, fresh clone):
//   npm run login            -> asks for missing API_ID/API_HASH/phone, sends a code, asks code + 2FA
//   npm run login -- --qr    -> scan a QR code from Telegram on your phone instead of typing a code
// Non-interactive (scripts/agents):
//   node src/login.js send-code
//   node src/login.js verify <code> [2fa-password]
//   node src/login.js status
//   node src/login.js logout
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Api } from 'telegram';
import qrcode from 'qrcode-terminal';
import { ROOT, SESSION_FILE, credentials, saveEnv, createClient, readSession, writeSession } from './client.js';

const PENDING_FILE = path.join(ROOT, '.login-pending.json');

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : s.replace(/[^\r\n]/g, '*'));
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); }));
}

async function ensureConfig({ needPhone }) {
  if (!process.env.API_ID || !process.env.API_HASH) {
    console.log('Telegram API credentials are needed (https://my.telegram.org → API development tools).');
    saveEnv({ API_ID: await ask('API_ID: '), API_HASH: await ask('API_HASH: ') });
  }
  if (needPhone && !process.env.PHONE_NUMBER) {
    saveEnv({ PHONE_NUMBER: await ask('Phone number (international format, e.g. +381...): ') });
  }
  credentials();
}

async function finish(client) {
  writeSession(client.session.save());
  fs.rmSync(PENDING_FILE, { force: true });
  const me = await client.getMe();
  console.log(`Logged in as ${[me.firstName, me.lastName].filter(Boolean).join(' ')} (@${me.username ?? '-'}, id ${me.id}).`);
  console.log(`Session saved to ${SESSION_FILE}`);
  await client.disconnect();
}

const passwordPrompt = (hint) => process.env.TG_PASSWORD || ask(`2FA password${hint ? ` (hint: ${hint})` : ''}: `, { hidden: true });

// ---- non-interactive two-step flow ----

async function sendCode() {
  const { apiId, apiHash } = credentials();
  const phone = process.env.PHONE_NUMBER;
  if (!phone) throw new Error('PHONE_NUMBER missing in .env');
  const client = createClient('');
  await client.connect();
  const { phoneCodeHash, isCodeViaApp } = await client.sendCode({ apiId, apiHash }, phone);
  fs.writeFileSync(PENDING_FILE, JSON.stringify({ session: client.session.save(), phoneCodeHash }), { mode: 0o600 });
  await client.disconnect();
  console.log(`Login code sent ${isCodeViaApp ? 'to your Telegram app' : 'via SMS'}.`);
}

async function verify(code, password) {
  const { apiId, apiHash } = credentials();
  if (!code) throw new Error('Usage: node src/login.js verify <code> [2fa-password]');
  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  const client = createClient(pending.session);
  await client.connect();
  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber: process.env.PHONE_NUMBER, phoneCodeHash: pending.phoneCodeHash, phoneCode: String(code) }));
  } catch (err) {
    if (err.errorMessage !== 'SESSION_PASSWORD_NEEDED') throw err;
    password ||= process.env.TG_PASSWORD;
    if (!password) {
      // Keep the pending state so verify can be re-run with the password.
      await client.disconnect();
      console.error('2FA password required: re-run `node src/login.js verify <code> <password>`');
      process.exit(2);
    }
    await client.signInWithPassword({ apiId, apiHash }, { password: async () => password, onError: async (e) => { throw e; } });
  }
  await finish(client);
}

// ---- interactive flows ----

async function interactiveCode() {
  await ensureConfig({ needPhone: true });
  const client = createClient('');
  await client.start({
    phoneNumber: async () => process.env.PHONE_NUMBER,
    phoneCode: async (viaApp) => ask(`Code (sent ${viaApp ? 'to your Telegram app' : 'via SMS'}): `),
    password: passwordPrompt,
    onError: async (err) => { console.error(err.errorMessage || err.message); return false; },
  });
  await finish(client);
}

async function interactiveQr() {
  await ensureConfig({ needPhone: false });
  const client = createClient('');
  await client.connect();
  await client.signInUserWithQrCode(credentials(), {
    qrCode: async ({ token }) => {
      console.clear();
      console.log('Telegram on your phone → Settings → Devices → Link Desktop Device, then scan:\n');
      qrcode.generate(`tg://login?token=${token.toString('base64url')}`, { small: true });
      console.log('(the code refreshes automatically every ~30s)');
    },
    password: passwordPrompt,
    onError: async (err) => { console.error(err.errorMessage || err.message); return true; },
  });
  await finish(client);
}

async function status() {
  if (!readSession()) return console.log('No session on this machine. Run `npm run login`.');
  const client = createClient();
  await client.connect();
  if (await client.checkAuthorization()) {
    const me = await client.getMe();
    console.log(`Authorized as ${me.firstName ?? ''} (@${me.username ?? '-'}) on ${os.hostname()}.`);
  } else {
    console.log('Session is NOT authorized (revoked or expired). Run `npm run login`.');
  }
  await client.disconnect();
}

async function logout() {
  if (readSession()) {
    const client = createClient();
    await client.connect();
    await client.invoke(new Api.auth.LogOut()).catch(() => {});
    await client.disconnect();
  }
  fs.rmSync(SESSION_FILE, { force: true });
  console.log('Logged out and removed local session.');
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  'send-code': sendCode,
  verify: () => verify(args[0], args[1]),
  status,
  logout,
  '--qr': interactiveQr,
  qr: interactiveQr,
};
const run = commands[cmd] ?? interactiveCode;
run().then(() => process.exit(0), (err) => { console.error(err.errorMessage || err.message || err); process.exit(1); });
