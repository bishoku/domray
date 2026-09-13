/**
 * session-tools.ts — domray_get_active_session tool
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { store } from "../session-store.js";
import { isExtensionConnected, broadcastAiAuditEvent } from "../ws-bridge.js";

export function registerSessionTools(server: McpServer): void {
  server.tool(
    "domray_get_active_session",
    "Returns the currently connected browser tab's URL, title, and telemetry status. Use this first to confirm the DOMRay extension is connected.",
    {},
    async () => {
      broadcastAiAuditEvent(
        "domray_get_active_session",
        {},
        "AI queried active browser session status",
      );

      const connected = isExtensionConnected();
      const session = store.activeSession;

      if (!connected) {
        return {
          content: [
            {
              type: "text",
              text: [
                "## DOMRay — Extension Disconnected",
                "",
                "The DOMRay Chrome extension is not connected to this MCP server.",
                "",
                "**Steps to connect:**",
                "1. Open Chrome and click the DOMRay extension icon or open the Side Panel.",
                "2. Click **⚡ Auto-Connect (1-Click)** to pair automatically.",
                "3. Ensure the active tab has tracing enabled.",
              ].join("\n"),
            },
          ],
        };
      }

      if (!session) {
        return {
          content: [
            {
              type: "text",
              text: [
                "## DOMRay — Tracing Not Started",
                "",
                "The DOMRay Chrome extension is connected via WebSocket, but no web page is currently being traced.",
                "",
                "**To start tracing:**",
                "1. Open your target web page in Chrome (e.g. `http://localhost:5173/`).",
                "2. In the DOMRay popup or Side Panel, click **▶ Start Tracing** (or **Attach**).",
              ].join("\n"),
            },
          ],
        };
      }

      const uptimeSec = Math.round((Date.now() - session.connectedAt) / 1000);
      const text = [
        "## DOMRay — Active Session",
        "",
        `- **URL:** ${session.url}`,
        `- **Title:** ${session.title}`,
        `- **Tab ID:** ${session.tabId}`,
        `- **Connected:** ${uptimeSec}s ago`,
        "",
        "### Telemetry Buffer",
        `- Errors captured: **${store.errors.size}**`,
        `- Network requests: **${store.network.size}**`,
        `- Breadcrumbs: **${store.breadcrumbs.size}**`,
        `- Last DOM snapshot: **${store.lastSnapshot ? new Date(store.lastSnapshot.timestamp).toISOString() : "none"}**`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    },
  );
}
