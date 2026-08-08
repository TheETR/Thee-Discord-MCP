# Discord API Coverage

TheeDiscordMCP groups related Discord REST operations into named tools. The current inventory is **49 MCP tools and 166 schema-declared operations**. Every top-level `action` choice counts as one operation; a single-purpose tool counts as one. The MCP handshake calculates and verifies both totals.

## Administration surfaces

| Area | Named coverage |
|---|---|
| Guild and safety | Guild settings and preview, Membership Screening, onboarding, welcome screen, AutoMod, audit log, incidents, prune preview/run, bans and bulk bans |
| Structure | Channels, categories, ordering, permission overwrites, roles and member counts, forum tags, public/private threads |
| Community | Messages, indexed search, crossposts, reactions and cleanup, polls, current paginated pins, invites, scheduled events |
| Voice | Voice-member state, moves, disconnects, voice status, Stage instances, soundboard, guild voice regions |
| Expressions | Guild and application emojis, stickers, soundboard sounds |
| Integrations | Webhooks, integrations, guild/global application commands, linked-role metadata, guild templates |
| Controlled DMs | One-to-one DM open/read/send/edit/delete for explicitly allowlisted recipients only |
| Operations | Snapshots, dry-run plans, idempotent blueprints, scoped raw REST |

## Safety model

- Every guild operation is restricted to `DISCORD_ALLOWED_GUILD_IDS`.
- Direct-message operations are separately restricted to `DISCORD_ALLOWED_USER_IDS`, which is empty by default; the recipient is reverified from the DM channel before every operation.
- Read-only mode blocks all writes.
- Safe-write mode permits ordinary creation and updates.
- Deletions, crossposts, early poll termination, prune execution, bulk actions, metadata replacement, and other irreversible actions require full mode, destructive opt-in, and exact confirmation. Bulk confirmations include a digest of the exact target set.
- Dry-run is the default for write tools.
- Sticker and soundboard uploads validate media type and decoded size before a request is sent.
- Webhook tokens and URLs are redacted from returned data.

## Deliberate boundaries

- Group DMs and arbitrary recipient discovery are not exposed. One-to-one DMs require an explicit local recipient allowlist.
- Guild prune execution and bulk bans require full mode, destructive opt-in, bulk limits, and an exact operation-specific confirmation.
- Application-command permission overrides are not included because Discord requires a user OAuth bearer token with a dedicated scope; the MCP stores only a bot token.
- Playing a soundboard sound requires the bot to already be connected to the target voice channel and to have the required voice permissions.
- Indexed message search requires the privileged Message Content intent. Discord returns `Missing Access` when it is disabled.
- Creating a guild from a template is omitted because it escapes the configured guild boundary.
- User-account OAuth surfaces, social relationships, and user tokens are not supported. The server operates with a bot token only.
- Discord hierarchy, privileged intents, rate limits, and feature availability still apply.

## Verification

`pnpm check` runs typechecking, unit tests, a production build, and an MCP handshake that verifies the complete named tool inventory.
