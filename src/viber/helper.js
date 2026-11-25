// Wrapper around the native viber-ax helper plus parsing of Viber's window into chats / messages.
// Background-only by construction: the helper has no click, key or activate commands, and refuses
// UI changes while Viber is the frontmost app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, DATA_DIR } from '../client.js';

// The helper lives in telegramcp.app so macOS shows its permissions as "telegramcp" (see native/viber-ax.swift).
const APP = 'telegramcp.app';
const EXE = path.join('Contents', 'MacOS', 'viber-ax');
const BUNDLED = path.join(ROOT, 'bin', APP, EXE);
const SOURCE = path.join(ROOT, 'native', 'viber-ax.swift');
const BUILT_APP = path.join(DATA_DIR, APP);
const BUILT = path.join(BUILT_APP, EXE);

export class ViberError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

let helper;
// Prefer the prebuilt, signed universal app; fall back to building one from the bundled source with swiftc.
export function helperPath() {
  if (helper) return helper;
  const runs = (bin) => fs.existsSync(bin) && spawnSync(bin, ['permissions'], { timeout: 15_000 }).status === 0;
  if (runs(BUNDLED)) return (helper = BUNDLED);
  if (runs(BUILT) && fs.statSync(BUILT).mtimeMs >= fs.statSync(SOURCE).mtimeMs) return (helper = BUILT);
  buildApp();
  return (helper = BUILT);
}

// The telegramcp.app bundle that holds the helper (what System Settings lists).
export const helperApp = () => path.dirname(path.dirname(path.dirname(helperPath())));

// Ad-hoc signed, so macOS asks for the permissions again after each rebuild; the npm package ships a signed one.
function buildApp() {
  const fail = (res) => new ViberError('The viber-ax helper is missing and could not be built ' +
    `(${(res.stderr || res.error?.message || '').trim().split('\n')[0]}). ` +
    'Install Xcode Command Line Tools (`xcode-select --install`) or reinstall telegramcp.', 'no_helper');
  fs.rmSync(BUILT_APP, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(BUILT), { recursive: true });
  fs.mkdirSync(path.join(BUILT_APP, 'Contents', 'Resources'), { recursive: true });
  const res = spawnSync('swiftc', ['-O', '-o', BUILT, SOURCE], { encoding: 'utf8', timeout: 300_000 });
  if (res.status !== 0) throw fail(res);
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plist = fs.readFileSync(path.join(ROOT, 'native', 'Info.plist'), 'utf8').replaceAll('__VERSION__', version);
  fs.writeFileSync(path.join(BUILT_APP, 'Contents', 'Info.plist'), plist);
  fs.copyFileSync(path.join(ROOT, 'native', 'AppIcon.icns'), path.join(BUILT_APP, 'Contents', 'Resources', 'AppIcon.icns'));
  const sign = spawnSync('codesign', ['--force', '--sign', '-', BUILT_APP], { encoding: 'utf8', timeout: 60_000 });
  if (sign.status !== 0) throw fail(sign);
}

export function ax(args, { input = '', timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new ViberError('Viber did not respond in time.', 'timeout')); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      let json;
      try { json = JSON.parse(out.trim().split('\n').pop() || '{}'); } catch {
        return reject(new ViberError(`viber-ax returned no data${err ? `: ${err.trim()}` : ''}`, 'bad_output'));
      }
      if (json.error) return reject(new ViberError(json.error, json.code));
      resolve(json);
    });
    child.stdin.end(input);
  });
}

// ---------- layout ----------

const lastSeg = (id) => (id || '').split('.').pop() || '';
const inside = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
const center = (e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });

// Finds the chat list, the conversation pane and its parts from the accessibility tree.
export function layout(tree) {
  const els = tree.elements;
  const win = tree.window;
  const conv = els.find((e) => e.role === 'AXGroup' && /^StackView/.test(lastSeg(e.id)) && /SplitView/.test(e.id)) || null;
  const listBar = els.find((e) => e.role === 'AXScrollBar' && /ApplicationWindowContentControl\.ScrollBar/.test(e.id || ''));
  const feedBar = els.find((e) => e.role === 'AXScrollBar' && /StackView[^.]*\.ScrollBar/.test(e.id || ''));
  const composer = els.find((e) => /StackView[^.]*\.QQuickTextEdit/.test(e.id || '') && !/AIPanel/.test(e.id));
  const search = els.find((e) => /SearchItem[^.]*\.TextFieldItem/.test(e.id || ''));
  const listRight = conv ? conv.x : win.x + win.w;
  const list = { x: win.x, y: listBar ? listBar.y : win.y + 200, w: listRight - win.x, h: listBar ? listBar.h : win.h - 200 };
  let feed = null;
  if (conv) {
    // Without a scroll bar (short chat) skip the header and the banner under it.
    const top = feedBar ? feedBar.y : conv.y + 130;
    const bottom = feedBar ? feedBar.y + feedBar.h : composer ? composer.y - 10 : conv.y + conv.h;
    feed = { x: conv.x, y: top, w: conv.w, h: bottom - top };
  }
  return { win, conv, list, listBar, feed, feedBar, composer, search };
}

// ---------- chat list ----------

const isCount = (s) => /^(\d{1,4}|99\+)$/.test(s.trim());
// A row's time/date stamp ("00:58", "Yesterday", "01.07.2026", "Вчера"); single glyphs are icons, not stamps.
const isStamp = (s) => !isCount(s) && /[\p{L}\p{N}]{2,}/u.test(s) && s.trim().length <= 16;
// Order lines top-to-bottom, treating lines within 6pt as the same visual line (left to right).
const reading = (a, b) => (Math.abs(a.y - b.y) < 6 ? a.x - b.x : a.y - b.y);

