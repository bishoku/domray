/**
 * test-tools.ts — DOMRay Test Automation & Mocking MCP Tools
 *
 * Tools registered:
 *   - domray_get_test_blueprint: Synthesizes runnable Playwright or Cypress E2E specs
 *     from user interactions (clicks, inputs, submits), route changes, and network calls.
 *   - domray_get_mock_handlers: Synthesizes MSW v2 request handlers from recorded
 *     network transactions (especially 4xx/5xx API failures).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { store, type BreadcrumbEntry, type NetworkEntry } from "../session-store.js";
import { broadcastAiAuditEvent } from "../ws-bridge.js";

export function registerTestTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // 1. domray_get_test_blueprint
  // -------------------------------------------------------------------------
  server.tool(
    "domray_get_test_blueprint",
    "Generates an end-to-end automated test blueprint (Playwright or Cypress) directly from recorded user interactions, route navigations, and correlated API network requests. Uses resilient role-based locators and includes network/assertion expectations.",
    {
      framework: z
        .enum(["playwright", "cypress"])
        .default("playwright")
        .describe("Target test framework syntax to generate ('playwright' or 'cypress')."),
      test_name: z
        .string()
        .optional()
        .describe("Descriptive name for the generated test case."),
      include_network_assertions: z
        .boolean()
        .default(true)
        .describe("Include waitForResponse or cy.intercept assertions for API requests triggered by user actions."),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(25)
        .describe("Maximum number of recent interactions to convert into test steps."),
    },
    async ({ framework, test_name, include_network_assertions, limit }) => {
      broadcastAiAuditEvent(
        "domray_get_test_blueprint",
        { framework, test_name, include_network_assertions, limit },
        `Generating ${framework} E2E test blueprint`
      );

      const breadcrumbs = store.breadcrumbs.toArray().slice(-limit);
      const network = store.network.toArray();
      const session = store.activeSession;
      const baseUrl = session?.url || "http://localhost:5173";
      const testName = test_name || `Reproduce session flow on ${session?.title || "page"}`;

      if (breadcrumbs.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No user interaction breadcrumbs recorded yet. Perform actions on the web page (click buttons, fill forms, navigate) and invoke this tool again.",
            },
          ],
        };
      }

      if (framework === "playwright") {
        const steps: string[] = [];
        const locatorsSummary: Array<{ step: number; locator: string; type: string }> = [];
        let stepIdx = 1;

        for (let i = 0; i < breadcrumbs.length; i++) {
          const b = breadcrumbs[i];
          if (!b) continue;

          const locator = buildPlaywrightLocator(b);
          const nextB = breadcrumbs[i + 1];
          const correlatedNetwork = findCorrelatedNetwork(b, nextB, network);

          if (b.type === "click") {
            steps.push(`  // Step ${stepIdx}: ${b.description}`);
            if (include_network_assertions && correlatedNetwork) {
              const urlPath = extractPath(correlatedNetwork.url);
              steps.push(`  const [response${stepIdx}] = await Promise.all([`);
              steps.push(`    page.waitForResponse(res => res.url().includes('${urlPath}') && res.status() === ${correlatedNetwork.status || 200}),`);
              steps.push(`    ${locator}.click(),`);
              steps.push(`  ]);`);
              steps.push(`  expect(response${stepIdx}.ok()).toBe(${Boolean(correlatedNetwork.status && correlatedNetwork.status < 400)});`);
            } else {
              steps.push(`  await ${locator}.click();`);
            }
            locatorsSummary.push({ step: stepIdx, locator, type: b.role ? "role" : b.testId ? "testid" : "css" });
            stepIdx++;
          } else if (b.type === "input") {
            const val = b.inputValue && b.inputValue !== "***MASKED***" ? b.inputValue : "test-value";
            steps.push(`  // Step ${stepIdx}: ${b.description}`);
            steps.push(`  await ${locator}.fill('${escapeQuotes(val)}');`);
            locatorsSummary.push({ step: stepIdx, locator, type: b.role ? "role" : b.testId ? "testid" : "css" });
            stepIdx++;
          } else if (b.type === "submit") {
            steps.push(`  // Step ${stepIdx}: ${b.description}`);
            if (include_network_assertions && correlatedNetwork) {
              const urlPath = extractPath(correlatedNetwork.url);
              steps.push(`  await Promise.all([`);
              steps.push(`    page.waitForResponse(res => res.url().includes('${urlPath}')),`);
              steps.push(`    ${locator}.press('Enter'),`);
              steps.push(`  ]);`);
            } else {
              steps.push(`  await ${locator}.press('Enter');`);
            }
            stepIdx++;
          } else if (b.type === "navigation") {
            steps.push(`  // Step ${stepIdx}: ${b.description}`);
            stepIdx++;
          }
        }

        const code = [
          `import { test, expect } from '@playwright/test';`,
          ``,
          `test.describe('${escapeQuotes(testName)}', () => {`,
          `  test('should execute recorded user flow', async ({ page }) => {`,
          `    // 1. Initial Navigation`,
          `    await page.goto('${baseUrl}');`,
          ``,
          steps.join("\n"),
          `  });`,
          `});`,
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text: [
                `## 🎬 Playwright Test Blueprint (${stepIdx - 1} steps generated)`,
                ``,
                "```typescript",
                code,
                "```",
                ``,
                "### 🎯 Locators Resilience Breakdown:",
                "| Step | Generated Locator | Locator Type |",
                "| :--- | :--- | :--- |",
                ...locatorsSummary.map(
                  (l) => `| Step ${l.step} | \`${l.locator}\` | **${l.type.toUpperCase()}** |`
                ),
              ].join("\n"),
            },
          ],
        };
      } else {
        // Cypress
        const steps: string[] = [];
        let stepIdx = 1;

        for (let i = 0; i < breadcrumbs.length; i++) {
          const b = breadcrumbs[i];
          if (!b) continue;

          const cyLocator = buildCypressLocator(b);
          const nextB = breadcrumbs[i + 1];
          const correlatedNetwork = findCorrelatedNetwork(b, nextB, network);

          if (b.type === "click") {
            steps.push(`    // Step ${stepIdx}: ${b.description}`);
            if (include_network_assertions && correlatedNetwork) {
              const alias = `apiReq${stepIdx}`;
              const path = extractPath(correlatedNetwork.url);
              steps.push(`    cy.intercept('${correlatedNetwork.method}', '*${path}*').as('${alias}');`);
              steps.push(`    ${cyLocator}.click();`);
              steps.push(`    cy.wait('@${alias}').its('response.statusCode').should('eq', ${correlatedNetwork.status || 200});`);
            } else {
              steps.push(`    ${cyLocator}.click();`);
            }
            stepIdx++;
          } else if (b.type === "input") {
            const val = b.inputValue && b.inputValue !== "***MASKED***" ? b.inputValue : "test-value";
            steps.push(`    // Step ${stepIdx}: ${b.description}`);
            steps.push(`    ${cyLocator}.clear().type('${escapeQuotes(val)}');`);
            stepIdx++;
          }
        }

        const code = [
          `describe('${escapeQuotes(testName)}', () => {`,
          `  it('should execute recorded user flow', () => {`,
          `    cy.visit('${baseUrl}');`,
          ``,
          steps.join("\n"),
          `  });`,
          `});`,
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text: [
                `## 🎬 Cypress Test Blueprint (${stepIdx - 1} steps generated)`,
                ``,
                "```typescript",
                code,
                "```",
              ].join("\n"),
            },
          ],
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // 2. domray_get_mock_handlers
  // -------------------------------------------------------------------------
  server.tool(
    "domray_get_mock_handlers",
    "Generates production-ready Mock Service Worker (MSW v2) or fetch mock handlers directly from recorded HTTP network transactions (especially 4xx/5xx errors or API calls), complete with headers and response bodies.",
    {
      format: z
        .enum(["msw", "fetch-mock"])
        .default("msw")
        .describe("Target mock format ('msw' for MSW v2 or 'fetch-mock')."),
      filter: z
        .enum(["failed_only", "all"])
        .default("failed_only")
        .describe("Filter requests to mock: 'failed_only' (HTTP >= 400 or network errors) or 'all'."),
      url_pattern: z
        .string()
        .optional()
        .describe("Optional substring filter for request URLs (e.g. '/api/')."),
    },
    async ({ format, filter, url_pattern }) => {
      broadcastAiAuditEvent(
        "domray_get_mock_handlers",
        { format, filter, url_pattern },
        `Generating ${format} API mock handlers`
      );

      let entries = store.network.toArray();

      if (filter === "failed_only") {
        entries = entries.filter((n) => n.failed || (n.status !== undefined && n.status >= 400));
      }

      if (url_pattern) {
        entries = entries.filter((n) => n.url.includes(url_pattern));
      }

      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matching network requests found for filter: ${filter}${url_pattern ? ` (url_pattern: ${url_pattern})` : ""}. Trigger network requests on the page and try again.`,
            },
          ],
        };
      }

      if (format === "msw") {
        const handlerBlocks: string[] = [];

        for (const entry of entries) {
          const method = (entry.method || "GET").toLowerCase();
          const path = extractPath(entry.url);
          const status = entry.status || (entry.failed ? 500 : 200);

          let bodyCode = "{ success: true }";
          if (entry.responseBody) {
            try {
              const parsed = JSON.parse(entry.responseBody);
              bodyCode = JSON.stringify(parsed, null, 2)
                .split("\n")
                .map((line, idx) => (idx === 0 ? line : `    ${line}`))
                .join("\n");
            } catch {
              bodyCode = JSON.stringify({ raw: entry.responseBody });
            }
          } else if (entry.failureReason) {
            bodyCode = JSON.stringify({ error: entry.failureReason });
          }

          handlerBlocks.push(
            [
              `  // Mock ${entry.method} ${path} -> HTTP ${status}`,
              `  http.${method}('*${path}', async ({ request }) => {`,
              `    return HttpResponse.json(`,
              `      ${bodyCode},`,
              `      { status: ${status} }`,
              `    );`,
              `  }),`,
            ].join("\n")
          );
        }

        const mswCode = [
          `import { http, HttpResponse } from 'msw';`,
          ``,
          `export const handlers = [`,
          handlerBlocks.join("\n\n"),
          `];`,
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text: [
                `## 🌐 MSW (Mock Service Worker v2) Handlers (${entries.length} handlers generated)`,
                ``,
                "```typescript",
                mswCode,
                "```",
                ``,
                "### 💡 Usage in Vitest / Jest / Playwright:",
                "1. Add to your `src/mocks/handlers.ts`.",
                "2. Use with `setupServer(...handlers)` in unit tests or `page.route` in Playwright.",
              ].join("\n"),
            },
          ],
        };
      } else {
        // fetch-mock format
        const mockBlocks = entries.map((entry) => {
          const path = extractPath(entry.url);
          const status = entry.status || 200;
          return `fetchMock.${entry.method.toLowerCase()}('*${path}', { status: ${status}, body: ${entry.responseBody || "{}"} });`;
        });

        return {
          content: [
            {
              type: "text",
              text: [
                `## 🌐 Fetch-Mock Handlers (${entries.length} requests)`,
                "```typescript",
                mockBlocks.join("\n"),
                "```",
              ].join("\n"),
            },
          ],
        };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPlaywrightLocator(b: BreadcrumbEntry): string {
  if (b.role && b.accessibleName) {
    return `page.getByRole('${b.role}', { name: '${escapeQuotes(b.accessibleName)}' })`;
  }
  if (b.testId) {
    return `page.getByTestId('${escapeQuotes(b.testId)}')`;
  }
  if (b.accessibleName && b.type === "input") {
    return `page.getByPlaceholder('${escapeQuotes(b.accessibleName)}')`;
  }
  if (b.selector) {
    return `page.locator('${escapeQuotes(b.selector)}')`;
  }
  return `page.locator('${b.tagName || "div"}')`;
}

function buildCypressLocator(b: BreadcrumbEntry): string {
  if (b.testId) {
    return `cy.get('[data-testid="${escapeQuotes(b.testId)}"]')`;
  }
  if (b.role && b.accessibleName) {
    return `cy.contains('[role="${b.role}"], button, a', '${escapeQuotes(b.accessibleName)}')`;
  }
  if (b.selector) {
    return `cy.get('${escapeQuotes(b.selector)}')`;
  }
  return `cy.get('${b.tagName || "div"}')`;
}

function findCorrelatedNetwork(
  current: BreadcrumbEntry,
  next: BreadcrumbEntry | undefined,
  network: NetworkEntry[]
): NetworkEntry | undefined {
  const start = current.timestamp;
  const end = next ? next.timestamp : start + 3000;

  // Look for requests initiated within window
  return network.find(
    (n) =>
      n.timestamp >= start &&
      n.timestamp <= end &&
      (n.url.includes("/api/") || n.status !== undefined)
  );
}

function extractPath(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.pathname;
  } catch {
    return rawUrl;
  }
}

function escapeQuotes(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, " ");
}
