/**
 * advanced-tools.ts — Advanced observability tools for DOMRay MCP Server:
 *   - domray_get_a11y_tree: W3C Accessibility (AXTree) semantic tree.
 *   - domray_get_query_cache: TanStack / React Query cache inspector.
 *   - domray_get_web_vitals: Core Web Vitals (CLS, LCP, INP) + layout shift culprit attribution.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  queryA11yTree,
  queryQueryCache,
  isExtensionConnected,
  broadcastAiAuditEvent,
} from "../ws-bridge.js";
import { store } from "../session-store.js";

export function registerAdvancedTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // 1. Accessibility Tree (AXTree)
  // -------------------------------------------------------------------------
  server.tool(
    "domray_get_a11y_tree",
    "Returns Chrome's W3C Accessibility (AXTree) semantic tree of the active tab. Prunes unlabelled generic containers for token efficiency. Perfect for validating screen reader accessibility, forms, ARIA roles, and finding accessible selectors without HTML clutter.",
    {
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector to scope tree search or highlight in the view."),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(6)
        .describe("Maximum tree depth (default: 6)."),
      filter: z
        .enum(["all", "interesting_only"])
        .default("interesting_only")
        .describe("'interesting_only' hides unlabelled/generic div containers to save tokens; 'all' includes every AXNode."),
    },
    async ({ selector, max_depth, filter }) => {
      broadcastAiAuditEvent(
        "domray_get_a11y_tree",
        { selector, max_depth, filter },
        `AI inspected Accessibility (AXTree) with depth ${max_depth}`,
      );

      if (!isExtensionConnected()) {
        return {
          content: [
            {
              type: "text",
              text: "Extension is not connected. Cannot query accessibility tree. Ensure DOMRay extension is connected to this tab.",
            },
          ],
          isError: true,
        };
      }

      try {
        const tree = await queryA11yTree(selector, max_depth, filter);
        return {
          content: [
            {
              type: "text",
              text: tree,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Accessibility tree query failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 2. TanStack / React Query Cache Inspector
  // -------------------------------------------------------------------------
  server.tool(
    "domray_get_query_cache",
    "Inspects the active TanStack Query / React Query client cache. Returns query keys, query status (idle/pending/success/error), fetch status, isStale, timestamps, and serialized data preview. Invaluable for diagnosing async data fetching, state hydration, and cache invalidation bugs.",
    {
      query_key: z
        .string()
        .optional()
        .describe("Optional substring or query key name to filter queries (e.g. 'cart', 'products', 'user')."),
      status: z
        .enum(["all", "idle", "loading", "pending", "success", "error"])
        .default("all")
        .describe("Filter queries by status."),
    },
    async ({ query_key, status }) => {
      broadcastAiAuditEvent(
        "domray_get_query_cache",
        { query_key, status },
        `AI inspected Query Cache${query_key ? ` for key "${query_key}"` : ""}`,
      );

      if (!isExtensionConnected()) {
        return {
          content: [
            {
              type: "text",
              text: "Extension is not connected. Cannot inspect query cache. Ensure DOMRay extension is connected to this tab.",
            },
          ],
          isError: true,
        };
      }

      try {
        const rawJson = await queryQueryCache(query_key, status);
        let parsed: {
          found: boolean;
          message?: string;
          totalCount?: number;
          matchedCount?: number;
          queries?: Array<{
            queryKey: unknown;
            queryHash: string;
            status: string;
            fetchStatus: string;
            isStale: boolean;
            dataUpdatedAt: number;
            errorUpdatedAt: number;
            error: string | null;
            dataPreview: string | null;
          }>;
          error?: string;
        };

        try {
          parsed = JSON.parse(rawJson);
        } catch {
          return {
            content: [{ type: "text", text: `Failed to parse query cache response: ${rawJson}` }],
            isError: true,
          };
        }

        if (!parsed.found) {
          return {
            content: [
              {
                type: "text",
                text: `ℹ️ **TanStack / React Query Cache:** ${parsed.message ?? parsed.error ?? "Not detected on active page."}`,
              },
            ],
          };
        }

        const queries = parsed.queries ?? [];
        const lines: string[] = [
          `## ⚡ TanStack / React Query Cache Inspector`,
          `- **Total Queries in Cache:** ${parsed.totalCount ?? 0}`,
          `- **Matched Filter:** ${parsed.matchedCount ?? queries.length}`,
          `- **Filter Key:** \`${query_key ?? "*"}\` | **Status:** \`${status}\``,
          "",
        ];

        if (queries.length === 0) {
          lines.push("_No queries matched the filter criteria._");
        } else {
          lines.push("| Status | Key | Fetch Status | Stale? | Last Updated | Preview / Error |");
          lines.push("|---|---|---|---|---|---|");

          for (const q of queries) {
            const statusIcon =
              q.status === "success"
                ? "🟢 success"
                : q.status === "error"
                  ? "🔴 error"
                  : q.status === "pending" || q.status === "loading"
                    ? "🟡 pending"
                    : `⚪ ${q.status}`;

            const keyStr = JSON.stringify(q.queryKey);
            const staleStr = q.isStale ? "⚠️ yes" : "✅ fresh";
            const updated = q.dataUpdatedAt > 0 ? new Date(q.dataUpdatedAt).toLocaleTimeString() : "-";
            const info = q.error
              ? `🔴 Error: ${q.error}`
              : q.dataPreview
                ? `\`${q.dataPreview.replace(/\|/g, "\\|").slice(0, 100)}\``
                : "-";

            lines.push(
              `| ${statusIcon} | \`${keyStr}\` | \`${q.fetchStatus}\` | ${staleStr} | ${updated} | ${info} |`,
            );
          }

          lines.push("");
          lines.push("### Query Details");
          for (const q of queries) {
            lines.push(`#### \`${JSON.stringify(q.queryKey)}\``);
            lines.push(`- **Status:** ${q.status} (fetchStatus: ${q.fetchStatus})`);
            lines.push(`- **Stale:** ${q.isStale}`);
            if (q.error) {
              lines.push(`- **Error:** ${q.error}`);
            }
            if (q.dataPreview) {
              lines.push("- **Data Preview:**");
              lines.push("```json");
              lines.push(q.dataPreview);
              lines.push("```");
            }
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Query cache inspection failed: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 3. Web Vitals & Layout Shift Telemetry
  // -------------------------------------------------------------------------
  server.tool(
    "domray_get_web_vitals",
    "Returns live Core Web Vitals (CLS, LCP, INP) telemetry from the active page, including performance ratings (good/needs-improvement/poor) and exact layout shift culprits (offending DOM selectors causing CLS).",
    {
      include_shifts: z
        .boolean()
        .default(true)
        .describe("Include recent layout shift culprits and selectors in output."),
    },
    async ({ include_shifts }) => {
      broadcastAiAuditEvent(
        "domray_get_web_vitals",
        { include_shifts },
        "AI requested live Core Web Vitals telemetry",
      );

      if (!isExtensionConnected()) {
        return {
          content: [
            {
              type: "text",
              text: "Extension is not connected. Cannot retrieve web vitals. Ensure DOMRay extension is connected to this tab.",
            },
          ],
          isError: true,
        };
      }

      const vitals = store.latestWebVitals as {
        cls?: number;
        lcpMs?: number;
        inpMs?: number;
        clsRating?: string;
        lcpRating?: string;
        inpRating?: string;
        lcpElement?: string;
        layoutShifts?: Array<{ value: number; selector: string }>;
        ttfbMs?: number;
        domContentLoadedMs?: number;
        loadMs?: number;
      } | null;

      if (!vitals) {
        return {
          content: [
            {
              type: "text",
              text: "ℹ️ **Web Vitals Telemetry:** No metrics recorded yet. Web Vitals accumulate as the page loads and user interactions (clicks, keypresses) occur. Ensure the page has loaded and has been interacted with.",
            },
          ],
        };
      }

      function ratingBadge(rating?: string): string {
        if (rating === "good") return "🟢 Good";
        if (rating === "needs-improvement") return "🟡 Needs Improvement";
        if (rating === "poor") return "🔴 Poor";
        return "⚪ N/A";
      }

      const lines: string[] = [
        "## 📊 Core Web Vitals & Performance Telemetry",
        `- **Active Page:** \`${store.activeSession?.url ?? "Unknown"}\``,
        `- **Timestamp:** ${new Date().toISOString()}`,
        "",
        "### Key Metrics",
        "| Metric | Value | Rating | Target (Good) |",
        "|---|---|---|---|",
        `| **CLS** (Cumulative Layout Shift) | \`${vitals.cls ?? 0}\` | ${ratingBadge(vitals.clsRating)} | \`≤ 0.1\` |`,
        `| **LCP** (Largest Contentful Paint) | \`${vitals.lcpMs ?? 0} ms\` | ${ratingBadge(vitals.lcpRating)} | \`≤ 2500 ms\` |`,
        `| **INP** (Interaction to Next Paint) | \`${vitals.inpMs ?? 0} ms\` | ${ratingBadge(vitals.inpRating)} | \`≤ 200 ms\` |`,
      ];

      if (vitals.ttfbMs !== undefined || vitals.domContentLoadedMs !== undefined || vitals.loadMs !== undefined) {
        lines.push("");
        lines.push("### Navigation Timing");
        if (vitals.ttfbMs !== undefined) lines.push(`- **TTFB (Time to First Byte):** \`${vitals.ttfbMs} ms\``);
        if (vitals.domContentLoadedMs !== undefined) lines.push(`- **DOMContentLoaded:** \`${vitals.domContentLoadedMs} ms\``);
        if (vitals.loadMs !== undefined) lines.push(`- **Load Complete:** \`${vitals.loadMs} ms\``);
      }

      if (vitals.lcpElement) {
        lines.push("");
        lines.push(`### 🎯 LCP Element Target`);
        lines.push(`- Offending/Hero Selector: \`${vitals.lcpElement}\``);
      }

      if (include_shifts && vitals.layoutShifts && vitals.layoutShifts.length > 0) {
        lines.push("");
        lines.push("### ⚠️ Layout Shift Culprits (CLS Sources)");
        lines.push("The following DOM elements shifted after initial paint, contributing to visual instability:");
        lines.push("| Shift Delta | Offending Element Selector |");
        lines.push("|---|---|");
        for (const shift of vitals.layoutShifts) {
          lines.push(`| \`+${shift.value.toFixed(4)}\` | \`${shift.selector}\` |`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
