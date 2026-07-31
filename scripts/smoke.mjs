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
  if (tools.length !== 25) {
    throw new Error(`Expected 25 MCP tools, received ${tools.length}.`);
  }
  console.log(`MCP handshake passed; ${tools.length} tools discovered.`);
} finally {
  await client.close();
}
