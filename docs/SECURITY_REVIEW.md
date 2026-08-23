# Security Review and Roadmap

This review treats Thee Discord MCP as a privileged local operator, not a general Discord proxy. Tool count and endpoint breadth are useful only when every route, indirect target, stored identifier, and high-impact write remains inside an explicit authorization boundary.

## Protected assets

- The Discord bot token and webhook credentials
- Guild channels, roles, permissions, members, messages, and configuration
- Explicitly allowlisted one-to-one DM recipients
- Blueprint resource mappings in the local state file
- Audit-log attribution and dry-run plans used for operator review

## Trust boundaries

1. The MCP caller may provide malformed or adversarial tool arguments.
2. The local process environment supplies secrets, allowlists, and the active safety mode.
3. The state file is untrusted input when loaded from disk.
4. Discord REST responses and rate limits are external input.
5. A Discord snowflake in a request body is not authorized merely because the URL is scoped correctly.

## Current controls

- Guild calls require `DISCORD_ALLOWED_GUILD_IDS`; DMs use a separate empty-by-default user allowlist.
- Channel, webhook, invite, Stage, command, and DM ownership is verified before scoped operations.
- Raw routes are canonicalized before authorization. Absolute URLs, fragments, controls, backslashes, dot segments, encoded separators, duplicate separators, and trailing separators are rejected.
- Guild and channel identifiers nested in raw request bodies are revalidated.
- Raw writes are destructive and bind confirmation to a stable digest of the exact body.
- Ordinary, privileged, and destructive writes have separate gates. Permission overwrites, role permission changes, guild settings, and blueprints containing those fields require full mode and a payload-bound confirmation.
- High-fan-out prune and bulk-ban confirmations bind to their target set and respect the configured action ceiling.
- Webhook tokens, URLs, and uploaded data URIs are redacted from previews and results.
- Blueprint state paths stay inside the package directory. Loaded state is schema-validated, direct symlinks are rejected, and saves use a unique atomic replacement file.
- Write tools default to dry-run and attach audit reasons where Discord supports them.

## Residual work

### P1

- Add one-time confirmation nonces with expiry and consumption so an identical approved payload cannot be replayed later.
- Extend privileged classification to every policy-sensitive update, including AutoMod disablement, onboarding replacement, webhook lifecycle changes, application profiles, and role assignment to members.
- Add a blueprint execution journal with preconditions, per-action results, restart recovery, and a final applied-plan digest. Discord does not offer multi-resource transactions, so partial failure must be explicit and recoverable.
- Revalidate state-file parent directories against symlink or junction replacement immediately before saving.
- Bind named destructive confirmations consistently to all mutable parameters, not only the primary target.

### P2

- Emit structured redacted audit events with request IDs, operation family, guild, risk, duration, retry count, rate-limit bucket, and Discord audit-log reason.
- Add deterministic retry/failure tests for `429`, network timeouts, Discord `5xx`, malformed responses, and partial blueprint execution.
- Generate the public capability inventory from tool schemas instead of maintaining explanatory lists by hand.
- Add contract tests against recorded sanitized Discord responses for unstable or fast-moving endpoints.

### P3

- Publish signed release artifacts with provenance, checksums, an SBOM, and automated dependency review.
- Add a documented remote transport only after per-client authentication, authorization, rate limiting, secret storage, and deployment threat modeling exist.
- Maintain a reproducible capability benchmark that scores breadth, safety gates, schema clarity, dry-run quality, and recovery behavior rather than comparing tool counts alone.

## Release gate

A release is ready only when `pnpm check` passes on Windows and Linux, package contents contain no secrets or machine-specific paths, the MCP handshake matches the documented tool/operation inventory, and every new write surface has an explicit risk classification with targeted tests.
