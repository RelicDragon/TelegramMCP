// Registry of MCP clients ("agents") this server can be registered in, with the config
// location and entry shape each one expects. Paths and shapes follow neon-solutions/add-mcp.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as jsonc from 'jsonc-parser';
import YAML from 'yaml';
import { ROOT, readState, writeState } from './client.js';

export const SERVER_NAME = 'telegram';

const home = os.homedir();
const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
const appSupport = process.platform === 'win32'
  ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : xdgConfig;
const vscodeUser = path.join(appSupport, 'Code', 'User');
const zedDir = path.join(appSupport, process.platform === 'linux' ? 'zed' : 'Zed');
const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
const copilotHome = process.env.COPILOT_HOME || path.join(home, '.copilot');
const gooseConfig = process.platform === 'win32'
  ? path.join(appSupport, 'Block', 'goose', 'config', 'config.yaml')
  : path.join(xdgConfig, 'goose', 'config.yaml');

// The command every client launches. Absolute node path: GUI apps often don't inherit nvm's PATH.
export const serverCommand = () => ({ command: process.execPath, args: [path.join(ROOT, 'src', 'server.js')] });

const standard = ({ command, args }) => ({ command, args });

const firstExisting = (...files) => files.find((f) => fs.existsSync(f)) ?? files[0];

function hasClaudeCli() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export const agents = {
  'claude-code': {
    name: 'Claude Code',
    global: path.join(home, '.claude.json'),
    project: '.mcp.json',
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(home, '.claude')),
    entry: (c) => ({ type: 'stdio', ...standard(c) }),
    // Global scope goes through the CLI when available, since Claude Code rewrites ~/.claude.json constantly.
    cli: {
      available: hasClaudeCli,
      add: (entry) => {
        try { execFileSync('claude', ['mcp', 'remove', '-s', 'user', SERVER_NAME], { stdio: 'ignore' }); } catch {}
        execFileSync('claude', ['mcp', 'add-json', '-s', 'user', SERVER_NAME, JSON.stringify(entry)], { stdio: 'ignore' });
      },
      remove: () => execFileSync('claude', ['mcp', 'remove', '-s', 'user', SERVER_NAME], { stdio: 'ignore' }),
    },
  },
  'claude-desktop': {
    name: 'Claude Desktop',
    global: path.join(appSupport, 'Claude', 'claude_desktop_config.json'),
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(appSupport, 'Claude')),
    entry: standard,
  },
  codex: {
    name: 'Codex',
    global: path.join(codexHome, 'config.toml'),
    project: '.codex/config.toml',
    key: 'mcp_servers',
    format: 'toml',
    detect: () => fs.existsSync(codexHome),
    entry: standard,
  },
  cursor: {
    name: 'Cursor',
    global: path.join(home, '.cursor', 'mcp.json'),
    project: '.cursor/mcp.json',
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(home, '.cursor')),
    entry: standard,
  },
  vscode: {
    name: 'VS Code (Copilot Chat)',
    global: path.join(vscodeUser, 'mcp.json'),
    project: '.vscode/mcp.json',
    key: 'servers',
    format: 'json',
    detect: () => fs.existsSync(vscodeUser),
    entry: (c) => ({ type: 'stdio', ...standard(c) }),
  },
  'github-copilot-cli': {
    name: 'GitHub Copilot CLI',
    global: path.join(copilotHome, 'mcp-config.json'),
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(copilotHome),
    entry: (c) => ({ type: 'stdio', ...standard(c), tools: ['*'] }),
  },
  'gemini-cli': {
    name: 'Gemini CLI',
    global: path.join(home, '.gemini', 'settings.json'),
    project: '.gemini/settings.json',
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(home, '.gemini')),
    entry: standard,
  },
  windsurf: {
    name: 'Windsurf',
    global: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(home, '.codeium', 'windsurf')),
    entry: standard,
  },
  antigravity: {
    name: 'Antigravity',
    global: path.join(home, '.gemini', 'config', 'mcp_config.json'),
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(home, '.gemini', 'config')),
    entry: standard,
  },
  zed: {
    name: 'Zed',
    global: path.join(zedDir, 'settings.json'),
    project: '.zed/settings.json',
    key: 'context_servers',
    format: 'json',
    detect: () => fs.existsSync(zedDir),
    entry: (c) => ({ source: 'custom', ...standard(c), env: {} }),
  },
  opencode: {
    name: 'OpenCode',
    global: firstExisting(path.join(xdgConfig, 'opencode', 'opencode.jsonc'), path.join(xdgConfig, 'opencode', 'opencode.json')),
    project: 'opencode.json',
    key: 'mcp',
    format: 'json',
    detect: () => fs.existsSync(path.join(xdgConfig, 'opencode')),
    entry: ({ command, args }) => ({ type: 'local', command: [command, ...args], enabled: true }),
  },
  goose: {
    name: 'Goose',
    global: gooseConfig,
    key: 'extensions',
    format: 'yaml',
    detect: () => fs.existsSync(path.dirname(gooseConfig)),
    entry: ({ command, args }) => ({ name: SERVER_NAME, description: 'Telegram account', cmd: command, args, enabled: true, envs: {}, type: 'stdio', timeout: 300 }),
  },
  cline: {
    name: 'Cline (VS Code)',
    global: path.join(vscodeUser, 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(vscodeUser, 'globalStorage', 'saoudrizwan.claude-dev')),
    entry: (c) => ({ ...standard(c), disabled: false }),
  },
  'kiro-cli': {
    name: 'Kiro',
    global: path.join(home, '.kiro', 'settings', 'mcp.json'),
    project: '.kiro/settings/mcp.json',
    key: 'mcpServers',
    format: 'json',
    detect: () => fs.existsSync(path.join(home, '.kiro')),
    entry: standard,
  },
};

