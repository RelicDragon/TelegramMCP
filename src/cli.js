#!/usr/bin/env node
// telegramcp — installer / manager CLI. With no arguments and a piped stdin it runs the MCP server,
// so MCP clients can launch `telegramcp` directly; in a terminal it opens an interactive menu.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ROOT, DATA_DIR, readState, writeState, readSession } from './client.js';
import {
  agents, resolveAgentId, supportsScope, configPath, shortPath, isRegistered,
  register, unregister, registrations, refreshAll, serverCommand,
} from './agents.js';
import { Cancelled, answer, loginInteractive, currentUser, logout, sendCode, verify } from './auth.js';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const INSTALL_SPEC = process.env.TELEGRAMCP_SPEC || pkg.config?.installSpec || pkg.name;
const CWD = process.env.INIT_CWD || process.cwd(); // npm scripts chdir to the package; INIT_CWD is where the user ran it
const isGitCheckout = fs.existsSync(path.join(ROOT, '.git'));
const isNpxCache = ROOT.split(path.sep).includes('_npx');
// Fallback install location when npm's global prefix isn't writable (e.g. /usr without sudo).
const USER_PREFIX = process.env.TELEGRAMCP_PREFIX || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'telegramcp')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'telegramcp'));
const isUserInstall = ROOT === path.join(USER_PREFIX, 'node_modules', pkg.name);

const HELP = `${pc.bold('telegramcp')} ${pc.dim(`v${pkg.version}`)} — Telegram account MCP server

${pc.bold('Usage')}
  telegramcp                         interactive menu (in a terminal) / MCP server (when piped)
  telegramcp setup                   guided setup: login + register in your AI clients
  telegramcp login [--qr|--code] [--force]
  telegramcp logout                  revoke this machine's session
  telegramcp status                  login + where the server is registered
  telegramcp register [agent...]     interactive picker, or register directly in the given agents
        --all                          every detected agent
        --scope global|project         project = config in the current directory (default global)
        -y, --yes                      skip confirmation
  telegramcp unregister [agent...] [--all] [--scope ...] [-y]
  telegramcp list                    all supported agents, detection and registration state
  telegramcp refresh                 rewrite registered paths (after moving the install or changing Node)
  telegramcp update                  update to the latest version, then refresh
  telegramcp send-code | verify <code> [2fa]   non-interactive login
  telegramcp serve                   run the MCP server on stdio

${pc.bold('Agents')}  ${Object.keys(agents).join(', ')}
${pc.dim('aliases: claude, desktop, code, copilot, gemini, kiro')}

${pc.bold('Data')}  ${shortPath(DATA_DIR)} ${pc.dim('(.env, session.txt, state.json)')}`;

// ---------- helpers ----------

function parseAgents(names) {
  const ids = names.flatMap((n) => n.split(',')).filter(Boolean);
  const bad = ids.filter((n) => !resolveAgentId(n));
  if (bad.length) throw new Error(`Unknown agent(s): ${bad.join(', ')}. Run \`telegramcp list\`.`);
  return [...new Set(ids.map(resolveAgentId))];
}

const detectedAgents = () => Object.keys(agents).filter((id) => agents[id].detect());

function applyChanges({ add = [], remove = [], scope }) {
  const s = p.spinner();
  for (const id of add) {
    const effective = supportsScope(id, scope) ? scope : 'global';
    s.start(`Registering in ${agents[id].name}`);
    try {
      const where = register(id, effective, CWD);
      s.stop(`${pc.green('✓')} ${agents[id].name} ${pc.dim(`→ ${where}`)}`);
    } catch (err) {
      s.error(`${agents[id].name}: ${err.message}`);
    }
  }
  for (const id of remove) {
    s.start(`Removing from ${agents[id].name}`);
    try {
      const where = unregister(id, supportsScope(id, scope) ? scope : 'global', CWD);
      s.stop(`${pc.yellow('−')} ${agents[id].name} ${pc.dim(`(${where})`)}`);
    } catch (err) {
      s.error(`${agents[id].name}: ${err.message}`);
    }
  }
}

async function chooseScope(ids, preset) {
  if (preset) return preset;
  if (!ids.some((id) => agents[id].project)) return 'global';
  return answer(await p.select({
    message: 'Scope',
    options: [
      { value: 'global', label: 'Global', hint: 'available in every project' },
      { value: 'project', label: 'This project only', hint: `${shortPath(CWD)} — agents without project config fall back to global` },
    ],
  }));
}

