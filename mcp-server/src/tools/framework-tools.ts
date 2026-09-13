/**
 * framework-tools.ts — domray_get_component_state tool.
 *
 * Inspects runtime internal state (React Fiber props/state, Vue 3 setupState/props)
 * of any component selected by CSS selector on the active page.
 */

import { z } from "zod";
import crypto from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendComponentStateQuery, isExtensionConnected, broadcastAiAuditEvent } from "../ws-bridge.js";
import { store } from "../session-store.js";

const COMPONENT_QUERY_TIMEOUT_MS = 6000;

export function registerFrameworkTools(server: McpServer): void {
  server.tool(
    "domray_get_component_state",
    "Inspects the internal runtime state (React Fiber props & state, or Vue 3 setupState & props) of a component matching a CSS selector.",
    {
      selector: z
        .string()
        .describe("CSS selector targeting the component DOM element (e.g. '#root', '.cart-item', 'form#checkout')."),
    },
    async ({ selector }) => {
      broadcastAiAuditEvent(
        "domray_get_component_state",
        { selector },
        `AI inspected component state for selector "${selector}"`,
      );

      if (!isExtensionConnected()) {
        return {
          content: [
            {
              type: "text",
              text: "Extension is not connected. Cannot inspect component state. Connect the DOMRay extension first.",
            },
          ],
          isError: true,
        };
      }

      const requestId = crypto.randomUUID();

      const statePromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          store.componentStateCallbacks.delete(requestId);
          reject(new Error(`Component inspection timed out after ${COMPONENT_QUERY_TIMEOUT_MS}ms`));
        }, COMPONENT_QUERY_TIMEOUT_MS);

        store.componentStateCallbacks.set(requestId, { resolve, reject, timer });
      });

      const sent = sendComponentStateQuery(requestId, selector);
      if (!sent) {
        store.componentStateCallbacks.delete(requestId);
        return {
          content: [{ type: "text", text: "Failed to dispatch component inspection query to extension." }],
          isError: true,
        };
      }

      let rawData: string;
      try {
        rawData = await statePromise;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Component state inspection failed: ${msg}` }],
          isError: true,
        };
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        parsed = { raw: rawData };
      }

      const framework = (parsed["framework"] as string) ?? "Unknown";
      const componentName = (parsed["component"] as string) ?? "N/A";
      const hierarchy = (parsed["hierarchy"] as string) ?? undefined;

      const lines: string[] = [
        `## Component State: \`<${componentName}>\` (\`${selector}\`)`,
        `- **Framework Detected:** ${framework}`,
        ...(hierarchy ? [`- **Component Hierarchy:** \`${hierarchy}\``] : []),
        `- **Timestamp:** ${new Date().toISOString()}`,
        "",
      ];

      if (parsed["error"]) {
        lines.push(`❌ **Error:** ${parsed["error"]}`);
      } else if (parsed["message"]) {
        lines.push(`ℹ️ **Info:** ${parsed["message"]}`);
        if (parsed["element"]) {
          lines.push("", "### DOM Element Details", "```json", JSON.stringify(parsed["element"], null, 2), "```", "");
        }
      } else {
        if (parsed["props"]) {
          lines.push("### Props", "```json", JSON.stringify(parsed["props"], null, 2), "```", "");
        }
        if (parsed["state"]) {
          lines.push("### State / Hooks", "```json", JSON.stringify(parsed["state"], null, 2), "```", "");
        }
        if (parsed["setupState"]) {
          lines.push("### Vue Setup State", "```json", JSON.stringify(parsed["setupState"], null, 2), "```", "");
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
