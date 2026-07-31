# TheeDiscordMCP

A local MCP server that lets Codex inspect and operate an allowlisted Discord guild through Discord's official REST API. It is designed for real server administration: broad coverage, predictable dry-runs, local state tracking, audit reasons, and strong boundaries around destructive actions.

## What it manages

- Guild settings, roles, role order, and member role assignment
- Categories, text/announcement/voice/stage/forum/media channels, ordering, and permission overwrites
- Forum tags, posting guidelines, sorting, and layout
- Messages: list, send, edit, delete, pin, unpin, and bulk delete
- Members: list/search, timeout, kick, ban, and unban
- AutoMod rules, onboarding, welcome screen, emojis, and audit-log reads
- Idempotent JSON blueprints with a dry-run planner
- Bot and application profile management, including avatar and banner data URIs
- A tightly scoped raw REST escape hatch for new Discord endpoints and guild-owned resources

There are 27 MCP tools. Every server call is limited to guild IDs in the local allowlist. The raw escape hatch accepts routes under an allowed guild, its verified channels, webhooks, invites, stage instances, and the operator's commands for that guild. This keeps broad Discord API coverage without exposing unrelated servers.

## Safety modes

| Mode | Reads | Create/update | Delete, ban, kick, raw writes |
|---|---:|---:|---:|
| `read-only` | yes | no | no |
| `safe-write` | yes | yes | no |
| `full` | yes | yes | only with destructive opt-in and exact confirmation |

The default is `read-only`. Blueprint application never deletes resources. It creates or updates matching resources and tracks their Discord IDs in `.data/state.json` so reruns do not create duplicates.

## 1. Create the Discord operator

Create a dedicated application in the Discord Developer Portal, add a bot, and invite it only to the server you want to manage. Never use a personal/user token.

For the full tool set, the bot may need:

- View Channels, Read Message History, Send Messages, Manage Messages, Manage Threads
- Manage Channels, Manage Roles
- Moderate Members, Kick Members, Ban Members
- Manage Guild, View Audit Log
- Manage Webhooks / Manage Emojis and Stickers only if you use related operations

`Administrator` is convenient but not required or recommended. Discord role hierarchy still applies: the operator can manage only roles and members below its highest role.

## 2. Install and configure

Requires Node.js 20.19 or newer and pnpm.

```powershell
cd D:\Dev\TheeDiscordMCP
pnpm install
Copy-Item .env.example .env
```

Open `.env` locally and set:

```dotenv
DISCORD_BOT_TOKEN=your_dedicated_bot_token
DISCORD_ALLOWED_GUILD_IDS=123456789012345678
DISCORD_MODE=read-only
```

Do not send the token through chat. To copy a Discord server ID, enable Developer Mode in Discord, right-click the server, and choose **Copy Server ID**.

Build and verify:

```powershell
pnpm check
```

## 3. Connect Codex

Add the following to the Codex MCP configuration (an editable copy is included as `mcp.config.example.toml`):

```toml
[mcp_servers.thee-discord]
command = "node"
args = ["D:/Dev/TheeDiscordMCP/dist/index.js"]
cwd = "D:/Dev/TheeDiscordMCP"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Restart Codex, then begin with a read-only request:

> Export a snapshot of my allowlisted Discord server and review its channels, roles, forums, and permission overwrites. Do not change anything.

When the snapshot looks correct, set `DISCORD_MODE=safe-write`, restart the MCP server, and apply ordinary changes. Keep destructive mode disabled until a specific deletion or moderation action is needed.

## Blueprint workflow

`examples/elalem.blueprint.json` is a polished English-first ELALEM support/community blueprint. It includes restrained category styling, a human-sounding welcome message, two forum templates, tags, staff privacy, and sensible channel names.

Recommended flow:

1. `discord_export_snapshot`
2. Adjust the blueprint to preserve intentional existing resources.
3. `discord_plan_blueprint` or `discord_apply_blueprint` with `dryRun: true`.
4. Review every planned action.
5. Switch to `safe-write` and run `discord_apply_blueprint` with `dryRun: false`.
6. Export another snapshot and verify the result.

Blueprint channel mentions use `{{channel:key}}`; they are resolved to real clickable Discord mentions when a message is sent.

The blueprint deliberately performs no deletion. Existing channels or roles with different names are left alone unless their tracked key points to them. Review duplicate or obsolete resources separately before removing anything.

## Destructive operations

To permit a specific destructive action temporarily:

```dotenv
DISCORD_MODE=full
DISCORD_ENABLE_DESTRUCTIVE=true
```

Each destructive tool returns or documents the exact confirmation text it expects, such as `DELETE CHANNEL <id>`. The confirmation is checked again inside the MCP server. Return to `safe-write` or `read-only` afterward.

The raw REST tool treats every non-GET request as destructive. This keeps an unfamiliar endpoint from bypassing the named safety gates.

## Development

```powershell
pnpm typecheck
pnpm test
pnpm build
```

The server uses stdio, so stdout is reserved for MCP protocol traffic; operational messages go to stderr. Discord rate limits are handled by `@discordjs/rest`.

## License

MIT
