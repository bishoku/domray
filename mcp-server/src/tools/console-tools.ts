/**
 * console-tools.ts — domray_get_console_logs tool
 *
 * Exposes browser console streams (log, info, warn, error, debug) captured via CDP
 * to AI coding agents, filterable by level or search keyword.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { store } from "../session-store.js";
import { broadcastAiAuditEvent } from "../ws-bridge.js";

export function registerConsoleTools(server: McpServer): void {
  server.tool(
    "domray_get_console_logs",
    "Returns recent browser console log messages (console.log, console.warn, console.error, console.info) captured from the attached web page. Filterable by log level and text query.",
    {
      level: z
        .enum(["all", "error", "warn", "info", "log"])
        .default("all")
        .describe("Filter by minimum severity or specific console level."),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(30)
        .describe("Maximum number of console messages to return."),
      search: z
        .string()
        .optional()
        .describe("Optional case-insensitive text to search within console log messages."),
    },
    async ({ level, limit, search }) => {
      let logs = store.consoleLogs.toArray();

      if (level !== "all") {
        logs = logs.filter((l) => l.type === level);
      }

      if (search) {
        const q = search.toLowerCase();
        logs = logs.filter((l) => l.text.toLowerCase().includes(q));
      }

      const recent = logs.slice(-limit);

      broadcastAiAuditEvent(
        "domray_get_console_logs",
        { level, limit, search },
        `AI inspected console logs (${recent.length} messages, filter: ${level})`
      );

      if (recent.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No console messages found matching level="${level}"${search ? ` and search="${search}"` : ""}.`,
            },
          ],
        };
      }

      const lines: string[] = [
        `## Browser Console Logs (${recent.length} messages)`,
        "",
      ];

      for (const item of recent) {
        const ts = new Date(item.timestamp).toISOString().slice(11, 23);
        const badge =
          item.type === "error"
            ? "🔴 `[ERROR]`"
            : item.type === "warn"
            ? "⚠️ `[WARN]`"
            : item.type === "info"
            ? "ℹ️ `[INFO]`"
            : "💬 `[LOG]`";

        lines.push(`- **${ts}** ${badge} ${item.text}`);
        if (item.url) {
          lines.push(`  ↳ _${item.url}:${item.lineNumber ?? "?"}_`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
