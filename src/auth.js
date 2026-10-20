// Telegram login: interactive (clack) flows plus non-interactive send-code / verify for scripts.
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import qrcode from 'qrcode-terminal';
import { Api } from 'telegram';
import { DATA_DIR, ENV_FILE, SESSION_FILE, credentials, saveEnv, createClient, readSession, writeSession } from './client.js';

const PENDING_FILE = path.join(DATA_DIR, '.login-pending.json');

export class Cancelled extends Error {}

// Unwrap a clack answer, aborting the whole flow on Ctrl+C / Esc.
export function answer(value) {
  if (p.isCancel(value)) throw new Cancelled('Cancelled');
  return value;
}

const fullName = (me) => [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Unknown';
const describe = (me) => `${fullName(me)}${me.username ? ` (@${me.username})` : ''}`;

export async function currentUser() {
  if (!readSession()) return null;
  const client = createClient();
  try {
    await client.connect();
    return (await client.checkAuthorization()) ? await client.getMe() : null;
  } finally {
    await client.destroy().catch(() => {});
  }
}

async function ensureApiCredentials() {
  if (process.env.API_ID && process.env.API_HASH) return;
  p.note(
    `Create an app at ${pc.cyan('https://my.telegram.org')} → API development tools\n` +
    '(or reuse API_ID / API_HASH from another project of yours).',
    'Telegram API credentials',
  );
  const apiId = answer(await p.text({
    message: 'API_ID',
    validate: (v) => (/^\d{3,}$/.test(v?.trim() ?? '') ? undefined : 'API_ID is a number'),
  }));
  const apiHash = answer(await p.password({
    message: 'API_HASH',
    validate: (v) => (/^[a-f0-9]{32}$/i.test(v?.trim() ?? '') ? undefined : 'API_HASH is 32 hex characters'),
  }));
  saveEnv({ API_ID: apiId.trim(), API_HASH: apiHash.trim() });
  p.log.success(`Saved to ${ENV_FILE}`);
}

const askPassword = async (hint) => process.env.TG_PASSWORD || answer(await p.password({
  message: `Two-step verification password${hint ? pc.dim(` (hint: ${hint})`) : ''}`,
  validate: (v) => (v ? undefined : 'Required'),
}));

// GramJS calls onError for every failed step; returning true aborts, false retries the step.
const onError = async (err) => {
  if (err instanceof Cancelled) return true;
  p.log.error(err.errorMessage || err.message);
  return false;
};

async function loginWithCode(client) {
  const phone = answer(await p.text({
    message: 'Phone number',
    placeholder: '+381601234567',
    initialValue: process.env.PHONE_NUMBER || '',
    validate: (v) => (/^\+?\d{7,15}$/.test((v ?? '').replace(/[\s()-]/g, '')) ? undefined : 'International format, e.g. +381601234567'),
  })).replace(/[\s()-]/g, '');
  saveEnv({ PHONE_NUMBER: phone });
  await client.start({
    phoneNumber: async () => phone,
    phoneCode: async (viaApp) => answer(await p.text({
      message: `Login code ${pc.dim(viaApp ? '(sent to your Telegram app)' : '(sent via SMS)')}`,
      validate: (v) => (/^\d{4,8}$/.test(v?.trim() ?? '') ? undefined : 'Digits only'),
    })).trim(),
    password: askPassword,
    onError,
  });
}

async function loginWithQr(client) {
  let drawn = 0;
  const clear = () => { if (drawn) process.stdout.write(`\x1b[${drawn}A\x1b[0J`); drawn = 0; };
  await client.signInUserWithQrCode(credentials(), {
    qrCode: async ({ token, expires }) => {
      clear();
      qrcode.generate(`tg://login?token=${token.toString('base64url')}`, { small: true }, (qr) => {
        const secs = Math.max(0, expires - Math.floor(Date.now() / 1000));
        const text = `${pc.gray('│')}\n${pc.cyan('◆')}  Scan with Telegram on your phone: ${pc.bold('Settings → Devices → Link Desktop Device')}\n` +
          `${qr.replace(/^/gm, `${pc.gray('│')}  `)}\n${pc.gray('│')}  ${pc.dim(`refreshes in ~${secs}s · Ctrl+C to cancel`)}\n`;
        process.stdout.write(text);
        drawn = text.split('\n').length - 1;
      });
    },
    password: async (hint) => { clear(); return askPassword(hint); },
    onError,
  });
  clear();
}

async function finish(client) {
  writeSession(client.session.save());
  fs.rmSync(PENDING_FILE, { force: true });
  const me = await client.getMe();
  await client.destroy().catch(() => {});
  return me;
}

// Full interactive login. Returns the logged-in user.
export async function loginInteractive({ method, force = false } = {}) {
  await ensureApiCredentials();

  const s = p.spinner();
  s.start('Checking existing session');
  const existing = await currentUser().catch(() => null);
  s.stop(existing ? `Logged in as ${pc.cyan(describe(existing))}` : 'No active session on this machine');
  if (existing && !force) {
    const again = answer(await p.confirm({ message: 'Log in again (replace this session)?', initialValue: false }));
    if (!again) return existing;
  }

  method ??= answer(await p.select({
    message: 'How do you want to log in?',
    options: [
      { value: 'qr', label: 'QR code', hint: 'scan from Telegram on your phone, no SMS' },
      { value: 'code', label: 'Phone number + code', hint: 'code arrives in Telegram / SMS' },
    ],
  }));

  const client = createClient('');
  s.start('Connecting to Telegram');
  await client.connect();
  s.stop('Connected');
  try {
    await (method === 'qr' ? loginWithQr(client) : loginWithCode(client));
  } catch (err) {
    await client.destroy().catch(() => {});
    if (err.message === 'AUTH_USER_CANCEL') throw new Cancelled('Cancelled');
    throw err;
  }
  const me = await finish(client);
  p.log.success(`Logged in as ${pc.cyan(describe(me))}. Session saved to ${pc.dim(SESSION_FILE)}`);
  p.log.info(pc.dim(`This machine appears in Telegram → Settings → Devices as "${process.env.TG_DEVICE_NAME || 'telegramcp (hostname)'}".`));
  return me;
}

export async function logout() {
  if (readSession()) {
    const client = createClient();
    await client.connect();
    await client.invoke(new Api.auth.LogOut()).catch(() => {});
    await client.destroy().catch(() => {});
  }
  fs.rmSync(SESSION_FILE, { force: true });
}

// ---- non-interactive two-step flow (scripts / agents) ----

export async function sendCode() {
  const { apiId, apiHash } = credentials();
  const phone = process.env.PHONE_NUMBER;
  if (!phone) throw new Error(`PHONE_NUMBER missing in ${ENV_FILE}`);
  const client = createClient('');
  await client.connect();
  const { phoneCodeHash, isCodeViaApp } = await client.sendCode({ apiId, apiHash }, phone);
  fs.writeFileSync(PENDING_FILE, JSON.stringify({ session: client.session.save(), phoneCodeHash }), { mode: 0o600 });
  await client.destroy();
  return isCodeViaApp ? 'Telegram app' : 'SMS';
}

export async function verify(code, password) {
  const { apiId, apiHash } = credentials();
  if (!fs.existsSync(PENDING_FILE)) throw new Error('No pending login. Run `telegramcp send-code` first.');
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
      await client.destroy();
      throw new Error('2FA password required: telegramcp verify <code> <password>');
    }
    await client.signInWithPassword({ apiId, apiHash }, { password: async () => password, onError: async (e) => { throw e; } });
  }
  return describe(await finish(client));
}