// Rows of the visible chat list, recognized from the window image.
export function parseChatList(ocr, lay) {
  const { list } = lay;
  const textLeft = list.x + 60; // avatars occupy the first ~60pt
  const rightCol = list.x + list.w - 90;
  const lines = ocr.lines.filter((l) => l.y >= list.y - 4 && l.y + l.h <= list.y + list.h + 4 && l.x >= textLeft && l.x + l.w <= list.x + list.w);
  const right = lines.filter((l) => l.x >= rightCol).sort((a, b) => a.y - b.y);
  const left = lines.filter((l) => l.x < rightCol).sort((a, b) => a.y - b.y);
  const anchors = right.filter((l) => isStamp(l.text));
  const rows = anchors.map((a, i) => ({ top: a.y - 8, bottom: anchors[i + 1] ? anchors[i + 1].y - 8 : list.y + list.h, time: a.text, lines: [], unread: null }));
  for (const l of left) {
    const r = rows.find((row) => l.y >= row.top && l.y < row.bottom);
    if (r) r.lines.push(l);
  }
  for (const r of rows) r.lines = r.lines.sort(reading).map((l) => l.text);
  for (const c of right.filter((l) => isCount(l.text))) {
    const r = rows.find((row) => c.y >= row.top && c.y < row.bottom);
    if (r) r.unread = c.text;
  }
  return rows.filter((r) => r.lines.length).map((r) => ({
    title: r.lines[0],
    preview: r.lines.slice(1).join(' ').replace(/^\W{0,2}\s*0?\s*Draft:/, 'Draft:'),
    time: r.time,
    unread: r.unread,
  }));
}

// Search results have section headers and contact rows without times; group lines by vertical gaps.
export function parseListBlocks(ocr, lay) {
  const { list } = lay;
  const lines = ocr.lines
    .filter((l) => l.y >= lay.win.y + 90 && l.y + l.h <= list.y + list.h + 4 && l.x >= list.x + 8 && l.x + l.w <= list.x + list.w)
    .sort((a, b) => a.y - b.y);
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    if (cur && l.y - cur.bottom < 10 && l.x > list.x + 40 === cur.indented) {
      cur.parts.push(l);
      cur.bottom = l.y + l.h;
    } else {
      cur = { parts: [l], bottom: l.y + l.h, indented: l.x > list.x + 40 };
      blocks.push(cur);
    }
  }
  return blocks.map((b) => b.parts.sort((a, c) => a.y - c.y || a.x - c.x).map((p) => p.text).join(' · '));
}

// ---------- open conversation ----------

export function header(ocr, lay) {
  if (!lay.conv) return null;
  const c = lay.conv;
  const band = ocr.lines.filter((l) => l.x >= c.x && l.x + l.w <= c.x + c.w - 140 && l.y >= c.y && l.y <= c.y + 60).sort((a, b) => a.y - b.y);
  if (!band.length) return null;
  const title = band.reduce((a, b) => (b.h > a.h ? b : a));
  return { title: title.text, subtitle: band.filter((l) => l !== title).map((l) => l.text).join(' ') || null };
}

const UI_NOISE = /^(Polish message|Suggest Replies|Get summary|Remix image|Got it|New messages)$/i;

// Visible conversation as ordered items: exact message text from accessibility, plus the other text
// on screen (sender names, times, date separators, media labels) from the window image.
export function transcript(tree, ocr, lay) {
  const { feed } = lay;
  if (!feed) return [];
  const side = (e) => {
    const left = e.x - feed.x, right = feed.x + feed.w - 14 - (e.x + e.w);
    if (!e.exact && Math.abs(left - right) < feed.w * 0.1 && e.w < feed.w * 0.8) return 'center';
    return right < left ? 'out' : 'in';
  };
  const bubbles = tree.elements.filter((e) => e.role === 'AXTextField' && /TextEditItem/.test(e.id || '') && /StackView/.test(e.id || '') &&
    !/AIPanel/.test(e.id) && e !== lay.composer && typeof e.value === 'string' && e.value.trim() && inside(center(e), feed));
  const items = bubbles.map((e) => ({ y: e.y, side: side({ ...e, exact: true }), text: e.value, exact: true }));
  if (ocr) {
    for (const l of ocr.lines) {
      const c = center(l);
      if (!inside(c, feed) || l.x + l.w > feed.x + feed.w - 12) continue;
      if (bubbles.some((b) => inside(c, b, 4))) continue;
      if (UI_NOISE.test(l.text.trim()) || l.text.trim().length < 1) continue;
      items.push({ y: l.y, side: side(l), text: l.text, exact: false });
    }
  }
  return items.sort((a, b) => a.y - b.y);
}

export function screenshotFile() {
  return path.join(os.tmpdir(), `telegramcp-viber-${process.pid}-${Date.now()}.png`);
}

// What to tell the user when a permission is missing (from `viber-ax permissions` / `status`), or null.
export function permissionHelp(s) {
  const missing = [!s.accessibility && 'Accessibility', !s.screen_recording && 'Screen & System Audio Recording'].filter(Boolean);
  if (!missing.length) return null;
  const c = s.charged_to ?? { self: true };
  const target = c.self ? '"telegramcp"' : `"${c.name}" (${c.path}, the app running telegramcp)`;
  return [
    `macOS permissions missing: ${missing.join(', ')}.`,
    `The user turns on ${target} in System Settings → Privacy & Security → ${missing.join(' and → ')}.`,
    'If telegramcp isn\'t listed there, they run `telegramcp permissions` in Terminal: it adds telegramcp and opens the right page.',
  ].join('\n');
}
