# ELALEM Server Handoff

This document records the intended public experience for the ELALEM Discord server, what TheeDiscordMCP can maintain, and what still needs a manual Discord or bot-runtime change.

## Member journey

New members should be able to understand the server without reading a wall of text:

1. Read `#start-here` for the map, core rules, and safety notes.
2. Use `#getting-started` for a short first-session checklist.
3. Talk naturally in `#emsali-chat`; no `/ask` command should be required once the EMSALI runtime is enabled for that channel.
4. Use `#command-chat` for slash commands and utilities.
5. Use `#support-desk` for help, `#reporting-bugs` before opening a report, and `#bug-reports` for the report itself.
6. Use `#feature-requests` for one focused idea per forum post.
7. Follow `#announcements`, `#changelog`, and `#status` for official updates.

The three read-only guide channels use one pinned plain-Markdown message each. They deliberately avoid embeds, repeated cards, and edited-looking message history.

## Community and voice layout

`#emsali-chat` and `#command-chat` belong inside the ELALEM category with the other product channels. Community chat remains separate from command traffic. Music commands should go to `#music-commands`, with public voice rooms grouped together and a private staff voice room under the staff section.

Recommended public voice set:

- Lounge
- Gaming
- Study / Focus
- Music Room

The visible voice category should follow the fifth public section so members see a natural progression into section six. Staff-only channels stay permission-restricted even if their category is positioned nearby.

## Rules and access

The server-side rules should cover:

- Respect people; no harassment, discrimination, threats, or deliberate disruption.
- Keep posts in the correct channel and follow forum prompts.
- No spam, scams, malicious files, illegal content, or unsolicited promotion.
- Never share passwords, bot tokens, API keys, private contact details, or other sensitive data.
- Critique ideas and products, not people.
- Discord's Terms of Service and Community Guidelines apply.
- Staff may remove harmful content or restrict access when needed to protect the community.

As of the supplied Access screenshot, the server is invite-only and Onboarding is enabled, but Discord's **Server Rules** switch is still disabled and its rules list is empty. The public bot REST API used by this project does not expose that Access-page rules editor, so this final switch and the rule entries must be completed in Discord's server settings.

## Links and project context

The FAQ should link to [TheETR on GitHub](https://github.com/TheETR) for ELALEM's Terms of Service, Privacy Policy, and public releases. The only project that needs to be called out as directly related to this server-management work is [TheeDiscordMCP](https://github.com/TheETR/TheeDiscordMCP).

Keep the About section short and written in first person. Keep it above the public-tools note, and avoid turning the FAQ into a project catalogue.

## What TheeDiscordMCP can maintain

- Guild settings, roles, colors, ordering, and member role assignments
- Categories and text, announcement, voice, stage, forum, and media channels
- Permission overwrites, channel order, forum tags, and pinned guide messages
- Member search, moderation, reactions, invites, webhooks, scheduled events, and voice-member controls
- AutoMod, onboarding, welcome screen, emojis, audit-log reads, and bot profile data
- Idempotent blueprint planning and application with dry-run previews
- Allowlist-scoped raw REST access for newly released Discord endpoints

All writes are protected by the configured safety mode. Destructive operations additionally require full mode, destructive opt-in, and an exact confirmation string.

## Remaining limitations

- **Access-page Server Rules:** must be enabled and entered manually in Discord.
- **EMSALI direct conversation:** creating and describing `#emsali-chat` is a guild change; responding to ordinary messages requires the EMSALI bot runtime to subscribe to that channel and have Message Content access where Discord requires it.
- **Music playback:** TheeDiscordMCP can create the channel and voice layout, but playback, queues, and audio streaming belong to a music bot/runtime.
- **Voice audio:** the MCP can move, disconnect, mute, or deafen members; it does not join voice or transmit audio.
- **Private messages:** DM tooling is intentionally not exposed because the current security boundary is a guild allowlist, not a user-consent allowlist.
- **Webhook credentials:** webhook tokens are never returned in tool results. Execution requires the caller to supply the token for that call; it is not stored by the MCP.
- **Discord hierarchy:** the operator cannot manage roles or members at or above its highest role, regardless of requested permissions.
- **Transport:** the public server currently uses local stdio. A remote HTTP deployment would need authentication, per-client authorization, rate limiting, and secret storage before it is safe to expose.
- **Human verification:** Discord UI changes, onboarding flow order, mobile rendering, role colors, and voice-category visibility should still receive a final member-view check.

## Release checklist

1. Export a fresh snapshot in `read-only` mode.
2. Review the plan with `dryRun: true`.
3. Apply ordinary changes in `safe-write` mode.
4. Use `full` mode only for one reviewed destructive action, then turn it off.
5. Re-export the server and verify channel order, permissions, pins, forum tags, and role hierarchy.
6. Test the onboarding flow with a non-staff account.
7. Enable Server Rules manually and confirm they appear before a new member can interact.
8. Verify that ordinary messages in `#emsali-chat` reach EMSALI and that slash commands remain contained in `#command-chat`.
