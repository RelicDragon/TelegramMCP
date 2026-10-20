# Telegram MCP

MCP server (stdio) that gives LLM clients (Claude Code, Claude Desktop, Cursor, …) access to your
personal Telegram account (private chats, groups, channels, forums) via GramJS / MTProto, the same
user-account approach as TelegramAutobot.

Each machine logs in with **its own session** (`session.txt`, gitignored). It shows up in
Telegram → Settings → Devices as `Telegram MCP (<hostname>)`. Never copy a session between machines
or reuse the TelegramAutobot `STRING_SESSION`: using one auth key from two places at once can get it
revoked (`AUTH_KEY_DUPLICATED`).

## Install on a machine

    git clone https://github.com/RelicDragon/TelegramMCP.git
    cd TelegramMCP
    npm install
    npm run login            # prompts for API_ID/API_HASH/phone if missing, then code + 2FA
    # or: npm run login:qr   # scan a QR from Telegram app → Settings → Devices → Link Desktop Device
    npm run register:claude  # adds the "telegram" MCP server to Claude Code (user scope)

`API_ID` / `API_HASH` come from https://my.telegram.org (or copy them from TelegramAutobot's `.env`).
They're stored in `.env` (see `.env.example`). Restart your MCP client afterwards.

Other commands: `npm run status`, `npm run logout` (revokes this machine's session).

Non-interactive login (for scripts/agents):

    node src/login.js send-code
    node src/login.js verify <code> [2fa-password]

### Other MCP clients

    { "mcpServers": { "telegram": { "command": "node", "args": ["/abs/path/TelegramMCP/src/server.js"] } } }

## Tools
Read-only: `get_me`, `list_chats`, `get_chat`, `read_messages`, `search_messages` (per chat or global),
`get_message_context`, `get_unread`, `list_topics`, `list_participants`, `list_contacts`, `download_media`.
Reading never marks messages as read.

With `TELEGRAM_MCP_ALLOW_WRITE=true`: `send_message`, `mark_read`.

Chats can be referenced by id, `@username`, t.me link, `me` (Saved Messages), or a title substring.

Other env: `TELEGRAM_MCP_DOWNLOAD_DIR` (default `~/Downloads/telegram-mcp`), `TELEGRAM_MCP_MAX_CHARS`,
`TZ`, `TG_SESSION` (inject session via env), `TG_SESSION_FILE`, `TG_DEVICE_NAME`.
