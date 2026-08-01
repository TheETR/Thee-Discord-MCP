# TheeDiscordMCP

A local MCP server for inspecting and managing an allowlisted Discord server through Discord's official REST API. It covers day-to-day administration, dry-run planning, local resource tracking, audit reasons, and explicit safeguards around high-impact actions.

## What it manages

- Guild settings, roles, role order, and member role assignment
- Categories, text/announcement/voice/stage/forum/media channels, ordering, and permission overwrites
- Forum tags, posting guidelines, sorting, and layout
- Messages: list, send, edit, delete, pin, unpin, and bulk delete
- Members: list/search, timeout, kick, ban, and unban
- Reactions, invites, scheduled events, and forum/thread membership
- Webhook lifecycle and execution with token/URL redaction
- Voice member inspection, moves, disconnects, server mute, and server deaf
- Membership Screening rule reads and guarded updates
- AutoMod rules, onboarding, welcome screen, emojis, and audit-log reads
- Idempotent JSON blueprints with a dry-run planner
- Bot and application profile management, including avatar and banner data URIs
- A tightly scoped raw REST escape hatch for new Discord endpoints and guild-owned resources

There are 37 MCP tools. Related operations are grouped into explicit action-based tools, so the public surface stays discoverable without turning every REST action into a separate executable. Every server call is limited to guild IDs in the local allowlist. The raw escape hatch accepts routes under an allowed guild, its verified channels, webhooks, invites, stage instances, and the operator's commands for that guild. This keeps broad Discord API coverage without exposing unrelated servers.

`discord_capabilities` reports the named operation families without contacting Discord. The advanced families cover directory/member searches, reactions, webhooks, invites, scheduled events, forum threads, voice members, permission overwrites, and Membership Screening. Empty `204 No Content` responses are normalized to `{ "ok": true }`, and webhook tokens and URLs are redacted from tool results.

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

- View Channels, Read Message History, Send Messages, Add Reactions, Manage Messages, Manage Threads
- Manage Channels, Manage Roles
- Moderate Members, Kick Members, Ban Members
- Move Members, Mute Members, Deafen Members
- Manage Guild, View Audit Log, Create Events, Manage Events
- Create Instant Invite, Manage Webhooks, and Manage Emojis and Stickers only if you use related operations

`Administrator` is convenient but not required or recommended. Discord role hierarchy still applies: the operator can manage only roles and members below its highest role.

## 2. Install and configure

Requires Node.js 20.19 or newer and pnpm.

```powershell
cd TheeDiscordMCP
pnpm install
Copy-Item .env.example .env
```

Open `.env` locally and set:

```dotenv
DISCORD_BOT_TOKEN=your_dedicated_bot_token
DISCORD_ALLOWED_GUILD_IDS=123456789012345678
DISCORD_MODE=read-only
```

Do not paste the token into messages, issue reports, or committed files. To copy a Discord server ID, enable Developer Mode in Discord, right-click the server, and choose **Copy Server ID**.

Build and verify:

```powershell
pnpm check
```

## 3. Connect an MCP client

Add the server to your MCP client configuration. An editable example is included as `mcp.config.example.toml`:

```toml
[mcp_servers.thee-discord]
command = "node"
args = ["C:/path/to/TheeDiscordMCP/dist/index.js"]
cwd = "C:/path/to/TheeDiscordMCP"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Restart the client and export a snapshot before making changes. Review the channels, roles, forums, and permission overwrites while the server is still in `read-only` mode.

Once the snapshot looks right, set `DISCORD_MODE=safe-write`, restart the MCP server, and apply ordinary changes. Keep destructive mode disabled until a specific deletion or moderation action is needed.

## Blueprint workflow

`examples/elalem.blueprint.json` provides an English ELALEM support and community layout with restrained category styling, a welcome message, two forum templates, tags, staff privacy, and practical channel names.

See `docs/ELALEM.md` for the live-server handoff, current user-facing channel copy, and the remaining boundaries that require Discord's UI or another bot runtime.

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
