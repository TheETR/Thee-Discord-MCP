# Discord API Coverage

Thee Discord MCP groups related Discord REST operations into named tools. The current inventory is **49 MCP tools and 166 schema-declared operations**. Every top-level `action` choice counts as one operation; a single-purpose tool counts as one. The MCP handshake calculates and verifies both totals.

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
- Permission overwrites, role permission changes, guild-level security settings, and blueprints containing those fields are privileged writes. They require full mode and an exact payload-bound confirmation without enabling destructive actions.
- Deletions, crossposts, early poll termination, prune execution, bulk actions, metadata replacement, and other irreversible actions require full mode, destructive opt-in, and exact confirmation. Bulk confirmations include a digest of the exact target set.
- Dry-run is the default for write tools.
- Raw routes are canonicalized before authorization; ambiguous encodings, dot segments, duplicate separators, fragments, absolute URLs, and mismatched guild/channel IDs in request bodies are rejected.
- Raw-write confirmations include a digest of the exact request body.
- Sticker and soundboard uploads validate media type and decoded size before a request is sent.
- Webhook tokens and URLs are redacted from returned data.

## Deliberate boundaries

- Group DMs and arbitrary recipient discovery are not exposed. One-to-one DMs require an explicit local recipient allowlist.
- Guild prune execution and bulk bans require full mode, destructive opt-in, bulk limits, and an exact operation-specific confirmation.
- Application-command permission overrides are not included because Discord requires a user OAuth bearer token with a dedicated scope; the MCP stores only a bot token.
- Server Profile traits and game selections are user-only client settings. Discord's profile endpoint rejects bot tokens with `Bots cannot use this endpoint`, so they are intentionally not exposed.
- Playing a soundboard sound requires the bot to already be connected to the target voice channel and to have the required voice permissions.
- Indexed message search requires the privileged Message Content intent. Discord returns `Missing Access` when it is disabled.
- Creating a guild from a template is omitted because it escapes the configured guild boundary.
- User-account OAuth surfaces, social relationships, and user tokens are not supported. The server operates with a bot token only.
- The local blueprint state file is confined to the package directory, schema-validated on load, rejected when symlinked, and replaced atomically.
- Discord hierarchy, privileged intents, rate limits, and feature availability still apply.

## Verification

`pnpm check` runs typechecking, unit tests, a production build, and an MCP handshake that verifies the complete named tool inventory.
