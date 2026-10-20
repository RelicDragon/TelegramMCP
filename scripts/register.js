#!/usr/bin/env node
// Register this checkout as the "telegram" MCP server in Claude Code, Codex and/or Cursor.
//   node scripts/register.js [claude|codex|cursor|all]   (default: all)
// Uses the absolute path of the current node binary, since GUI apps (Cursor) often lack nvm's PATH.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../src/client.js';

const NAME = 'telegram';
const command = process.execPath;
const args = [path.join(ROOT, 'src', 'server.js')];

function claude() {
  try {
    execFileSync('claude', ['mcp', 'remove', '-s', 'user', NAME], { stdio: 'ignore' });
  } catch {}
  execFileSync('claude', ['mcp', 'add', '-s', 'user', NAME, '--', command, ...args], { stdio: 'inherit' });
}

function codex() {
  const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const section = `[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`;
  let toml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  // Replace an existing [mcp_servers.telegram] block (up to the next table header) or append.
  const re = new RegExp(`^\\[mcp_servers\\.${NAME}\\]\\n(?:(?!\\[)[^\\n]*\\n?)*`, 'm');
  toml = re.test(toml) ? toml.replace(re, `${section}\n`) : `${toml}${toml && !toml.endsWith('\n') ? '\n' : ''}${toml ? '\n' : ''}${section}`;
  fs.writeFileSync(file, toml);
  console.log(`Codex: wrote [mcp_servers.${NAME}] to ${file}`);
}

function cursor() {
  const file = path.join(os.homedir(), '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8') || '{}') : {};
  config.mcpServers = { ...config.mcpServers, [NAME]: { command, args } };
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log(`Cursor: wrote mcpServers.${NAME} to ${file}`);
}

const targets = { claude, codex, cursor };
const which = process.argv[2] || 'all';
for (const [name, fn] of Object.entries(targets)) {
  if (which !== 'all' && which !== name) continue;
  try {
    fn();
  } catch (err) {
    console.error(`${name}: ${err.code === 'ENOENT' ? 'CLI not found, skipped' : err.message}`);
  }
}
