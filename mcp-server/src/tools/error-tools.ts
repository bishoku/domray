/**
 * error-tools.ts — domray_get_latest_error tool
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { store } from "../session-store.js";
import { broadcastAiAuditEvent } from "../ws-bridge.js";

export function registerErrorTools(server: McpServer): void {
  server.tool(
    "domray_get_latest_error",
    "Returns the most recent unhandled runtime exception from the browser, including its stack trace and the user actions (breadcrumbs) that led up to it.",
    {
      include_breadcrumbs: z
        .boolean()
        .default(true)
        .describe("Include the last user interactions that preceded the error."),
    },
    async ({ include_breadcrumbs }) => {
      const errors = store.errors.toArray();
      const latest = errors[errors.length - 1];

      broadcastAiAuditEvent(
        "domray_get_latest_error",
        { include_breadcrumbs },
        latest
          ? `AI inspected latest error: "${latest.message.slice(0, 80)}"`
          : "AI checked for runtime errors (buffer empty)",
      );

      if (errors.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No errors captured yet. Trigger an exception on the page and try again.",
            },
          ],
        };
      }

      // Latest error is the last element
      const err = errors[errors.length - 1]!;
      const ts = new Date(err.timestamp).toISOString();

      const lines: string[] = [
        "## Latest Runtime Error",
        "",
        `- **Time:** ${ts}`,
        `- **Message:** \`${err.message}\``,
      ];

      if (err.url) lines.push(`- **Source:** ${err.url}:${err.lineNumber ?? "?"}:${err.columnNumber ?? "?"}`);

      if (err.stack) {
        lines.push("", "### Stack Trace", "", "```", err.stack, "```");
      }

      if (include_breadcrumbs) {
        const crumbs = store.breadcrumbs.toArray();
        // Show breadcrumbs that happened before the error
        const relevant = crumbs.filter((b) => b.timestamp <= err.timestamp);
        const last = relevant.slice(-15); // last 15 user interactions

        if (last.length > 0) {
          lines.push("", "### User Actions Leading to Error (Causal Breadcrumbs)");
          for (const b of last) {
            const relMs = err.timestamp - b.timestamp;
            const relStr = relMs < 1000 ? `${relMs}ms` : `${(relMs / 1000).toFixed(1)}s`;
            const icon = b.type === "click" ? "🖱️" : b.type === "submit" ? "📤" : b.type === "input" ? "⌨️" : b.type === "navigation" ? "🧭" : "📝";
            lines.push(`- ${icon} **[${b.type}]** \`-${relStr}\` — ${b.description}${b.selector ? ` (\`${b.selector}\`)` : ""}`);
          }
        } else {
          lines.push("", "_No user action breadcrumbs captured before this error._");
        }

        // Also check if there were console warnings right before the crash
        const recentLogs = store.consoleLogs.toArray().filter((c) => c.timestamp <= err.timestamp && (c.type === "warn" || c.type === "error"));
        const lastLogs = recentLogs.slice(-5);
        if (lastLogs.length > 0) {
          lines.push("", "### Preceding Console Warnings/Errors");
          for (const l of lastLogs) {
            const relMs = err.timestamp - l.timestamp;
            const relStr = relMs < 1000 ? `${relMs}ms` : `${(relMs / 1000).toFixed(1)}s`;
            lines.push(`- ⚠️ **[console.${l.type}]** \`-${relStr}\` — ${l.text}`);
          }
        }
      }

      // Historical errors summary
      if (errors.length > 1) {
        lines.push("", `---`, `_${errors.length - 1} earlier error(s) also in buffer._`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
