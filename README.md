# telegramcp

[![npm](https://img.shields.io/npm/v/telegramcp)](https://www.npmjs.com/package/telegramcp)

An MCP server that gives your AI agents (Claude Code, Codex, Cursor, VS Code, Claude Desktop, Gemini CLI, Zed, …)
access to **your personal messengers**:

- **Telegram:** private chats, groups, channels, forum topics, search and media. It uses GramJS / MTProto, so the agent sees your account the way the Telegram app does.
- **WhatsApp** (macOS): read-only, from WhatsApp Desktop's local database. It never connects to WhatsApp, so there's no ban risk.
- **Viber** (macOS): through Viber Desktop, entirely in the background. It never takes focus, moves the pointer or types.

WhatsApp and Viber turn on by themselves when their desktop apps are installed ([details](#whatsapp-and-viber-macos)).

## Install (one line)

```bash
npx -y telegramcp setup
```

The installer first installs itself somewhere stable (your AI clients need a fixed path; the npx cache isn't one), then starts the wizard.
It uses npm's global folder if you can write to it; otherwise (e.g. `/usr/lib/node_modules` owned by root) it installs to
`~/.local/share/telegramcp` and links `~/.local/bin/telegramcp`. No sudo needed.
Equivalent: `npm install -g telegramcp && telegramcp setup`. Latest from GitHub: `npm install -g github:RelicDragon/TelegramMCP`.

`setup` is an interactive wizard:

1. **Log in to Telegram**: scan a QR code from your phone (*Settings → Devices → Link Desktop Device*), or use phone number + code.
   2FA passwords are asked for with hidden input. On first run it also asks for `API_ID` / `API_HASH` (from https://my.telegram.org).
2. **Pick your agents**: a multi-select of every supported client. Detected ones are listed first and already-registered
   ones are pre-checked. Choose **global** or **this project** scope, review the summary, confirm.

Restart your AI clients afterwards.

**Requirements:** Node 20+ (WhatsApp needs Node 22.13+). Telegram works on macOS, Linux and Windows; WhatsApp and Viber need macOS 13+ with their desktop apps installed.

**Only WhatsApp or Viber?** They don't need a Telegram login: install with `npm install -g telegramcp`, then run `telegramcp register` to add it to your agents (and `telegramcp permissions` for Viber). The Telegram tools are still listed and answer that you're not logged in.

## Managing it later

| Command | What it does |
| --- | --- |
| `telegramcp` | Interactive menu |
| `telegramcp register` | Interactive picker: check to add, uncheck to remove |
| `telegramcp register cursor codex -y` | Register directly, no prompts (`--all` = all detected, `--project` = config in the current dir) |
| `telegramcp unregister zed -y` | Remove from given agents (no args → interactive) |
| `telegramcp list` | Supported agents, what's detected, where it's registered |
| `telegramcp status` | Logged-in account, registrations, install & data paths |
| `telegramcp update [--force]` | Show current → latest version, update only if newer, then **refresh paths** in every registered client |
| `telegramcp refresh` | Rewrite registered paths only (after moving the install or switching Node versions, e.g. with nvm) |
| `telegramcp login [--qr \| --code] [--force]` | Log in again |
| `telegramcp logout` | Revoke this machine's session |
| `telegramcp write [on\|off\|status]` | **High risk:** let agents send/edit/delete messages as you ([details](#write-mode-high-risk-off-by-default)) |
| `telegramcp write viber [on\|off\|status] [--chats "A,B (+phone)"]` | **High risk:** let agents send Viber messages as you to the listed chats ([details](#sending-in-viber-high-risk-off-by-default)) |
| `telegramcp permissions` | macOS: explain and ask for the permissions WhatsApp and Viber need |
| `telegramcp send-code` / `verify <code> [2fa]` | Non-interactive login, for scripts |

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
| `helmlane` | [Helmlane](https://helmlane.com): one running copy shared with every app | via `helmlane connectors add` (Helmlane's `connectors.json`) | — |

Config edits are surgical: JSON/JSONC comments, TOML and YAML formatting and your other servers are preserved,
and the previous file is kept as `<file>.bak`. Paths follow [add-mcp](https://github.com/neon-solutions/add-mcp).

Any other MCP client: run `telegramcp` with no arguments (stdio), or

```json
{ "mcpServers": { "telegramcp": { "command": "telegramcp" } } }
```

## Where things live

- Credentials and session: `~/.config/telegramcp/` (`%APPDATA%\telegramcp` on Windows; override with `TELEGRAMCP_HOME`).
  It holds `.env` (API_ID, API_HASH, PHONE_NUMBER), `session.txt` and `state.json` (where the server is registered).
  This is outside the install dir, so updates and reinstalls don't log you out.
- **One session per machine.** Each install shows up in Telegram → Settings → Devices as `telegramcp (<hostname>)`.
  Don't copy `session.txt` between machines: using one auth key from two places at once can get it revoked (`AUTH_KEY_DUPLICATED`).

## Tools exposed to the agent

Read-only: `get_me`, `list_chats`, `get_chat`, `read_messages`, `search_messages` (per chat or global),
`get_message_context`, `get_unread`, `get_poll`, `list_topics`, `list_participants`, `list_contacts`, `download_media`.
Reading never marks messages as read.

Polls show their type, vote counts and your vote inline in messages. `get_poll` reads one poll in full: quiz or regular,
anonymous or public, single or multiple choice, open or closed, percentages, a quiz's correct answer and explanation,
and for public polls who voted for which option. Without `message_id` it lists the recent polls in a chat.
Telegram only shows counts and voters once you have voted, or once the poll is closed.

### Write mode (high risk, off by default)

```bash
telegramcp write                                # interactive: off / only chosen chats / all chats
telegramcp write on --chats me,@alice,-100123 -y
telegramcp write off
```

When it's on, agents can act **as you**: `send_message` (replies, forum topics, markdown/html), `send_file`,
`forward_messages`, `edit_message` / `delete_messages` (your own messages only), `send_reaction`, `mark_read`.
Recipients can't tell an AI wrote it, and any message sent to you could try a prompt injection, so keep
your client's tool approval on for these tools. Safeguards:

- optional chat allowlist (`TELEGRAMCP_WRITE_CHATS`: ids, @usernames, `me`), checked before every write
- rate limit, 20 writes/min by default (`TELEGRAMCP_WRITE_RATE`)
- `send_file` refuses hidden files/dirs (`~/.ssh`, `.env`, …) and the telegramcp data dir
- every write is appended to `writes.log` in the data dir

It's stored in the data-dir `.env` (`TELEGRAMCP_ALLOW_WRITE`). Restart your AI clients after changing it.

Chats can be referenced by id, `@username`, t.me link, `me` (Saved Messages), or a title substring.

Other env: `TELEGRAMCP_DOWNLOAD_DIR` (default `~/Downloads/telegramcp`), `TELEGRAMCP_MAX_CHARS`, `TZ`,
`TG_SESSION` (inject the session via env), `TG_DEVICE_NAME`, `TG_PASSWORD`.

## WhatsApp and Viber (macOS)

Both work on macOS only, without any login: they read what the desktop apps already have. Limit which messengers are on with `TELEGRAMCP_MESSENGERS` (default `telegram,whatsapp,viber`). `telegramcp status` shows what's on, and `telegramcp permissions` explains the macOS permissions and asks for them.

As with Telegram, everything the agent reads was written by other people and may try to give it instructions (prompt injection). The tools label it as untrusted, but keep approval on for anything that sends.

**WhatsApp:** `whatsapp_get_me`, `whatsapp_list_chats`, `whatsapp_get_chat`, `whatsapp_read_messages`, `whatsapp_search_messages`, `whatsapp_get_message_context`, `whatsapp_get_unread`, `whatsapp_list_participants`, `whatsapp_list_contacts`, `whatsapp_download_media`.
- Read-only, from WhatsApp Desktop's database. Only what it has synced is available.
- Replies, mentions, captions and media are shown. Locked chats are left out.
- Needs Node 22.13+ (built-in SQLite). The app that runs telegramcp may need **Full Disk Access** to read WhatsApp's data.

**Viber:** `viber_get_status`, `viber_list_chats`, `viber_scroll_chat_list`, `viber_open_chat`, `viber_read_chat`, `viber_scroll_chat`, `viber_search`, `viber_clear_search`, `viber_screenshot`, and `viber_send_message` when [sending is on](#sending-in-viber-high-risk-off-by-default).
- Viber has no API for personal accounts, so telegramcp reads Viber Desktop's window through the accessibility API and on-device text recognition, using the bundled helper app (`bin/telegramcp.app`).
- It works **only in the background**: it never activates Viber, never moves your pointer or types, refuses to change anything while Viber is the active app, and never touches an unsent draft.
- `viber_open_chat` switches Viber to another chat by name, in the background: it finds the chat with Viber's search and clicks it with an event delivered only to Viber, so your pointer, keyboard focus and windows stay as they are. Like opening a chat yourself, it marks its messages as read.
- Message text is exact. `[Bracketed]` names, times and dates are read from the screen, so small typos are possible.
- It works with what Viber shows, like a person looking at the window: the visible part of the chat list and of the open chat (the scroll tools move them), one chat at a time. If Viber's window is visible you'll see it scroll and switch chats; that's expected.
- Keep Viber Desktop running and logged in, with its window open: it can be behind other windows, but not minimized and not on another Space (desktop).
- `viber_open_chat` and `viber_search` type into Viber's search box and clear it afterwards, replacing a search you had typed there.
- Calls take turns, so several apps can use it at once. While you're using Viber (it's the active app), anything that changes it is refused; switch to another app and try again.
- It needs **Accessibility** and **Screen Recording** for **telegramcp** itself: System Settings lists it as "telegramcp" with its icon, whichever app runs the server (Helmlane, Claude, Cursor, a terminal), so you grant them once. Run `telegramcp permissions`: it adds telegramcp to both lists, opens each page and waits while you turn it on.

### Sending in Viber (high risk, off by default)

Sending is a separate opt-in, limited to the chats you list:

```bash
telegramcp write viber on --chats "My Notes,Alice,Team chat"
```

That adds `viber_send_message`: an agent gives it a chat name and the text. It opens the chat in the background if another one is open, sends only once Viber shows that chat, never overwrites a draft you're typing, allows 10 sends a minute and logs every send to `writes.log`. Recipients see the message as yours, so keep tool approval on for `viber_send_message`.

**Choosing chats**
- `--chats` replaces the whole list, so name every chat you want to keep. Without `--chats`, any chat is allowed.
- A name allows every chat whose title matches it, including longer titles that contain it ("Alex" also allows "Alex Smith").
- When several chats share a name, pin the one you mean to what its chat header shows under the name, usually the phone number: `--chats "Alex (+381601234567)"`. To find it, open the chat in Viber, or ask an agent to call `viber_open_chat`; its answer shows it, e.g. `Opened "Alex" (+381601234567)`. Sends to the other chats named Alex are refused, and so is a send while the header shows something else (e.g. "Last seen…"); try again in a moment.
- With chats that share a name, the agent passes `match` (text from the right chat's row, such as its last message) to pick one. Without it, nothing is sent and the matching chats are listed.

**Applying a change**
- `telegramcp write viber status` shows what is allowed; `telegramcp write viber off` turns sending off.
- The running server reads the list at start: restart the apps that run telegramcp, or with Helmlane run `helmlane restart`.
- It's stored in the data-dir `.env`: `TELEGRAMCP_VIBER_WRITE`, `TELEGRAMCP_VIBER_WRITE_CHATS`, and `TELEGRAMCP_VIBER_WRITE_RATE` (sends a minute, default 10).
- With Helmlane, also share `viber_send_message` in the Helmlane app under Connectors. If a chat app such as claude.ai doesn't show a new tool, reconnect the connector there.

**With Helmlane:** `telegramcp register helmlane` runs one copy for every app, including AI apps in the cloud (ChatGPT, claude.ai). Viber's permissions stay with telegramcp; WhatsApp's Full Disk Access, if needed, goes to Helmlane's agent, since it runs telegramcp. New tools appear in Helmlane after `helmlane restart` and must be shared in the Helmlane app under Connectors before cloud apps can use them.

## Troubleshooting

- **Telegram: "session missing" / "not authorized":** run `telegramcp login`. **AUTH_KEY_DUPLICATED:** the same session was used from two places; run `telegramcp login --force` on this machine (and never copy `session.txt`).
- **Your agent can't find telegramcp after an update or a Node version switch (nvm):** run `telegramcp refresh`.
- **WhatsApp tools say "Cannot read …":** give **Full Disk Access** to the app that runs telegramcp (your terminal, AI app or Helmlane), then restart it. WhatsApp tools missing: check `telegramcp status` (Node 22.13+, WhatsApp Desktop installed).
- **Viber: missing Accessibility or Screen Recording:** run `telegramcp permissions`. If macOS names another app instead of telegramcp, turn on that one.
- **Viber: "minimized or on another Space" / "has no open window":** open Viber's window on the current desktop; it can stay behind other windows.
- **Viber: "isn't answering accessibility requests":** wait a minute and retry; if it keeps happening, quit and reopen Viber.
- **Viber: "the active app right now":** you're using Viber; switch to another app and retry.
- **Viber: several chats match:** call again with `match` set to text from the right chat's row (its last message or phone number).
- **A new tool or setting doesn't show up:** restart the app that runs telegramcp (`helmlane restart` with Helmlane). Chat apps that cache tool lists (claude.ai) may need the connector reconnected.

## Uninstall

```bash
telegramcp unregister --all -y
npm uninstall -g telegramcp
```

Your login and settings stay in `~/.config/telegramcp/`; delete that folder too to remove them (run `telegramcp logout` first to end the Telegram session). On macOS, also remove telegramcp from System Settings → Privacy & Security → Accessibility and Screen & System Audio Recording.

## Development

```bash
git clone https://github.com/RelicDragon/TelegramMCP.git && cd TelegramMCP && npm install
npm run setup            # same wizard, registered against this checkout
npm run register:cursor  # register:<agent> for each agent, register:all for all detected
node test/smoke.js whatsapp_list_chats '{"limit":5}'   # call tools through a real MCP client
npm run build:native     # rebuild bin/telegramcp.app (universal viber-ax helper) from native/viber-ax.swift; runs before publish
```

`telegramcp update` on a git checkout does `git pull` + `npm install` and then refreshes paths.

`build:native` signs with `$TELEGRAMCP_SIGN_IDENTITY` or the first "Developer ID Application" identity in your keychain. Keeping the same signature keeps the macOS permissions across rebuilds; an ad-hoc signature (no identity) works, but every rebuild needs them granted again. Without the prebuilt app, telegramcp builds one with `swiftc` (Xcode Command Line Tools).
