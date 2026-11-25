// Which messengers the server exposes. Telegram is always on; WhatsApp and Viber read the desktop apps on
// macOS, so they turn on by themselves when the app is installed. TELEGRAMCP_MESSENGERS limits the set,
// e.g. "telegram,whatsapp".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const installed = (app) => ['/Applications', path.join(home, 'Applications')].some((d) => fs.existsSync(path.join(d, app)));

// node:sqlite (used for WhatsApp's database) needs Node 22.13+ without flags.
function hasSqlite() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

export function messengers() {
  const wanted = (process.env.TELEGRAMCP_MESSENGERS || 'telegram,whatsapp,viber').split(',').map((s) => s.trim().toLowerCase());
  const mac = process.platform === 'darwin';
  return {
    telegram: true,
    whatsapp: wanted.includes('whatsapp') && mac && installed('WhatsApp.app') && hasSqlite(),
    viber: wanted.includes('viber') && mac && installed('Viber.app'),
  };
}

// Human-readable reasons a messenger is off, for `telegramcp status`.
export function messengerNotes() {
  const m = messengers();
  const wanted = (process.env.TELEGRAMCP_MESSENGERS || 'telegram,whatsapp,viber').split(',').map((s) => s.trim().toLowerCase());
  const why = (name, app) => {
    if (!wanted.includes(name)) return 'turned off (TELEGRAMCP_MESSENGERS)';
    if (process.platform !== 'darwin') return 'macOS only';
    if (!installed(app)) return `${app} not installed`;
    if (name === 'whatsapp' && !hasSqlite()) return `needs Node 22.13+ (this is ${process.versions.node})`;
    return 'off';
  };
  return {
    whatsapp: m.whatsapp ? 'on (read-only, from WhatsApp Desktop)' : why('whatsapp', 'WhatsApp.app'),
    viber: m.viber ? 'on (Viber Desktop, in the background)' : why('viber', 'Viber.app'),
  };
}