// Interactive picker: one multiselect where checked = registered. Checking adds, unchecking removes.
async function registerInteractive({ scope: presetScope } = {}) {
  const detected = new Set(detectedAgents());
  const state = readState();
  const last = (state.lastSelected ?? []).filter((id) => agents[id]);

  const mode = answer(await p.select({
    message: 'Where should telegramcp be available?',
    options: [
      ...(last.length ? [{ value: 'last', label: 'Same as last time', hint: last.map((id) => agents[id].name).join(', ') }] : []),
      { value: 'detected', label: 'All detected agents', hint: [...detected].map((id) => agents[id].name).join(', ') || 'none found' },
      { value: 'pick', label: 'Choose agents…' },
    ],
  }));

  const scope = await chooseScope(Object.keys(agents), presetScope);
  const registeredNow = Object.keys(agents).filter((id) => isRegistered(id, supportsScope(id, scope) ? scope : 'global', CWD));

  let selected;
  if (mode === 'last') selected = last;
  else if (mode === 'detected') selected = [...new Set([...detected, ...registeredNow])];
  else {
    const order = Object.keys(agents).sort((a, b) => Number(detected.has(b)) - Number(detected.has(a)));
    selected = answer(await p.multiselect({
      message: `Select agents ${pc.dim('(space toggles, enter confirms; unchecking a registered agent removes it)')}`,
      options: order.map((id) => {
        const target = configPath(id, supportsScope(id, scope) ? scope : 'global', CWD);
        const tags = [registeredNow.includes(id) ? pc.green('registered') : null, detected.has(id) ? null : 'not detected'].filter(Boolean);
        return { value: id, label: agents[id].name, hint: [shortPath(target), ...tags].join(' · ') };
      }),
      initialValues: registeredNow.length ? registeredNow : [...detected],
      required: false,
      maxItems: 16,
    }));
  }

  const add = selected;
  const remove = mode === 'pick' ? registeredNow.filter((id) => !selected.includes(id)) : [];
  if (!add.length && !remove.length) return p.log.warn('Nothing selected.');

  const { command, args } = serverCommand();
  const lines = [
    ...add.map((id) => `${pc.green('+')} ${agents[id].name.padEnd(24)} ${pc.dim(shortPath(configPath(id, supportsScope(id, scope) ? scope : 'global', CWD)))}`),
    ...remove.map((id) => `${pc.red('−')} ${agents[id].name.padEnd(24)} ${pc.dim('remove')}`),
    '',
    pc.dim(`command: ${command} ${args.join(' ')}`),
  ];
  p.note(lines.join('\n'), 'Summary');
  if (!answer(await p.confirm({ message: 'Apply?' }))) return p.log.warn('Nothing changed.');

  applyChanges({ add, remove, scope });
  writeState({ lastSelected: selected });
}

async function registerDirect(names, { all, scope = 'global', yes, removing = false }) {
  const ids = all ? (removing ? Object.keys(agents).filter((id) => isRegistered(id, scope, CWD)) : detectedAgents()) : parseAgents(names);
  if (!ids.length) return p.log.warn(all ? 'No agents found.' : 'No agents given.');
  if (!yes && process.stdin.isTTY) {
    p.note(ids.map((id) => `${removing ? pc.red('−') : pc.green('+')} ${agents[id].name}`).join('\n'), removing ? 'Unregister' : 'Register');
    if (!answer(await p.confirm({ message: 'Apply?' }))) return;
  }
  applyChanges(removing ? { remove: ids, scope } : { add: ids, scope });
  if (!removing) writeState({ lastSelected: [...new Set([...(readState().lastSelected ?? []), ...ids])] });
}

async function unregisterInteractive({ scope = 'global' }) {
  const regs = Object.keys(agents).filter((id) => isRegistered(id, supportsScope(id, scope) ? scope : 'global', CWD));
  if (!regs.length) return p.log.info(`Not registered anywhere (${scope} scope).`);
  const ids = answer(await p.multiselect({
    message: 'Remove telegramcp from',
    options: regs.map((id) => ({ value: id, label: agents[id].name, hint: shortPath(configPath(id, scope, CWD)) })),
    required: true,
  }));
  applyChanges({ remove: ids, scope });
}

function printList() {
  const detected = new Set(detectedAgents());
  const rows = Object.entries(agents).map(([id, a]) => {
    const global = isRegistered(id, 'global') ? pc.green('● registered') : detected.has(id) ? pc.dim('○ detected') : pc.dim('· not found');
    const project = a.project ? (isRegistered(id, 'project', CWD) ? pc.green(' + this project') : '') : '';
    return `${id.padEnd(20)} ${a.name.padEnd(24)} ${global}${project}\n${' '.repeat(21)}${pc.dim(shortPath(a.global))}`;
  });
  p.note(rows.join('\n'), 'Agents');
}