export const aliases = {
  claude: 'claude-code',
  desktop: 'claude-desktop',
  code: 'vscode',
  copilot: 'github-copilot-cli',
  gemini: 'gemini-cli',
  kiro: 'kiro-cli',
};

export function resolveAgentId(id) {
  const key = id.toLowerCase();
  return agents[key] ? key : aliases[key];
}

export const supportsScope = (id, scope) => scope === 'global' || Boolean(agents[id].project);

export function configPath(id, scope, cwd) {
  const a = agents[id];
  return scope === 'project' ? path.join(cwd, a.project) : a.global;
}

export const shortPath = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);

// ---------- format adapters ----------

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

const json = {
  has(text, key) {
    return Boolean(jsonc.parse(text || '{}')?.[key]?.[SERVER_NAME]);
  },
  set(text, key, entry) {
    const src = text?.trim() ? text : '{}\n';
    return jsonc.applyEdits(src, jsonc.modify(src, [key, SERVER_NAME], entry, FORMAT));
  },
  remove(text, key) {
    if (!text?.trim()) return text;
    return jsonc.applyEdits(text, jsonc.modify(text, [key, SERVER_NAME], undefined, FORMAT));
  },
};

// Line-based TOML edit so the rest of the user's config (and its comments) stays untouched.
const tomlHeader = (key) => new RegExp(`^\\s*\\[\\s*${key}\\.(?:${SERVER_NAME}|"${SERVER_NAME}")\\s*(?:\\]|\\.)`);
const toml = {
  has(text, key) {
    return (text || '').split('\n').some((l) => tomlHeader(key).test(l));
  },
  remove(text, key) {
    const out = [];
    let skipping = false;
    for (const line of (text || '').split('\n')) {
      if (/^\s*\[/.test(line)) skipping = tomlHeader(key).test(line);
      if (!skipping) out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  },
  set(text, key, entry) {
    const rest = toml.remove(text, key).trimEnd();
    const value = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : JSON.stringify(v));
    const body = Object.entries(entry).map(([k, v]) => `${k} = ${value(v)}`).join('\n');
    return `${rest ? `${rest}\n\n` : ''}[${key}.${SERVER_NAME}]\n${body}\n`;
  },
};

const yaml = {
  has(text, key) {
    return Boolean(YAML.parse(text || '')?.[key]?.[SERVER_NAME]);
  },
  set(text, key, entry) {
    const doc = YAML.parseDocument(text || '');
    if (!doc.contents) doc.contents = doc.createNode({});
    doc.setIn([key, SERVER_NAME], doc.createNode(entry));
    return String(doc);
  },
  remove(text, key) {
    const doc = YAML.parseDocument(text || '');
    doc.deleteIn([key, SERVER_NAME]);
    return String(doc);
  },
};

const formats = { json, toml, yaml };
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

// ---------- operations ----------

// Every registration is remembered (agent, scope, project dir) so `refresh` can rewrite paths later.
const sameTarget = (a, b) => a.agent === b.agent && a.scope === b.scope && (a.scope === 'global' || a.cwd === b.cwd);

export function registrations() {
  return readState().registrations ?? [];
}

function remember(target, add) {
  const rest = registrations().filter((r) => !sameTarget(r, target));
  writeState({ registrations: add ? [...rest, target] : rest });
}

export function isRegistered(id, scope, cwd) {
  const a = agents[id];
  if (!supportsScope(id, scope)) return false;
  try {
    return formats[a.format].has(read(configPath(id, scope, cwd)), a.key);
  } catch {
    return false;
  }
}

export function register(id, scope, cwd) {
  const a = agents[id];
  const entry = a.entry(serverCommand());
  if (scope === 'global' && a.cli?.available()) {
    a.cli.add(entry);
    remember({ agent: id, scope }, true);
    return `${shortPath(a.global)} (via claude CLI)`;
  }
  const file = configPath(id, scope, cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = read(file);
  if (before) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, formats[a.format].set(before, a.key, entry));
  remember({ agent: id, scope, ...(scope === 'project' && { cwd }) }, true);
  return shortPath(file);
}

export function unregister(id, scope, cwd) {
  const a = agents[id];
  if (scope === 'global' && a.cli?.available()) {
    try { a.cli.remove(); } catch {}
    remember({ agent: id, scope }, false);
    return shortPath(a.global);
  }
  const file = configPath(id, scope, cwd);
  const before = read(file);
  if (before) fs.writeFileSync(file, formats[a.format].remove(before, a.key));
  remember({ agent: id, scope, cwd }, false);
  return shortPath(file);
}

// Rewrite every known registration with the current node binary + install path.
// Also picks up global registrations made before state tracking existed.
export function refreshAll() {
  const targets = [...registrations()];
  for (const id of Object.keys(agents)) {
    if (!targets.some((t) => t.agent === id && t.scope === 'global') && isRegistered(id, 'global')) targets.push({ agent: id, scope: 'global' });
  }
  return targets.filter((t) => agents[t.agent]).map((t) => {
    try {
      if (t.scope === 'project' && !isRegistered(t.agent, 'project', t.cwd)) {
        remember(t, false);
        return { ...t, status: 'gone' };
      }
      return { ...t, status: 'ok', file: register(t.agent, t.scope, t.cwd) };
    } catch (err) {
      return { ...t, status: 'error', error: err.message };
    }
  });
}
