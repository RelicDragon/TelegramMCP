# Telegram MCP

An MCP server that gives your AI agents (Claude Code, Codex, Cursor, VS Code, Claude Desktop, Gemini CLI, Zed, …)
access to **your personal Telegram account**: private chats, groups, channels, forum topics, search, media.
It uses GramJS / MTProto, so the agent sees your account the way the Telegram app does.

## Install (one line)

```bash
npm install -g github:RelicDragon/TelegramMCP && telegram-mcp setup
```

or without a global install up front (the installer then installs itself globally so your clients get a stable path):

```bash
npx -y github:RelicDragon/TelegramMCP setup
```

`setup` is an interactive wizard:

1. **Log in to Telegram**: scan a QR code from your phone (*Settings → Devices → Link Desktop Device*), or use phone number + code.
   2FA passwords are asked for with hidden input. On first run it also asks for `API_ID` / `API_HASH` (from https://my.telegram.org).
2. **Pick your agents**: a multi-select of every supported client. Detected ones are listed first and already-registered
   ones are pre-checked. Choose **global** or **this project** scope, review the summary, confirm.

Restart your AI clients afterwards.

## Managing it later

| Command | What it does |
| --- | --- |
| `telegram-mcp` | Interactive menu |
| `telegram-mcp register` | Interactive picker: check to add, uncheck to remove |
| `telegram-mcp register cursor codex -y` | Register directly, no prompts (`--all` = all detected, `--project` = config in the current dir) |
| `telegram-mcp unregister zed -y` | Remove from given agents (no args → interactive) |
| `telegram-mcp list` | Supported agents, what's detected, where it's registered |
| `telegram-mcp status` | Logged-in account, registrations, install & data paths |
| `telegram-mcp update` | Update to the latest version, then **refresh paths** in every registered client |
| `telegram-mcp refresh` | Rewrite registered paths only (after moving the install or switching Node versions, e.g. with nvm) |
| `telegram-mcp login [--qr \| --code] [--force]` | Log in again |
| `telegram-mcp logout` | Revoke this machine's session |
| `telegram-mcp send-code` / `verify <code> [2fa]` | Non-interactive login, for scripts |

### Supported agents

| id | Client | Global config | Project config |
| --- | --- | --- | --- |
| `claude-code` (`claude`) | Claude Code | via `claude mcp add-json -s user` (`~/.claude.json`) | `.mcp.json` |
| `claude-desktop` (`desktop`) | Claude Desktop | `claude_desktop_config.json` | — |
| `codex` | OpenAI Codex | `$CODEX_HOME/config.toml` | `.codex/config.toml` |
| `cursor` | Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| `vscode` (`code`) | VS Code / Copilot Chat | `Code/User/mcp.json` | `.vscode/mcp.json` |
| `github-copilot-cli` (`copilot`) | GitHub Copilot CLI | `~/.copilot/mcp-config.json` | — |
| `gemini-cli` (`gemini`) | Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` |
| `windsurf` | Windsurf | `~/.codeium/windsurf/mcp_config.json` | — |
| `antigravity` | Antigravity | `~/.gemini/config/mcp_config.json` | — |
| `zed` | Zed | `zed/settings.json` (`context_servers`) | `.zed/settings.json` |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json[c]` | `opencode.json` |
| `goose` | Goose | `goose/config.yaml` (`extensions`) | — |
| `cline` | Cline (VS Code) | `cline_mcp_settings.json` | — |
| `kiro-cli` (`kiro`) | Kiro | `~/.kiro/settings/mcp.json` | `.kiro/settings/mcp.json` |

Config edits are surgical: JSON/JSONC comments, TOML and YAML formatting and your other servers are preserved,
and the previous file is kept as `<file>.bak`. Paths follow [add-mcp](https://github.com/neon-solutions/add-mcp).

Any other MCP client: run `telegram-mcp` with no arguments (stdio), or

```json
{ "mcpServers": { "telegram": { "command": "telegram-mcp" } } }
```

## Where things live

- Credentials and session: `~/.config/telegram-mcp/` (`%APPDATA%\telegram-mcp` on Windows; override with `TELEGRAM_MCP_HOME`).
  It holds `.env` (API_ID, API_HASH, PHONE_NUMBER), `session.txt` and `state.json` (where the server is registered).
  This is outside the install dir, so updates and reinstalls don't log you out.
- **One session per machine.** Each install shows up in Telegram → Settings → Devices as `Telegram MCP (<hostname>)`.
  Don't copy `session.txt` between machines: using one auth key from two places at once can get it revoked (`AUTH_KEY_DUPLICATED`).

## Tools exposed to the agent

Read-only: `get_me`, `list_chats`, `get_chat`, `read_messages`, `search_messages` (per chat or global),
`get_message_context`, `get_unread`, `list_topics`, `list_participants`, `list_contacts`, `download_media`.
Reading never marks messages as read.

With `TELEGRAM_MCP_ALLOW_WRITE=true` (in the data-dir `.env`): `send_message`, `mark_read`.

Chats can be referenced by id, `@username`, t.me link, `me` (Saved Messages), or a title substring.

Other env: `TELEGRAM_MCP_DOWNLOAD_DIR` (default `~/Downloads/telegram-mcp`), `TELEGRAM_MCP_MAX_CHARS`, `TZ`,
`TG_SESSION` (inject the session via env), `TG_DEVICE_NAME`, `TG_PASSWORD`.

## Development

```bash
git clone https://github.com/RelicDragon/TelegramMCP.git && cd TelegramMCP && npm install
npm run setup            # same wizard, registered against this checkout
npm run register:cursor  # register:<agent> for each agent, register:all for all detected
```

`telegram-mcp update` on a git checkout does `git pull` + `npm install` and then refreshes paths.
