import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined)
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: {
    ...inheritedEnvironment,
    DISCORD_BOT_TOKEN: "smoke-test-token-not-used-for-network",
    DISCORD_ALLOWED_GUILD_IDS: "123456789012345678",
    DISCORD_MODE: "read-only"
  },
  stderr: "pipe"
});

const client = new Client({ name: "thee-discord-mcp-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 45) {
    throw new Error(`Expected 45 MCP tools, received ${tools.length}.`);
  }
  const requiredAdvancedTools = [
    "discord_capabilities",
    "discord_directory",
    "discord_reaction",
    "discord_webhook",
    "discord_invite",
    "discord_scheduled_event",
    "discord_forum_thread",
    "discord_voice_member",
    "discord_permission_overwrite",
    "discord_membership_screening",
    "discord_stage_instance",
    "discord_soundboard",
    "discord_sticker",
    "discord_poll",
    "discord_message_search",
    "discord_guild_template",
    "discord_application_command",
    "discord_widget"
  ];
  const availableNames = new Set(tools.map((tool) => tool.name));
  const missing = requiredAdvancedTools.filter((name) => !availableNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing advanced MCP tools: ${missing.join(", ")}`);
  }
  console.log(`MCP handshake passed; ${tools.length} tools discovered.`);
} finally {
  await client.close();
}
