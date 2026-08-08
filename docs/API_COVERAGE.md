# Discord API Coverage

TheeDiscordMCP groups related Discord REST operations into named tools. This keeps common workflows discoverable while retaining a scoped raw request for newly released endpoints.

## Administration surfaces

| Area | Named coverage |
|---|---|
| Guild and safety | Guild settings, Membership Screening, onboarding, welcome screen, AutoMod, audit log, widget |
| Structure | Channels, categories, ordering, permission overwrites, roles, forum tags, threads |
| Community | Messages, search, reactions, polls, pins, invites, scheduled events |
| Voice | Voice-member state, moves, disconnects, Stage instances, soundboard |
| Expressions | Emojis, stickers, soundboard sounds |
| Integrations | Webhooks, guild application commands, guild templates |
| Operations | Snapshots, dry-run plans, idempotent blueprints, scoped raw REST |

## Safety model

- Every guild operation is restricted to `DISCORD_ALLOWED_GUILD_IDS`.
- Read-only mode blocks all writes.
- Safe-write mode permits ordinary creation and updates.
- Deletions, early poll termination, bulk command replacement, and other irreversible actions require full mode, destructive opt-in, and exact confirmation.
- Dry-run is the default for write tools.
- Sticker and soundboard uploads validate media type and decoded size before a request is sent.
- Webhook tokens and URLs are redacted from returned data.

## Deliberate boundaries

- Direct-message automation is not exposed because a guild allowlist does not establish user consent.
- Member pruning is not exposed as a named tool because one request can remove many accounts. It remains possible only through the explicitly confirmed raw route in full mode.
- Application-command permission overrides are not included because Discord requires a user OAuth bearer token with a dedicated scope; the MCP stores only a bot token.
- Playing a soundboard sound requires the bot to already be connected to the target voice channel and to have the required voice permissions.
- Indexed message search requires the privileged Message Content intent. Discord returns `Missing Access` when it is disabled.
- Creating a guild from a template is omitted because it escapes the configured guild boundary.
- Discord hierarchy, privileged intents, rate limits, and feature availability still apply.

## Verification

`pnpm check` runs typechecking, unit tests, a production build, and an MCP handshake that verifies the complete named tool inventory.
