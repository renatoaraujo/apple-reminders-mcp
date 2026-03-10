Apple Reminders MCP (Local)

A local-only MCP server for macOS Reminders. Lets AI agents list, create, update, complete, move, search, and delete reminders in your Reminders lists. No cloud; talks to the Reminders app via macOS automation.

Quick Start

- Requirements: macOS, Node 20+, Reminders enabled.
- Install: `npm install` then `npm run build`.
- Run: `node dist/index.js` (or `npm run dev` for TypeScript dev mode).
- npx (npm registry): after publishing, run `npx @renatoaraujo/apple-reminders-mcp`.
- npx (GitHub, immediate): `npx -y github:renatoaraujo/apple-reminders-mcp apple-reminders-mcp`.
- Connect with an MCP-compatible client:
  - Claude Desktop: add under `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json`:
    {
      "mcpServers": {
        "apple-reminders": {
          "command": "node",
          "args": ["/absolute/path/to/apple-reminders-mcp/dist/index.js"]
        }
      }
    }
  - Generic MCP clients (Cursor, Continue, Cline): use the same block above per client docs.
  - Codex CLI: no first-class MCP config yet; use Claude/Cursor/etc., or the scripts in `scripts/` to drive the server directly.

Claude Desktop via npx (npm, after publish)

{
  "mcpServers": {
    "apple-reminders": {
      "command": "npx",
      "args": ["-y", "@renatoaraujo/apple-reminders-mcp"]
    }
  }
}

Claude Desktop via npx (GitHub, immediate)

{
  "mcpServers": {
    "apple-reminders": {
      "command": "npx",
      "args": ["-y", "github:renatoaraujo/apple-reminders-mcp", "apple-reminders-mcp"]
    }
  }
}

Safety & Privacy

- Local-only via `osascript` (JXA/AppleScript). No network I/O.
- Safe mode: set `REMINDERS_MCP_SAFE=1` (or call `server.set_safe_mode`) to block write/delete ops.
- macOS will prompt for Automation permissions to control Reminders.

Capabilities

- Lists: list, ensure (create if missing), delete, rename.
- Reminders: list, get, create, update, complete/incomplete, move between lists, delete.
- Search: query reminders by title/notes.
- Admin: server.status, server.set_safe_mode.

Examples (ask your AI)

- "Create a reminder titled 'Pay rent' due next Friday in the 'Personal' list."
- "List all reminders in 'Work' due today."
- "Mark the reminder with ID X as completed."
- "Move reminder 'Buy milk' to the 'Groceries' list."
- "Search reminders for 'tax' and show top 10."

Troubleshooting

- Open the Reminders app if changes don’t appear immediately.
- Verify absolute paths in client configs. Run from a terminal to view logs.
