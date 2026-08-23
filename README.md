# Thee Discord MCP

[![CI](https://github.com/TheETR/Thee-Discord-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/TheETR/Thee-Discord-MCP/actions/workflows/ci.yml)

A safety-gated Discord administration MCP server built on Discord's official REST API. It combines broad guild management, dry-run planning, local resource tracking, audit reasons, and explicit safeguards around high-impact actions without turning every related operation into a separate tool.

## What it manages

- Guild settings, roles, role order, and member role assignment
- Categories, text/announcement/voice/stage/forum/media channels, ordering, and permission overwrites
- Forum tags, posting guidelines, sorting, and layout
- Messages: list, send, edit, delete, pin, unpin, and bulk delete
- Message inspection, full JSON payloads, announcement crossposts, current paginated pins, and complete reaction cleanup
- Members: list/search, timeout, kick, ban, and unban
- Guild previews, role member counts, prune previews and guarded execution, bulk bans, integrations, incident actions, vanity URLs, and voice regions
- Reactions, invites, scheduled events, and forum/thread membership
- Public, private, and joined-private thread archives; threads created from messages; join/leave and member inspection
- Webhook lifecycle and execution with token/URL redaction
- Voice member inspection, moves, disconnects, server mute, and server deaf
- Stage instances, soundboard sounds, polls, and indexed message search
- Guild stickers with validated multipart uploads
- Guild templates, widgets, and guild or global application commands
- Application emojis and linked-role metadata schemas
- Optional one-to-one DMs restricted to an explicit user allowlist and disabled by default
- Membership Screening rule reads and guarded updates
- AutoMod rules, onboarding, welcome screen, emojis, and audit-log reads
- Idempotent JSON blueprints with a dry-run planner
- Bot and application profile management, including avatar and banner data URIs
- A tightly scoped raw REST escape hatch for new Discord endpoints and guild-owned resources

There are **49 MCP tools exposing 166 schema-declared operations**. The operation count treats every top-level `action` choice as one operation and every single-purpose tool as one operation. Related work stays together: for example, one `discord_guild_operations` tool contains preview, role-count, prune, integration, vanity URL, bulk-ban, voice-region, and incident actions instead of publishing eleven separate executables. The smoke test calculates and locks both inventory totals so documentation drift fails validation.

Every guild call is limited to IDs in `DISCORD_ALLOWED_GUILD_IDS`. Direct messages have a separate `DISCORD_ALLOWED_USER_IDS` boundary, are empty by default, and verify the one-to-one DM recipient before every read or write. The raw escape hatch remains guild-scoped; it canonicalizes paths before authorization, verifies indirect guild/channel IDs in request bodies, and never becomes a general Discord request proxy.

`discord_capabilities` reports the inventory totals, grouping rule, safety model, and named operation families without contacting Discord. Empty `204 No Content` responses are normalized to `{ "ok": true }`; webhook credentials and uploaded data URIs are redacted from previews and tool results.

## Coverage at a glance

| Surface | Grouped capabilities |
|---|---|
| Guild operations | Preview, settings, roles and counts, bans and bulk bans, prune preview/run, integrations, incidents, regions, vanity URL, audit log |
| Channels and threads | All guild channel types, ordering, overwrites, announcement follows, typing, voice status, public/private archives, membership |
| Messages | History, lookup, search, structured send/edit, crosspost, current pins, bulk delete, reactions, polls |
| Community configuration | AutoMod, Membership Screening, onboarding, welcome screen, scheduled events, invites, widgets |
| Voice and expressions | Voice-member control, Stage instances, soundboard, guild/application emojis, stickers |
| Applications and integrations | Guild/global commands, linked-role metadata, webhooks, templates, bot and application profiles |
| Controlled outreach | Allowlisted one-to-one DM open/read/send/edit/delete; disabled until recipient IDs are configured |
| Repeatable operations | Snapshots, dry-run plans, idempotent blueprints, scoped raw guild REST |

## Safety modes

| Mode | Reads | Ordinary create/update | Privileged writes | Destructive writes |
|---|---:|---:|---:|---:|
| `read-only` | yes | no | no | no |
| `safe-write` | yes | yes | no | no |
| `full` | yes | yes | exact confirmation | destructive opt-in and exact confirmation |

The default is `read-only`. Permission overwrites, role permission changes, guild security settings, and blueprints containing those fields are privileged writes: they require `full` mode and a payload-bound confirmation, but not the separate destructive opt-in. Blueprint application never deletes resources. It creates or updates matching resources and tracks their Discord IDs in `.data/state.json` so reruns do not create duplicates.

## 1. Create the Discord operator

Create a dedicated application in the Discord Developer Portal, add a bot, and invite it only to the server you want to manage. Never use a personal/user token.

For the full tool set, the bot may need:

- View Channels, Read Message History, Send Messages, Add Reactions, Manage Messages, Manage Threads
- Manage Channels, Manage Roles
- Moderate Members, Kick Members, Ban Members
- Move Members, Mute Members, Deafen Members
- Manage Guild, View Audit Log, Create Events, Manage Events
- Pin Messages and Set Voice Channel Status for the corresponding features
- Speak, Use Soundboard, and Use External Sounds for soundboard playback
- Create Instant Invite, Manage Webhooks, Create Guild Expressions, and Manage Guild Expressions only if you use related operations

Indexed guild-message search additionally requires the privileged **Message Content** intent in the Discord Developer Portal. Without it, Discord returns `Missing Access`; other read tools continue to work.

`Administrator` is convenient but not required or recommended. Discord role hierarchy still applies: the operator can manage only roles and members below its highest role.

## 2. Install and configure

Requires Node.js 20.19 or newer and pnpm.

```powershell
git clone https://github.com/TheETR/Thee-Discord-MCP.git
cd Thee-Discord-MCP
pnpm install
Copy-Item .env.example .env
```

Open `.env` locally and set:

```dotenv
DISCORD_BOT_TOKEN=your_dedicated_bot_token
DISCORD_ALLOWED_GUILD_IDS=123456789012345678
DISCORD_ALLOWED_USER_IDS=
DISCORD_MODE=read-only
```

Leave `DISCORD_ALLOWED_USER_IDS` empty unless the bot should communicate with specific users. Add only comma-separated Discord user IDs whose one-to-one DM access you intend to permit. Group DMs and arbitrary recipients are rejected.

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
args = ["C:/path/to/Thee-Discord-MCP/dist/index.js"]
cwd = "C:/path/to/Thee-Discord-MCP"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Restart the client and export a snapshot before making changes. Review the channels, roles, forums, and permission overwrites while the server is still in `read-only` mode.

Once the snapshot looks right, set `DISCORD_MODE=safe-write`, restart the MCP server, and apply ordinary changes. Keep destructive mode disabled until a specific deletion or moderation action is needed.

## Blueprint workflow

`examples/elalem.blueprint.json` provides an English ELALEM support and community layout with restrained category styling, a welcome message, two forum templates, tags, staff privacy, and practical channel names.

See `docs/ELALEM.md` for the live-server handoff, current user-facing channel copy, and the remaining boundaries that require Discord's UI or another bot runtime.

See `docs/API_COVERAGE.md` for the full capability map, safety model, and deliberate boundaries.

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

Each destructive tool returns or documents the exact confirmation text it expects, such as `DELETE CHANNEL <id>`. High-fan-out operations such as bulk bans and pruning include a digest derived from the exact target set, so a confirmation cannot be reused for a different batch. Irreversible announcement crossposts and linked-role metadata replacement use the same full-mode gate. Return to `safe-write` or `read-only` afterward.

The raw REST tool treats every non-GET request as destructive. Its confirmation includes a SHA-256-derived digest of the exact request body, so a confirmation for one payload cannot authorize another. Absolute URLs, fragments, control characters, encoded path separators, dot segments, duplicate slashes, cross-guild body references, and unverified channel references are rejected before the request is sent.

## Discord platform boundaries

The server uses a bot token only. It does not automate user-only endpoints, self-bots, account sessions, or unsupported client APIs. For example, Discord's Server Profile **Traits** field is visible in the desktop client but its profile endpoint rejects bot tokens with `Bots cannot use this endpoint`; that field must currently be changed by a signed-in server administrator in Discord.

See [Discord API Coverage](docs/API_COVERAGE.md) for named surfaces and deliberate omissions, [Security Review and Roadmap](docs/SECURITY_REVIEW.md) for threat boundaries and remaining hardening work, and [ELALEM Server Handoff](docs/ELALEM.md) for the live server layout and runtime boundaries.

## Development

```powershell
pnpm typecheck
pnpm test
pnpm build
```

The server uses stdio, so stdout is reserved for MCP protocol traffic; operational messages go to stderr. Discord rate limits are handled by `@discordjs/rest`.

## License

MIT
