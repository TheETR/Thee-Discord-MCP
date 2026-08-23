# ELALEM Server Handoff

This document records the intended public experience for the ELALEM Discord server, what Thee Discord MCP can maintain, and what still needs a manual Discord or bot-runtime change.

## Member journey

New members should be able to understand the server without reading a wall of text:

1. Read `#start-here` for the short server map and community basics.
2. Use `#getting-started` for a short first-session checklist.
3. Talk naturally in `#emsali-chat`; no `/ask` command should be required once the EMSALI runtime is enabled for that channel.
4. Use `#command-chat` for slash commands and utilities.
5. Use `#support-desk` for help and `#bug-reports` for reproducible issues; its Post Guidelines contain the report format.
6. Use `#feature-requests` for one focused idea per forum post.
7. Follow `#announcements`, `#changelog`, and `#status` for official updates.

The read-only guide channels use concise pinned plain-Markdown messages. They deliberately avoid embeds, repeated cards, and edited-looking message history. `#roles-and-access` explains onboarding notification choices and special access roles without duplicating the support forum.

## Community and voice layout

`#emsali-chat` and `#command-chat` belong inside the ELALEM category with the other product channels. Community chat remains separate from command traffic. Music commands should go to `#music-commands`, with public voice rooms grouped together and a private staff voice room under the staff section.

Recommended public voice set:

- Community Lounge
- Music Room
- Gaming Room

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

A live API read on 2026-08-23 confirmed that all eight Access-page rules are present. Thee Discord MCP can read and replace those rules with `discord_membership_screening`.

Discord marks the Membership Screening API as unstable and has removed the edit contract from its public documentation. The currently installed Discord API v10 types still define GET and PATCH, and live GET access is verified. For that reason, updates default to dry-run and require `full` mode, destructive opt-in, and the exact confirmation `UPDATE SERVER RULES <guild-id>`. Always verify the result in Discord's Access screen.

## Links and project context

The FAQ should link to [TheETR on GitHub](https://github.com/TheETR) for ELALEM's Terms of Service, Privacy Policy, and public releases. The only project that needs to be called out as directly related to this server-management work is [Thee Discord MCP](https://github.com/TheETR/Thee-Discord-MCP).

Keep the About section short and written in first person. Keep it above the public-tools note, and avoid turning the FAQ into a project catalogue.

## What Thee Discord MCP can maintain

- Guild settings, roles, colors, ordering, and member role assignments
- Categories and text, announcement, voice, stage, forum, and media channels
- Permission overwrites, channel order, forum tags, and pinned guide messages
- Member search, moderation, reactions, invites, webhooks, scheduled events, and voice-member controls
- Membership Screening reads and guarded Server Rules replacement
- AutoMod, onboarding, welcome screen, emojis, audit-log reads, and bot profile data
- Idempotent blueprint planning and application with dry-run previews
- Allowlist-scoped raw REST access for newly released Discord endpoints

All writes are protected by the configured safety mode. Destructive operations additionally require full mode, destructive opt-in, and an exact confirmation string.

## Remaining limitations

- **Membership Screening stability:** rules can be read and changed, but Discord labels this API unstable and no longer publishes its edit contract. Use dry-run, exact confirmation, and a final UI check.
- **EMSALI direct conversation:** creating and describing `#emsali-chat` is a guild change; responding to ordinary messages requires the EMSALI bot runtime to subscribe to that channel and have Message Content access where Discord requires it.
- **Music playback:** Thee Discord MCP can create the channel and voice layout, but playback, queues, and audio streaming belong to a music bot/runtime.
- **Voice audio:** the MCP can move, disconnect, mute, or deafen members; it does not join voice or transmit audio.
- **Server Profile traits:** Discord exposes Traits in the signed-in client, but its profile endpoint rejects bot tokens with `Bots cannot use this endpoint`. Traits must currently be selected manually in Server Settings.
- **Private messages:** one-to-one DM tools are available only for recipients explicitly listed in `DISCORD_ALLOWED_USER_IDS`. The list is empty by default; group DMs and arbitrary recipient discovery remain unavailable.
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
7. Read Server Rules with `discord_membership_screening`, preview any update, then confirm the final text in Discord's Access screen.
8. Verify that ordinary messages in `#emsali-chat` reach EMSALI and that slash commands remain contained in `#command-chat`.
9. Review Server Profile Traits manually because Discord does not permit bot-token access to that setting.
