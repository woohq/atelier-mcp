#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AtelierMcpServer } from "./server.js";
import { logger } from "../util/logger.js";

async function main() {
  const server = new AtelierMcpServer();
  const transport = new StdioServerTransport();

  await server.mcp.connect(transport);
  logger.info("Atelier MCP server running on stdio");

  await server.events.emit("server:started", { timestamp: Date.now() });

  // Graceful shutdown
  const shutdown = async () => {
    await server.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal error", { error: String(err) });
  process.exit(1);
});
