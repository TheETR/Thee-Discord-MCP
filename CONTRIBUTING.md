# Contributing

Thanks for helping improve Thee Discord MCP.

## Before opening a change

- Search existing issues and pull requests.
- Keep the bot-token, guild allowlist, and user allowlist boundaries intact.
- Do not add self-bot behavior, personal user tokens, or undocumented account-session automation.
- Add a named operation when a Discord surface is stable and broadly useful; keep closely related actions grouped in one tool.

## Local verification

Use Node.js 20.19 or newer and pnpm 11:

```powershell
pnpm install
pnpm check
```

Tests should cover authorization boundaries, dry-run output, confirmation behavior, redaction, and Discord payload shaping where relevant. Update the README inventory and smoke-test totals whenever the public tool schema changes.

## Pull requests

Describe the user-facing behavior, safety impact, tests performed, and any Discord API limitations. Keep secrets, server IDs, local paths, and private operational details out of commits, fixtures, screenshots, and issue reports.
