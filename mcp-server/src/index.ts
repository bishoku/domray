#!/usr/bin/env node
/**
 * index.ts — DOMRay MCP Server entrypoint
 *
 * Starts:
 *   1. WebSocket bridge (listens for Chrome Extension telemetry)
 *   2. MCP server over stdio (serves AI agents via JSON-RPC)
 *
 * CRITICAL: process.stdout is owned by the MCP stdio transport.
 * All logging MUST use console.error() → stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { generateAndPersistToken, cleanupToken } from "./security.js";
import { startWsBridge } from "./ws-bridge.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerErrorTools } from "./tools/error-tools.js";
import { registerNetworkTools } from "./tools/network-tools.js";
import { registerDomTools } from "./tools/dom-tools.js";
import { registerFrameworkTools } from "./tools/framework-tools.js";
import { registerTimelineTools } from "./tools/timeline-tools.js";
import { registerConsoleTools } from "./tools/console-tools.js";
import { registerStorageTools } from "./tools/storage-tools.js";
import { registerTestTools } from "./tools/test-tools.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Optional fixed Chrome Extension ID.
 * If unset, dynamic auto-pairing will be used on first connection.
 */
const EXTENSION_ID = process.env["DOMRAY_EXTENSION_ID"] ?? "UNSET_EXTENSION_ID";

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.error("[DOMRay] Starting MCP server v0.1.0");

  // 1. Generate session token and persist to ~/.domray/session.token
  const sessionToken = generateAndPersistToken();

  // 2. Start WebSocket bridge for Extension telemetry
  startWsBridge(sessionToken, EXTENSION_ID);

  // 3. Create MCP server
  const server = new McpServer({
    name: "domray",
    version: "0.1.0",
  });

  // 4. Register tools
  registerSessionTools(server);
  registerErrorTools(server);
  registerNetworkTools(server);
  registerDomTools(server);
  registerFrameworkTools(server);
  registerTimelineTools(server);
  registerConsoleTools(server);
  registerStorageTools(server);
  registerTestTools(server);

  // 5. Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[DOMRay] MCP server ready. Waiting for AI agent connection...");
  console.error("[DOMRay] Paste the token above into the DOMRay Chrome extension popup.");

  if (EXTENSION_ID === "UNSET_EXTENSION_ID") {
    console.error(
      "[DOMRay] Auto-pairing mode active (DOMRAY_EXTENSION_ID unset). " +
        "Click '⚡ Auto-Connect' in Chrome extension popup to pair automatically.",
    );
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGINT", () => {
  console.error("[DOMRay] Shutting down (SIGINT)");
  cleanupToken();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("[DOMRay] Shutting down (SIGTERM)");
  cleanupToken();
  process.exit(0);
});

process.on("exit", () => {
  cleanupToken();
});

main().catch((err) => {
  console.error("[DOMRay] Fatal error:", err);
  cleanupToken();
  process.exit(1);
});