async function status() {
  const s = p.spinner();
  s.start('Checking Telegram session');
  const me = await currentUser().catch((err) => { s.error(err.message); return undefined; });
  if (me) s.stop(`Logged in as ${pc.cyan([me.firstName, me.lastName].filter(Boolean).join(' '))}${me.username ? ` (@${me.username})` : ''}`);
  else if (me === null) s.stop(pc.yellow('Not logged in — run `telegramcp login`'));
  const regs = registrations();
  const globals = Object.keys(agents).filter((id) => isRegistered(id, 'global'));
  p.log.info(`Registered (global): ${globals.length ? globals.map((id) => agents[id].name).join(', ') : pc.dim('nowhere')}`);
  const projects = regs.filter((r) => r.scope === 'project');
  if (projects.length) p.log.info(`Registered (project): ${projects.map((r) => `${agents[r.agent]?.name} @ ${shortPath(r.cwd)}`).join(', ')}`);
  p.log.info(pc.dim(`install: ${ROOT}${isGitCheckout ? ' (git checkout)' : ''}\ndata:    ${DATA_DIR}\nnode:    ${process.execPath}`));
}

function refresh() {
  const results = refreshAll();
  if (!results.length) return p.log.info('Nothing registered yet — run `telegramcp register`.');
  for (const r of results) {
    const label = `${agents[r.agent].name}${r.scope === 'project' ? ` @ ${shortPath(r.cwd)}` : ''}`;
    if (r.status === 'ok') p.log.success(`${label} ${pc.dim(`→ ${r.file}`)}`);
    else if (r.status === 'gone') p.log.warn(`${label}: entry no longer present, forgotten`);
    else p.log.error(`${label}: ${r.error}`);
  }
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function capture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return res.status === 0 ? res.stdout.trim() : '';
}

// Nearest existing ancestor decides whether we could create the dir.
function writable(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(d)) {
      try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; }
    }
    if (d === path.dirname(d)) return false;
  }
}

const spec = /^[a-z0-9@][\w./-]*$/i.test(INSTALL_SPEC) && !INSTALL_SPEC.includes(':') && !INSTALL_SPEC.slice(1).includes('@')
  ? `${INSTALL_SPEC}@latest` : INSTALL_SPEC;

// Installs to npm's global prefix when it's writable, otherwise to a user-owned prefix
// (~/.local/share/telegramcp) with a ~/.local/bin/telegramcp link, so sudo is never needed.
// Returns the installed cli.js path.
function installStable({ preferUser = false } = {}) {
  const globalRoot = capture('npm', ['root', '-g']);
  if (!preferUser && globalRoot && writable(globalRoot)) {
    p.log.step(`npm install -g ${spec}`);
    run('npm', ['install', '-g', spec, '--no-audit', '--no-fund', '--loglevel=error']);
    return path.join(globalRoot, pkg.name, 'src', 'cli.js');
  }
  p.log.step(`npm install --prefix ${shortPath(USER_PREFIX)} ${spec}`);
  fs.mkdirSync(USER_PREFIX, { recursive: true });
  run('npm', ['install', '--prefix', USER_PREFIX, spec, '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error']);
  const cli = path.join(USER_PREFIX, 'node_modules', pkg.name, 'src', 'cli.js');
  linkUserBin();
  return cli;
}

