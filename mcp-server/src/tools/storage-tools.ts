/**
 * storage-tools.ts — domray_get_storage_state tool
 *
 * Inspects browser client storage (localStorage, sessionStorage, and cookies)
 * from the attached web page with edge-side sensitive secret redaction.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { queryStorage, broadcastAiAuditEvent } from "../ws-bridge.js";

export function registerStorageTools(server: McpServer): void {
  server.tool(
    "domray_get_storage_state",
    "Inspects client-side browser storage (localStorage, sessionStorage, or cookies) for the currently attached web page. Useful for diagnosing authentication token states, session persistence, cart data, or user preferences.",
    {
      storage_type: z
        .enum(["local", "session", "cookies"])
        .default("local")
        .describe("The client storage domain to query ('local' = localStorage, 'session' = sessionStorage, 'cookies' = document.cookie)."),
      key: z
        .string()
        .optional()
        .describe("Optional specific storage key to read. If omitted, returns all keys in that storage domain."),
    },
    async ({ storage_type, key }) => {
      broadcastAiAuditEvent(
        "domray_get_storage_state",
        { storage_type, key },
        `AI queried ${storage_type} storage${key ? ` for key "${key}"` : ""}`
      );

      try {
        const rawJson = await queryStorage(storage_type, key, 5000);
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawJson) as Record<string, unknown>;
        } catch {
          parsed = { raw: rawJson };
        }

        const entries = Object.entries(parsed);
        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `${storage_type === "local" ? "localStorage" : storage_type === "session" ? "sessionStorage" : "Cookies"} is empty on this page.`,
              },
            ],
          };
        }

        const lines: string[] = [
          `## Client Storage State (\`${storage_type}\` - ${entries.length} items)`,
          "",
          "```json",
          JSON.stringify(parsed, null, 2),
          "```",
        ];

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to inspect ${storage_type} storage: ${msg}`,
            },
          ],
        };
      }
    }
  );
}
