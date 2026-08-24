# Changelog

This project follows Semantic Versioning. Public release notes describe externally observable behavior, safety boundaries, and migration requirements.

## Unreleased

### Added

- Public-release readiness audit for the application authenticated by the active bot token.
- Searchable grouped capability discovery and three static MCP resources.
- Handshake-generated capability inventory with schema sizes, SHA-256 schema digests, annotations, and CI drift detection.
- Configurable bounded Discord request timeout and retry policy.
- Blueprint execution journals, restart-aware recovery, and deterministic message nonces.
- CodeQL, Dependabot configuration, and tag-driven GitHub release evidence with checksums and a CycloneDX SBOM.

### Security

- One-time expiring confirmations bind high-impact writes to their exact payload and target set.
- Snapshot and named webhook outputs redact webhook credentials recursively.
- Blueprint state writes are confined to the package directory and reject symlink or junction escape.

## 0.1.0

- Initial public preview of the bot-token-only, allowlist-scoped Discord administration MCP server.
