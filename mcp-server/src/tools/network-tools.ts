/**
 * network-tools.ts — domray_get_network_timeline tool
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { store } from "../session-store.js";
import { broadcastAiAuditEvent } from "../ws-bridge.js";

export function registerNetworkTools(server: McpServer): void {
  server.tool(
    "domray_get_network_timeline",
    "Returns recent HTTP requests captured from the active tab. Useful for identifying failed API calls (4xx/5xx) or slow requests around the time of an error.",
    {
      failed_only: z
        .boolean()
        .default(true)
        .describe("When true, only returns requests with HTTP status >= 400 or those that failed to complete."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of requests to return (newest first)."),
    },
    async ({ failed_only, limit }) => {
      let entries = store.network.toArray();

      broadcastAiAuditEvent(
        "domray_get_network_timeline",
        { failed_only, limit },
        `AI inspected network timeline (failed_only: ${failed_only}, limit: ${limit})`,
      );

      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No network requests captured yet. Ensure the extension is connected and the page has made HTTP requests.",
            },
          ],
        };
      }

      if (failed_only) {
        entries = entries.filter(
          (e) => e.failed || (e.status !== undefined && e.status >= 400),
        );
      }

      // Newest first, then limit
      entries = entries.reverse().slice(0, limit);

      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: failed_only
                ? "No failed requests captured. All requests completed successfully (or none have been captured yet)."
                : "No network requests in buffer.",
            },
          ],
        };
      }

      const header = failed_only
        ? "## Failed Network Requests"
        : "## Network Timeline";
      const lines: string[] = [header, ""];

      for (const req of entries) {
        const ts = new Date(req.timestamp).toISOString();
        const statusStr = req.failed
          ? `❌ FAILED (${req.failureReason ?? "unknown"})`
          : req.status !== undefined
            ? `${req.status >= 400 ? "❌" : "✅"} ${req.status} ${req.statusText ?? ""}`
            : "⏳ Pending";

        const durationStr = req.durationMs !== undefined
          ? `${req.durationMs}ms`
          : "—";

        lines.push(
          `### ${req.method} ${req.url}`,
          `- **Status:** ${statusStr}`,
          `- **Time:** ${ts}`,
          `- **Duration:** ${durationStr}`,
        );

        // Show any non-masked request headers (masking done at edge)
        const relevantHeaders = Object.entries(req.requestHeaders)
          .filter(([k]) =>
            ["content-type", "accept", "x-request-id", "x-correlation-id"].includes(k.toLowerCase()),
          );
        if (relevantHeaders.length > 0) {
          lines.push("- **Headers:**");
          for (const [k, v] of relevantHeaders) {
            lines.push(`  - \`${k}: ${v}\``);
          }
        }

        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
