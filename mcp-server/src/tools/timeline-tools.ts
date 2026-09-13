/**
 * timeline-tools.ts — domray_get_flow_timeline tool
 *
 * Interleaves user action breadcrumbs (clicks, inputs, submits, route changes),
 * network requests, console logs, and runtime exceptions into a single
 * chronological timeline for deep causal flow and silent bug investigation.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { store } from "../session-store.js";
import { broadcastAiAuditEvent } from "../ws-bridge.js";

interface TimelineItem {
  timestamp: number;
  category: "user_action" | "network" | "console" | "error";
  icon: string;
  summary: string;
  detail?: string;
}

export function registerTimelineTools(server: McpServer): void {
  server.tool(
    "domray_get_flow_timeline",
    "Returns a unified chronological event timeline (user interactions, API network calls, console logs, and runtime exceptions). Ideal for investigating user journeys, causality, and logic bugs that do not throw uncaught exceptions.",
    {
      limit: z
        .number()
        .min(5)
        .max(100)
        .default(30)
        .describe("Maximum number of events to return in the chronological timeline."),
      include_network: z
        .boolean()
        .default(true)
        .describe("Include HTTP network requests in the timeline."),
      include_console: z
        .boolean()
        .default(true)
        .describe("Include browser console logs and warnings in the timeline."),
      failed_network_only: z
        .boolean()
        .default(false)
        .describe("Only include failed (HTTP >= 400 or network error) requests."),
    },
    async ({ limit, include_network, include_console, failed_network_only }) => {
      const items: TimelineItem[] = [];

      // 1. User Action Breadcrumbs
      for (const b of store.breadcrumbs.toArray()) {
        const icon =
          b.type === "click"
            ? "🖱️"
            : b.type === "submit"
            ? "📤"
            : b.type === "input"
            ? "⌨️"
            : b.type === "navigation"
            ? "🧭"
            : "📝";
        items.push({
          timestamp: b.timestamp,
          category: "user_action",
          icon,
          summary: `[${b.type}] ${b.description}`,
          detail: b.selector ? `Target: ${b.selector}` : undefined,
        });
      }

      // 2. Network Requests
      if (include_network) {
        for (const n of store.network.toArray()) {
          const isFailed = n.failed || (n.status !== undefined && n.status >= 400);
          if (failed_network_only && !isFailed) continue;

          const icon = isFailed ? "❌" : "🌐";
          const statusStr = n.failed
            ? `FAILED (${n.failureReason ?? "error"})`
            : `${n.status ?? "pending"} ${n.statusText ?? ""}`;
          const durationStr = n.durationMs !== undefined ? ` (${n.durationMs}ms)` : "";

          items.push({
            timestamp: n.timestamp,
            category: "network",
            icon,
            summary: `[network] ${n.method} ${n.url} -> ${statusStr}${durationStr}`,
          });
        }
      }

      // 3. Console Logs
      if (include_console) {
        for (const c of store.consoleLogs.toArray()) {
          const icon =
            c.type === "error"
              ? "🔴"
              : c.type === "warn"
              ? "⚠️"
              : c.type === "info"
              ? "ℹ️"
              : "💬";
          items.push({
            timestamp: c.timestamp,
            category: "console",
            icon,
            summary: `[console.${c.type}] ${c.text.slice(0, 150)}`,
            detail: c.url ? `Source: ${c.url}:${c.lineNumber ?? "?"}` : undefined,
          });
        }
      }

      // 4. Runtime Exceptions
      for (const e of store.errors.toArray()) {
        items.push({
          timestamp: e.timestamp,
          category: "error",
          icon: "💥",
          summary: `[EXCEPTION] ${e.message}`,
          detail: e.url ? `Location: ${e.url}:${e.lineNumber ?? "?"}` : undefined,
        });
      }

      // Sort chronologically ascending
      items.sort((a, b) => a.timestamp - b.timestamp);

      // Slice to the most recent `limit` items
      const recent = items.slice(-limit);

      broadcastAiAuditEvent(
        "domray_get_flow_timeline",
        { limit, include_network, include_console },
        `AI analyzed unified flow timeline (${recent.length} events)`
      );

      if (recent.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No telemetry events captured yet in this session. Interact with the page (click buttons, navigate, type) and try again.",
            },
          ],
        };
      }

      const lines: string[] = [
        `## Chronological Flow Timeline (${recent.length} events)`,
        "",
        "| Time (Relative) | Category | Event Description |",
        "| :--- | :--- | :--- |",
      ];

      const now = Date.now();
      for (const item of recent) {
        const relMs = now - item.timestamp;
        const relStr =
          relMs < 1000
            ? `${relMs}ms ago`
            : relMs < 60000
            ? `${(relMs / 1000).toFixed(1)}s ago`
            : `${Math.round(relMs / 60000)}m ago`;

        const timeStr = new Date(item.timestamp).toISOString().slice(11, 23);
        const detailStr = item.detail ? ` <br>↳ _${item.detail}_` : "";
        lines.push(
          `| \`${timeStr}\` (${relStr}) | ${item.icon} \`${item.category}\` | ${item.summary}${detailStr} |`
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
