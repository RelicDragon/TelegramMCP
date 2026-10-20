#!/usr/bin/env bash
# Register this checkout as the "telegram" MCP server in Claude Code (user scope).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
claude mcp remove -s user telegram >/dev/null 2>&1 || true
claude mcp add -s user telegram -- node "$DIR/src/server.js"
