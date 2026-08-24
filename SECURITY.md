# Security model

Thee Discord MCP is a privileged operator. Treat its bot token like a password.

- Use a dedicated Discord application and bot account. Never use a user token or self-bot.
- Keep `.env` local. It is ignored by Git and must never be committed, pasted into chat, or placed in a blueprint.
- Restrict `DISCORD_ALLOWED_GUILD_IDS` to the exact guilds the operator may touch.
- Start in `read-only`, inspect a snapshot, then move to `safe-write` for normal changes.
- Permission overwrites, role permissions, guild security settings, and privileged blueprints require `full` plus a payload-bound confirmation even though they do not require destructive opt-in.
- Deletions and raw write requests require `full`, the destructive opt-in, and an exact per-call confirmation.
- Raw request paths are canonicalized before authorization, indirect guild/channel IDs are revalidated, and write confirmations bind to the exact payload digest.
- Give the bot only the Discord permissions the intended tools need. Its highest role must remain below owner/admin roles.
- Review Discord's audit log after high-impact changes. The server adds an audit reason prefix wherever Discord supports it.
- Keep the generated `.data/state.json` private. It contains resource IDs, not the bot token, and supports idempotent blueprint runs. State paths are confined to the package directory; symlinked or malformed state files are rejected.

If the token is exposed, reset it immediately in the Discord Developer Portal and update the local `.env`.
