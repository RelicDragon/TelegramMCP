// Read-only access to the WhatsApp Desktop (macOS) Core Data stores.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

export const WA_DIR = process.env.TELEGRAMCP_WHATSAPP_DIR ||
  path.join(os.homedir(), 'Library', 'Group Containers', 'group.net.whatsapp.WhatsApp.shared');
export const MEDIA_DIR = path.join(WA_DIR, 'Message');

// Core Data timestamps are seconds since 2001-01-01 UTC.
const EPOCH = 978307200;
export const toUnix = (cd) => (cd == null ? null : cd + EPOCH);
export const toCoreData = (unix) => (unix == null ? null : unix - EPOCH);

const dbs = new Map();
function open(name, { optional = false } = {}) {
  if (dbs.has(name)) return dbs.get(name);
  const file = path.join(WA_DIR, name);
  try {
    fs.accessSync(file, fs.constants.R_OK);
  } catch (err) {
    if (optional) return null;
    if (err.code === 'ENOENT') throw new Error(`WhatsApp database not found at ${file}. Is WhatsApp Desktop installed and logged in?`);
    throw new Error(`Cannot read ${file} (${err.code}). macOS may be blocking access to WhatsApp's data: allow the app that runs this server ` +
      '(Terminal, Claude, …) under System Settings → Privacy & Security → Full Disk Access / App Management.');
  }
  // readOnly never writes WhatsApp's data; the timeout waits out WhatsApp's own brief write locks.
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  db.exec('PRAGMA query_only = 1');
  db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));
  dbs.set(name, db);
  return db;
}

export const chatDb = () => open('ChatStorage.sqlite');
const contactsDb = () => open('ContactsV2.sqlite', { optional: true });

export function closeAll() {
  for (const db of dbs.values()) try { db.close(); } catch { /* ignore */ }
  dbs.clear();
}

// ---------- own account ----------

const PREFS = path.join(WA_DIR, 'Library', 'Preferences', 'group.net.whatsapp.WhatsApp.shared.plist');
function pref(key) {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', PREFS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

let meCache;
export function me() {
  meCache ||= { jid: pref('OwnJabberID'), name: pref('FullUserName') };
  return meCache;
}

// ---------- names ----------

const NAMES_TTL_MS = 60_000;
let names = { at: 0 };

// Address book + push names, keyed by every JID form we know (phone JID and LID).
function nameMaps() {
  if (Date.now() - names.at < NAMES_TTL_MS) return names;
  const book = new Map();   // jid -> { name, phone, jids: [..] }
  const contacts = [];
  const cdb = contactsDb();
  if (cdb) {
    const rows = cdb.prepare(`select ZFULLNAME fullname, ZGIVENNAME given, ZBUSINESSNAME biz, ZWHATSAPPID wjid, ZLID lid,
      ZPHONENUMBER phone, ZABOUTTEXT about, ZUSERNAME username from ZWAADDRESSBOOKCONTACT`).all();
    for (const r of rows) {
      const c = { name: r.fullname || r.given || r.biz || null, phone: r.phone, about: r.about, username: r.username, jids: [r.wjid, r.lid].filter(Boolean) };
      if (!c.jids.length) continue;
      contacts.push(c);
      for (const j of c.jids) book.set(j, c);
    }
  }
  const push = new Map();
  for (const r of chatDb().prepare('select ZJID jid, ZPUSHNAME name from ZWAPROFILEPUSHNAME where ZPUSHNAME is not null').all()) push.set(r.jid, r.name);
  names = { at: Date.now(), book, push, contacts };
  return names;
}

export const contacts = () => nameMaps().contacts;
export const contactOf = (jid) => (jid ? nameMaps().book.get(jid) : undefined);

export function phoneOf(jid) {
  if (!jid) return null;
  const c = contactOf(jid);
  if (c?.phone) return c.phone.startsWith('+') ? c.phone : `+${c.phone}`;
  const m = jid.match(/^(\d+)@s\.whatsapp\.net$/);
  return m ? `+${m[1]}` : null;
}

// Every JID the same person is known under (phone JID ↔ LID).
export function aliases(jid) {
  const c = contactOf(jid);
  return c ? c.jids : [jid];
}

// Best display name: address book → given fallback (e.g. group member/partner name) → ~push name → phone → jid.
export function nameOf(jid, fallback) {
  if (!jid) return fallback || 'Unknown';
  if (me().jid && jid === me().jid) return 'Me';
  const { book, push } = nameMaps();
  const p = push.get(jid);
  return clean(book.get(jid)?.name || fallback || (p ? `~${p}` : null) || phoneOf(jid) || jid);
}

// WhatsApp wraps phone-number names in bidi marks (U+202A … U+202C); drop them.
export const clean = (s) => (s == null ? s : String(s).replace(/[‎‏‪-‮⁦-⁩]/g, '').trim());

// ---------- tiny protobuf reader (only what we need from ZWAMEDIAITEM.ZMETADATA) ----------

export function pbFields(buf) {
  const out = new Map();
  if (!buf) return out;
  const b = Buffer.from(buf);
  let i = 0;
  const varint = () => {
    let r = 0, s = 0;
    for (;;) {
      if (i >= b.length) throw new Error('eof');
      const x = b[i++];
      r += (x & 0x7f) * 2 ** s;
      s += 7;
      if (!(x & 0x80)) return r;
    }
  };
  try {
    while (i < b.length) {
      const key = varint();
      const field = Math.floor(key / 8), wt = key % 8;
      if (wt === 0) out.set(field, varint());
      else if (wt === 2) { const len = varint(); out.set(field, b.subarray(i, i + len)); i += len; }
      else if (wt === 1) i += 8;
      else if (wt === 5) i += 4;
      else break;
    }
  } catch { /* truncated/unknown: keep what we parsed */ }
  return out;
}

// Quoted reply → stanza id of the quoted message (field 5) and its author (field 6).
export function quoted(meta) {
  const f = pbFields(meta);
  const sid = f.get(5), author = f.get(6);
  return Buffer.isBuffer(sid) ? { stanzaId: sid.toString('utf8'), author: Buffer.isBuffer(author) ? author.toString('utf8') : null } : null;
}