function linkUserBin() {
  const target = path.join(USER_PREFIX, 'node_modules', '.bin', process.platform === 'win32' ? `${pkg.name}.cmd` : pkg.name);
  if (process.platform === 'win32') {
    p.log.info(`Command: ${target}`);
    return;
  }
  const binDir = path.join(os.homedir(), '.local', 'bin');
  const link = path.join(binDir, pkg.name);
  fs.mkdirSync(binDir, { recursive: true });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(target, link);
  const onPath = (process.env.PATH || '').split(path.delimiter).includes(binDir);
  p.log.info(`Command: ${shortPath(link)}${onPath ? '' : pc.yellow(` — add ${shortPath(binDir)} to your PATH to use \`${pkg.name}\` directly`)}`);
}

function update() {
  let cli = path.join(ROOT, 'src', 'cli.js');
  if (isGitCheckout) {
    p.log.step(`Updating git checkout ${shortPath(ROOT)}`);
    run('git', ['-C', ROOT, 'pull', '--ff-only']);
    run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: ROOT });
  } else {
    cli = installStable({ preferUser: isUserInstall });
  }
  // Refresh with the freshly installed code (paths may have changed).
  p.log.step('Refreshing registered paths');
  run(process.execPath, [cli, 'refresh', '--quiet']);
}

// Running via `npx` puts the code in a disposable cache dir; install it somewhere stable first.
function ensureStableInstall() {
  if (!isNpxCache) return false;
  p.log.warn('Running from the npx cache — AI clients need a stable install path.');
  const cli = installStable();
  p.log.step('Continuing with the installed version');
  run(process.execPath, [cli, 'setup', '--quiet']);
  return true;
}

async function setup() {
  if (ensureStableInstall()) return;
  p.log.step(pc.bold('1. Log in to Telegram'));
  await loginInteractive();
  p.log.step(pc.bold('2. Register in your AI agents'));
  await registerInteractive();
  p.note(
    `Restart your AI clients to pick up the ${pc.cyan('telegramcp')} server.\n` +
    `Later: ${pc.cyan('telegramcp register')} to add/remove agents, ${pc.cyan('telegramcp update')} to update.`,
    'Done',
  );
}

async function menu() {
  const loggedIn = Boolean(readSession());
  const action = answer(await p.select({
    message: 'What do you want to do?',
    options: [
      { value: 'setup', label: 'Full setup', hint: 'login + register' },
      { value: 'register', label: 'Choose where it is registered', hint: 'add / remove agents' },
      { value: 'login', label: loggedIn ? 'Log in again' : 'Log in', hint: 'QR or phone code' },
      { value: 'status', label: 'Status' },
      { value: 'update', label: 'Update', hint: 'latest version + refresh paths' },
      { value: 'logout', label: 'Log out', hint: 'revoke this machine\'s session' },
    ],
  }));
  return action;
}

// ---------- main ----------

async function main() {
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      scope: { type: 'string' },
      project: { type: 'boolean' },
      qr: { type: 'boolean' },
      code: { type: 'boolean' },
      force: { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  let [cmd, ...rest] = positionals;
  const scope = o.project ? 'project' : o.scope;
  if (scope && !['global', 'project'].includes(scope)) throw new Error('--scope must be global or project');

  if (o.version) return console.log(pkg.version);
  if (o.help || cmd === 'help') return console.log(HELP);
  if (cmd === 'serve' || (!cmd && !process.stdin.isTTY)) return import('./server.js');

  if (!o.quiet) p.intro(`${pc.bgCyan(pc.black(' telegramcp '))} ${pc.dim(`v${pkg.version}`)}`);
  if (!cmd) cmd = await menu();

  switch (cmd) {
    case 'setup': await setup(); break;
    case 'login': await loginInteractive({ method: o.qr ? 'qr' : o.code ? 'code' : undefined, force: o.force }); break;
    case 'logout':
      if (o.yes || answer(await p.confirm({ message: 'Revoke this machine\'s Telegram session?', initialValue: false }))) {
        await logout();
        p.log.success('Logged out.');
      }
      break;
    case 'status': await status(); break;
    case 'list': printList(); break;
    case 'register':
      if (rest.length || o.all) await registerDirect(rest, { all: o.all, scope, yes: o.yes });
      else if (process.stdin.isTTY) await registerInteractive({ scope });
      else throw new Error('No TTY: pass agents, e.g. `telegramcp register cursor codex -y` (see `telegramcp list`).');
      break;
    case 'unregister':
      if (rest.length || o.all) await registerDirect(rest, { all: o.all, scope, yes: o.yes, removing: true });
      else await unregisterInteractive({ scope });
      break;
    case 'refresh': refresh(); break;
    case 'update': update(); break;
    case 'send-code': p.log.success(`Code sent via ${await sendCode()}. Then: telegramcp verify <code> [2fa-password]`); break;
    case 'verify': p.log.success(`Logged in as ${await verify(rest[0], rest[1])}`); break;
    default: throw new Error(`Unknown command "${cmd}". Run \`telegramcp --help\`.`);
  }
  if (!o.quiet) p.outro(pc.dim('Done'));
}

main().catch((err) => {
  if (err instanceof Cancelled) {
    p.cancel('Cancelled.');
    process.exit(130);
  }
  p.log.error(err.errorMessage || err.message || String(err));
  process.exit(1);
}).then(() => {
  // GramJS keeps sockets/timers alive; exit explicitly unless we're serving MCP.
  if (!(process.argv[2] === 'serve' || (!process.argv[2] && !process.stdin.isTTY))) process.exit(0);
});
