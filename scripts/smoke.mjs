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
  if (tools.length !== 49) {
    throw new Error(`Expected 49 MCP tools, received ${tools.length}.`);
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
    "discord_widget",
    "discord_guild_operations",
    "discord_channel_operations",
    "discord_dm",
    "discord_application_assets"
  ];
  const availableNames = new Set(tools.map((tool) => tool.name));
  const missing = requiredAdvancedTools.filter((name) => !availableNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing advanced MCP tools: ${missing.join(", ")}`);
  }
  const declaredOperations = tools.reduce((total, tool) => {
    const actionSchema = tool.inputSchema?.properties?.action;
    return total + (Array.isArray(actionSchema?.enum) ? actionSchema.enum.length : 1);
  }, 0);
  if (declaredOperations !== 166) {
    throw new Error(`Expected 166 schema-declared operations, received ${declaredOperations}.`);
  }
  console.log(`MCP handshake passed; ${tools.length} tools and ${declaredOperations} schema-declared operations discovered.`);
} finally {
  await client.close();
}
