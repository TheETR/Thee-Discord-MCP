#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig, packageRoot, redactConfig } from "./config.js";
import { DiscordClient } from "./discord.js";
import { StateStore } from "./state.js";
import { registerTools } from "./tools.js";

async function main() {
  const config = loadConfig();
  const client = new DiscordClient(config);
  const store = new StateStore(config.stateFile, packageRoot);
  await store.load();

  const server = new McpServer({
    name: "thee-discord-mcp",
    version: "0.1.0"
  });

  registerTools({ server, client, config, store });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout belongs exclusively to the MCP transport.
  console.error("TheeDiscordMCP connected over stdio", redactConfig(config));
}

main().catch((error) => {
  console.error("TheeDiscordMCP failed to start:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
