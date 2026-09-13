/**
 * dom-tools.ts — domray_get_scoped_dom tool.
 *
 * Sends a DOM query request to the Chrome Extension over WebSocket,
 * applies the Semantic DOM Sanitizer & Token Pruner, and returns
 * a compressed, token-efficient HTML representation.
 */

import { z } from "zod";
import crypto from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendDomQuery, isExtensionConnected, broadcastAiAuditEvent } from "../ws-bridge.js";
import { store } from "../session-store.js";
import { semanticPrune } from "./dom-sanitizer.js";

const DOM_QUERY_TIMEOUT_MS = 6000;

export function registerDomTools(server: McpServer): void {
  server.tool(
    "domray_get_scoped_dom",
    "Returns a token-pruned, sanitized HTML subtree of the specified element on the active page. Automatically compresses noisy Tailwind classes, SVGs, and scripts to conserve LLM context.",
    {
      selector: z
        .string()
        .describe("CSS selector of the element to inspect (e.g. 'form#checkout', '.error-toast', '#root')."),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(3)
        .describe("Maximum DOM subtree depth to include in the output."),
      max_characters: z
        .number()
        .int()
        .min(500)
        .max(20000)
        .default(4000)
        .describe("Maximum character budget for the returned HTML to avoid token overflow."),
    },
    async ({ selector, max_depth, max_characters }) => {
      broadcastAiAuditEvent(
        "domray_get_scoped_dom",
        { selector, max_depth, max_characters },
        `AI captured pruned DOM snapshot for selector "${selector}"`,
      );

      if (!isExtensionConnected()) {
        return {
          content: [
            {
              type: "text",
              text: "Extension is not connected. Cannot query the DOM. Ensure DOMRay extension is connected to this tab.",
            },
          ],
          isError: true,
        };
      }

      const requestId = crypto.randomUUID();

      const htmlPromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          store.domQueryCallbacks.delete(requestId);
          reject(new Error(`DOM query timed out after ${DOM_QUERY_TIMEOUT_MS}ms`));
        }, DOM_QUERY_TIMEOUT_MS);

        store.domQueryCallbacks.set(requestId, { resolve, reject, timer });
      });

      const sent = sendDomQuery(requestId, selector, max_depth);
      if (!sent) {
        store.domQueryCallbacks.delete(requestId);
        return {
          content: [{ type: "text", text: "Failed to send DOM query to extension." }],
          isError: true,
        };
      }

      let rawHtml: string;
      try {
        rawHtml = await htmlPromise;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `DOM query failed: ${msg}` }],
          isError: true,
        };
      }

      // Apply Semantic Pruning
      const originalLen = rawHtml.length;
      const sanitized = semanticPrune(rawHtml, { maxCharacters: max_characters });
      const savingsPct = Math.round((1 - sanitized.length / originalLen) * 100);

      const text = [
        `## DOM Snapshot: \`${selector}\``,
        `_Depth: ${max_depth} | Pruned size: ${sanitized.length} chars (reduced by ~${Math.max(0, savingsPct)}%) | Captured: ${new Date().toISOString()}_`,
        "",
        "```html",
        sanitized,
        "```",
      ].join("\n");

      // Store in session
      store.lastSnapshot = {
        timestamp: Date.now(),
        selector,
        html: sanitized,
        triggeredBy: "manual",
      };

      return { content: [{ type: "text", text }] };
    },
  );
}
