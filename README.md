# DOMRay ⚡

![DOMRay — Browser-to-MCP Runtime Telemetry Bridge](assets/domray_cover.png)

> **The Missing Runtime Telemetry Bridge for AI Coding Agents.**  
> Give your AI assistants (**Cursor, Claude Code, Antigravity, Windsurf**) real-time vision into active browser sessions — including web pages behind **SSO, 2FA, VPNs, and dynamic client-side state** — via standard **Model Context Protocol (MCP)**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Chrome Extension MV3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-green?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![MCP Standard](https://img.shields.io/badge/Protocol-Model_Context_Protocol-purple)](https://modelcontextprotocol.io/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## 🛑 The Problem: The Runtime Blindspot of AI Coding

AI coding agents have revolutionized software development. Tools like Cursor, Claude Code, Windsurf, and Copilot understand your static codebase, git history, syntax trees, and type definitions with astonishing precision.

**However, the moment your application runs in a browser, your AI coding agent becomes completely blind.**

```
┌────────────────────────────────────────────────────────┐
│                   THE RUNTIME GAP                      │
│                                                        │
│  Static World (AI has 100% Context):                   │
│  ✓ Source Code & Git History                          │
│  ✓ Abstract Syntax Trees & Types                       │
│  ✓ Project Files & Dependencies                        │
│                                                        │
│  =================== BLIND SPOT =====================  │
│                                                        │
│  Runtime World (AI has 0% Context):                    │
│  ✗ Pages behind SSO, 2FA, VPNs, or Staging Auth        │
│  ✗ Real-time React / Vue internal component state      │
│  ✗ Causal user interaction sequences (Breadcrumbs)     │
│  ✗ Failed API responses and HTTP 4xx/5xx payloads      │
│  ✗ Console warnings and client storage (session/local) │
└────────────────────────────────────────────────────────┘
```

### Where Current Practices Fail:

1. **The Authentication & Security Wall (SSO / 2FA / Staging):**  
   Autonomous headless agents (e.g. Puppeteer/Playwright scripts) cannot log into internal staging environments, corporate VPNs, or apps protected by Okta/Google 2FA without complex credential passing or unsafe cookie sharing.
2. **The "Manual Copy-Paste" Tax:**  
   When a bug occurs, developers waste time opening DevTools, copying messy stack traces, exporting HAR network logs, taking screenshots, and hand-crafting prompts for their AI. By the time the context is assembled, critical temporal details are lost.
3. **Silent State Bugs (No Errors Thrown):**  
   Many of the hardest frontend bugs don't throw an uncaught exception (e.g. *"The submit button is permanently stuck on 'Applying...', no error is in the console, and the cart total didn't change"*). Static code analysis cannot tell the AI whether `isSubmitting` in React Fiber or a Vue `ref` is currently stuck at `true`.
4. **The Automated Testing Disconnect:**  
   After discovering and manually reproducing a bug in the browser, translating that discovery into resilient, production-ready Playwright/Cypress E2E specs or MSW API mock handlers requires another round of manual, error-prone boilerplate coding.

---

## 💡 The Solution: DOMRay

**DOMRay bridges the gap between your active browser runtime and your AI coding agent.**

Instead of trying to automate a separate, detached browser instance, DOMRay connects directly to the **living, authenticated browser tab you are already using as a developer**.

Using the **Chrome DevTools Protocol (CDP)** and the open **Model Context Protocol (MCP)**, DOMRay securely streams structured runtime telemetry into your AI agent's tool context while providing you with 100% visibility through a native Chrome Side Panel.

```
+-----------------------------------------------------------------------------------------+
|                                    DOMRay WORKFLOW                                      |
|                                                                                         |
| 1. DEVELOPER INTERACTS             2. DOMRAY CAPTURES             3. AI AGENT REPAIRS   |
|                                                                                         |
|   ┌────────────────────────┐         ┌───────────────────┐         ┌─────────────────┐  |
|   │ Authenticated Browser  │         │ DOMRay Extension  │         │ AI Agent (MCP)  │  |
|   │ (SSO / 2FA Active)     │ ──────> │ - User Actions    │ ──────> │ Cursor / Claude │  |
|   │ User clicks "Apply",   │         │ - Failed Network  │         │ Queries state,  │  |
|   │ button freezes!        │         │ - Fiber State     │         │ generates fix & │  |
|   └────────────────────────┘         │ - Edge Redaction  │         │ E2E test specs! │  |
|                                      └───────────────────┘         └─────────────────┘  |
+-----------------------------------------------------------------------------------------+
```

### What DOMRay Gives You & Your AI:
* 🔍 **Zero-Friction Context:** Your AI can inspect runtime exceptions, network request histories, and client storage on demand.
* 🖱️ **Causal Flow Reconstruction:** Replays the exact sequence of clicks, form entries, and SPA navigations that triggered an issue.
* ⚛️ **Framework State X-Ray:** Traverses React 18/19 Fiber trees (hooks unrolled into `useState`, `useReducer`, props) and Vue 3 reactive `ref()` / `computed()` components.
* 🎬 **Instant E2E Test Blueprints (`domray_get_test_blueprint`):** Converts recorded user actions and network events directly into runnable, resilient **Playwright** or **Cypress** test specs.
* 🌐 **Auto MSW Mock Handlers (`domray_get_mock_handlers`):** Automatically synthesizes Mock Service Worker v2 handlers from real failed HTTP 4xx/5xx network transactions.
* 📋 **1-Click AI Context Capsule:** Copies an edge-redacted, Markdown-formatted diagnostic report to your clipboard for instant pasting into web ChatGPT, Claude, or GitHub Issues.

---

## 🏛️ Architecture & Technology Stack

DOMRay is built as a lightweight, local-first monorepo designed for performance and zero cognitive overhead.

```
[Target Web Page (SSO / 2FA / Strict CSP)]
       │
       ├── User Interaction Tracker (Content Script)
       │     ├── Captures: clicks, inputs, submits, SPA route changes
       │     └── W3C Accessible Name resolution (label[for], aria-labelledby)
       │
       │ (Chrome DevTools Protocol - CDP via chrome.debugger)
       ▼
[Chrome Extension (Manifest V3)]
  ├── Service Worker
  │     ├── CDP Client (Runtime.enable, Network.enable, consoleAPICalled)
  │     ├── In-Memory Ring Buffers (Errors, Network, Breadcrumbs, Console)
  │     ├── Edge Redaction Engine (Masks Authorization, Cookie, Passwords BEFORE dispatch)
  │     └── WebSocket Client (Loopback with keepalive heartbeat)
  ├── Popup UI (1-Click Auto-Pairing, Re-attach, Quick Actions)
  └── 🖥️ Live Telemetry & AI Audit Side Panel (chrome.sidePanel)
         ├── 🤖 Live AI Audit Feed (Watches agent tool queries in real time)
         ├── 🔴 Exceptions, Stack Traces & Live User Breadcrumbs
         ├── 🎯 Visual Element Inspector (Hover highlighter & component name)
         └── 🧹 1-Click State & Buffer Reset Control
       │
       │ Localhost Loopback (ws://127.0.0.1:9123)
       │ Auth: Origin Validation + Ephemeral Cryptographic Token
       ▼
[Local DOMRay MCP Server (Node.js/TypeScript)]
  ├── Hybrid HTTP + WebSocket Bridge
  │     ├── POST /pair (Zero-config 1-click handshake & origin registration)
  │     └── WS Inbound/Outbound (Telemetry streams + Bidirectional DOM/State queries)
  ├── Session Store (Ring buffers, active tab tracking, callback registry)
  ├── Semantic DOM Sanitizer & Token Pruner (-85% LLM token consumption)
  └── MCP stdio Transport (JSON-RPC 2.0 over stdin/stdout)
       │
       ▼
[AI Coding Agent (Cursor / Claude Code / Antigravity / Windsurf)]
  └── Standard MCP Tools (10 specialized tools)
```

### Technologies Used:
* **Protocol Standard:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) via `@modelcontextprotocol/sdk`.
* **Browser Automation & Telemetry:** Chrome DevTools Protocol (`chrome.debugger` API) under Manifest V3.
* **UI & Developer Experience:** Chrome native `chrome.sidePanel` for docked, persistent telemetry monitoring.
* **Testing & Mocks:** [Playwright](https://playwright.dev/) for resilient E2E automation and [MSW v2](https://mswjs.io/) for API mocking.
* **Core Languages:** 100% TypeScript with strict typing, bundled with `tsup` and `esbuild`.

---

## 🛡️ Enterprise Security, Privacy & Zero-Data-Leak Guarantees

DOMRay was architected from day one for strict corporate environments, regulated data, and internal staging applications:

1. **🔒 100% Local-First (No Cloud, No Third Parties):**  
   DOMRay has **zero external servers**. Telemetry never leaves your local machine (`127.0.0.1`). There are no analytics, no tracking, and no external API dependencies.
2. **🛡️ Edge-Side Redaction Engine:**  
   Data masking occurs **inside the browser extension before dispatching** over the local WebSocket:
   * Sensitive HTTP headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`) are replaced with `***MASKED***`.
   * Sensitive URL query parameters (`token`, `password`, `secret`, `key`) are automatically scrubbed.
   * Form inputs (`type="password"`, `data-private`, card numbers, CVVs) never leak their values into breadcrumbs.
3. **🔐 Origin Validation & CSWSH Protection:**  
   The local WebSocket bridge rejects any connection whose `Origin` header is not an authorized `chrome-extension://<EXTENSION_ID>`. Regular web pages and external domains are immediately rejected with HTTP 403.
4. **🔑 Ephemeral Cryptographic Tokens:**  
   Every time the MCP server starts, it generates a cryptographically random 32-byte session token validated via `crypto.timingSafeEqual`.
5. **👁️ 100% Transparent AI Audit Feed:**  
   Through the native Chrome Side Panel, developers see a live feed of **every tool call the AI executes**, including tool parameters, timestamp, and returned payloads. You are never left wondering what data the AI requested.

---

## ⚡ Quick Start

### 1. Clone and Build

```bash
# Clone the repository
git clone https://github.com/bishoku/domray.git
cd domray

# Install dependencies across monorepo workspaces
npm install

# Build both the MCP server and the Chrome Extension
npm run build
```

### 2. Load the Extension into Google Chrome

1. Navigate to `chrome://extensions` in Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the directory:
   ```
   domray/extension/dist/
   ```
4. The **DOMRay** icon will appear in your Chrome toolbar. Pin it for quick access.

### 3. Configure Your AI Coding Agent

Add DOMRay to your AI agent's MCP configuration:

#### For Cursor (`~/.cursor/mcp.json` or Cursor Settings > Features > MCP):
```json
{
  "mcpServers": {
    "domray": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/domray/mcp-server/dist/index.js"]
    }
  }
}
```

#### For Claude Code (`claude_desktop_config.json` or project config):
```json
{
  "mcpServers": {
    "domray": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/domray/mcp-server/dist/index.js"]
    }
  }
}
```

### 4. Connect & Trace

1. Open your web application (or run our example playground: `npm run dev:example`).
2. Click the **DOMRay** extension icon in Chrome and click **⚡ Auto-Connect** (connects in 1 click).
3. Click **Attach Debugger** to begin capturing runtime telemetry.
4. Click **🖥️ Open Side Panel** to watch live telemetry and the AI audit stream side-by-side with your app!

---

## 🧰 MCP Tools Reference (10 Tools)

DOMRay exposes 10 tools to connected AI coding agents:

| Tool | Description | Key Parameters |
| :--- | :--- | :--- |
| `domray_get_active_session` | Returns active tab URL, page title, uptime, and telemetry buffer counters. | None |
| `domray_get_latest_error` | Returns the latest unhandled runtime exception, call stack, and preceding causal breadcrumbs. | `include_breadcrumbs: boolean` |
| `domray_get_flow_timeline` | Interleaves user clicks, form submissions, network calls, and console logs into a unified chronological replay. | `limit: number`, `failed_network_only: boolean` |
| `domray_get_test_blueprint` | 🎬 **Synthesizes runnable Playwright or Cypress E2E test specs** from recorded interactions and API calls. | `framework: "playwright" \| "cypress"`, `include_network_assertions: boolean` |
| `domray_get_mock_handlers` | 🌐 **Synthesizes MSW v2 mock request handlers** directly from recorded 4xx/5xx API transactions. | `format: "msw" \| "fetch-mock"`, `filter: "failed_only" \| "all"` |
| `domray_get_component_state` | Traverses React 18/19 Fiber or Vue 3 reactive trees to extract props and hooks (`useState`, etc.). | `selector: string` (e.g. `'#root'`, `'form#checkout'`) |
| `domray_get_scoped_dom` | Returns an intelligent, token-pruned (-85% tokens) HTML subtree for a given CSS selector. | `selector: string`, `max_depth: number` |
| `domray_get_network_timeline` | Returns recent HTTP transactions (status, duration, method, response bodies for errors). | `failed_only: boolean`, `limit: number` |
| `domray_get_console_logs` | Returns live browser console logs (`log`, `info`, `warn`, `error`) captured via CDP. | `level: "all" \| "error" \| "warn"`, `search?: string` |
| `domray_get_storage_state` | Reads `localStorage`, `sessionStorage`, or cookies with automatic secret masking. | `storage_type: "local" \| "session" \| "cookies"` |

---

## 🛒 Real-World Playground Example

We include a standalone React 18 application in `examples/checkout-app` simulating an enterprise checkout page behind SSO:

```bash
# Start the example checkout app (runs on http://localhost:5173)
npm run dev:example

# Run the DOMRay-generated Playwright E2E test suite
npm run test:example:e2e
```

* **The Scenario:** A checkout screen with simulated SSO 2FA session tokens.
* **The Bug:** Applying coupon `EXPIRED20` triggers an HTTP 422 error. Due to a state bug in `CouponForm.tsx`, `isSubmitting` never resets, permanently freezing the button without throwing an error in the console.
* **Try it with your AI:**
  > *"The checkout apply button is permanently frozen. Can you inspect the active tab with DOMRay, diagnose the issue, and provide a fix and automated test?"*

---

## 🤝 Contributing to DOMRay

We believe that the future of software development lies in empowering AI assistants with **real, high-fidelity runtime awareness**—without sacrificing developer privacy or enterprise security.

DOMRay is an **open-source, community-driven project**, and we warmly welcome contributions from frontend developers, AI enthusiasts, and tool builders alike!

### How You Can Help:
* ⭐ **Star the Repository:** If DOMRay helps your daily workflow, star the repo to help other developers discover it!
* 🧩 **Expand Framework State Inspectors:** Help us build deeper extractors for **Svelte 5 runes**, **Angular signals**, **SolidJS stores**, or **Zustand / Redux** slices.
* 🧪 **Improve Testing Blueprints:** Add support for Vitest Component Testing, Jest, or custom locator strategies.
* 🐞 **Report Issues & Ideas:** Found an edge case or have a vision for a new MCP tool? Open an [Issue](https://github.com/bishoku/domray/issues) or start a discussion.
* 🔀 **Submit Pull Requests:** Check out open issues, fork the repo, and submit your PRs. We strive to review and merge community contributions promptly.

Please feel free to explore the codebase, test it with your favorite coding agents, and share your thoughts. Let's make AI-assisted frontend development faster, smarter, and context-aware together!

---

## 📄 License

DOMRay is open-source software licensed under the [MIT License](LICENSE).
