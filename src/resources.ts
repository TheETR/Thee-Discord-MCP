import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { capabilityFamilies } from "./advanced-tools.js";

function jsonResource(uri: URL, value: unknown) {
  return {
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: `${JSON.stringify(value, null, 2)}\n`
    }]
  };
}

export function registerResources(server: McpServer) {
  server.registerResource(
    "discord-capability-index",
    "discord://capabilities",
    {
      title: "Discord capability index",
      description: "Grouped operation index for progressive capability discovery without a Discord network request.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri, {
      inventory: { mcpTools: 49, schemaDeclaredOperations: 168 },
      grouping: "Related Discord operations share an action-based MCP tool.",
      families: capabilityFamilies
    })
  );

  server.registerResource(
    "discord-safety-model",
    "discord://safety",
    {
      title: "Discord safety model",
      description: "Static safety-mode and authorization boundary reference.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri, {
      defaultMode: "read-only",
      modes: {
        "read-only": "Reads only; all writes are rejected.",
        "safe-write": "Ordinary writes only; privileged and destructive writes are rejected.",
        full: "Privileged writes require one-time confirmation; destructive writes additionally require explicit destructive opt-in."
      },
      boundaries: [
        "Every guild is checked against DISCORD_ALLOWED_GUILD_IDS.",
        "One-to-one DMs use a separate empty-by-default DISCORD_ALLOWED_USER_IDS boundary.",
        "Indirect resource ownership is verified before scoped operations.",
        "Confirmations are payload-bound, expiring, one-time, and process-local.",
        "Raw REST writes are treated as destructive."
      ]
    })
  );

  server.registerResource(
    "discord-public-release-checklist",
    "discord://public-release",
    {
      title: "Discord public release checklist",
      description: "Automated and manual gates for releasing the authenticated Discord application publicly.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri, {
      automatedTool: {
        name: "discord_health",
        arguments: { action: "release_readiness", guildId: "<allowlisted guild ID>" }
      },
      automatedChecks: [
        "current token/application identity",
        "public bot installation",
        "Terms of Service and Privacy Policy URLs",
        "bot and applications.commands install scopes",
        "visible Message Content application flags",
        "guild and global command registration",
        "selected-guild membership",
        "feature-dependent role permissions"
      ],
      manualChecks: [
        "normal-member onboarding and permissions",
        "direct chat and command-channel containment",
        "music and voice flow",
        "mobile role colors and layout",
        "Server Profile traits",
        "Developer Portal intent and installation review"
      ],
      boundary: "The audit covers only the application authenticated by the active bot token."
    })
  );
}
