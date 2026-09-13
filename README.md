# DOMRay

> **Browser-to-MCP Runtime Telemetry & AI Audit Engine**  
> Capture runtime errors, network traffic, DOM snapshots, and framework state (React Fiber / Vue 3) from any web app — including those behind SSO, 2FA, VPN, and strict CSP — and deliver them securely to AI coding agents (**Cursor, Claude Code, Antigravity, Windsurf**) via standard **Model Context Protocol (MCP)**.  
> Includes a **Live Telemetry & AI Audit Side Panel** for 100% transparent, zero-trust developer monitoring.

---

## Architecture Overview

```
[Target Web Page (SSO / 2FA / Strict CSP)]
       │
       ├── User Interaction Tracker (Content Script)
       │     ├── Captures: clicks, inputs, submits, SPA route changes
       │     └── Edge redaction: passwords, tokens, data-private masked
       │
       │ (Chrome DevTools Protocol - CDP via chrome.debugger)
       ▼
[Chrome Extension (Manifest V3)]
  ├── Service Worker
  │     ├── CDP Client (Runtime.enable, Network.enable, consoleAPICalled, Fiber/Vue state)
  │     ├── In-Memory Ring Buffers (Errors, Network, Breadcrumbs, Console Logs)
  │     ├── Edge Redaction Engine (Masks Authorization, Cookie, Passwords BEFORE dispatch)
  │     ├── State Lifecycle Reset (Auto-clears on detach/attach; 1-click manual wipe)
  │     └── WebSocket Client (Loopback with 15s SW keepalive heartbeat)
  ├── Popup UI (1-Click Auto-Pairing, Re-attach, Quick Actions)
  └── 🖥️ Live Telemetry & AI Audit Side Panel (chrome.sidePanel)
         ├── 🤖 Live AI Audit Feed (Watches LLM tool queries in real time)
         ├── 🔴 Exceptions, Stack Traces & Live User Breadcrumbs
         ├── 🌐 Network Waterfall & "What AI Sees" Redaction Inspector
         ├── 🧹 1-Click Buffer & State Reset Control
         └── 🧩 Token-Pruned DOM & React/Vue State Explorer
       │
       │ Localhost Loopback (http://127.0.0.1:9123 & ws://127.0.0.1:9123)
       │ Auth: Origin Validation + Ephemeral Session Token + Auto-Pairing
       ▼
[Local DOMRay MCP Server (Node.js/TypeScript)]
  ├── Hybrid HTTP + WebSocket Bridge
  │     ├── POST/GET /pair (Zero-config 1-click handshake & origin registration)
  │     ├── GET /health (Server status & connection telemetry)
  │     └── WS Inbound/Outbound (Telemetry streams + Bidirectional DOM/State/Storage queries)
  ├── Session Store (Errors, Network, Breadcrumbs, Console Logs + callback registries)
  ├── Semantic DOM Sanitizer & Token Pruner (-80% LLM token consumption)
  ├── Security Manager (Crypto token gen, timing-safe compare, allowed origins)
  └── MCP stdio Transport (JSON-RPC 2.0 over process.stdin / process.stdout)
       │
       ▼
[AI Coding Agent (Cursor / Claude Code / Antigravity / Windsurf)]
  └── Standard MCP Tools (8 tools):
        ├── domray_get_active_session
        ├── domray_get_latest_error (Enriched with 15 causal breadcrumbs + warnings)
        ├── domray_get_flow_timeline (Unified chronological event replay)
        ├── domray_get_console_logs (Browser console stream: log/info/warn/error)
        ├── domray_get_storage_state (localStorage, sessionStorage, cookies)
        ├── domray_get_network_timeline (Network traffic & failed API calls)
        ├── domray_get_scoped_dom (Token-pruned semantic HTML)
        └── domray_get_component_state (React Fiber / Vue 3 reactive state)
```

---

## Key Features

### 1. 🤖 Zero-Friction 1-Click Auto-Pairing & Instant Tracing
No manual token copy-pasting required. The MCP server runs a zero-friction loopback handshake endpoint on `http://127.0.0.1:9123/pair` (supporting both `POST` with `X-DOMRay-Extension-Id` and `GET`). Clicking **"⚡ Auto-Connect"** in the extension popup automatically pairs the extension ID, registers it into `~/.domray/allowed_origins.json`, fetches the ephemeral session token, establishes the WebSocket connection, and **instantly begins tracing the active tab in a single click**. The UI features a crystal-clear dual-status system that independently displays the **MCP Server Bridge** status and **Tab Tracing** state.

### 2. 🖱️ Smart User Action Tracking & Causal Breadcrumbs
Stack traces show *where* a bug crashed; breadcrumbs show *how the user got there*. A lightweight content script tracks user journey events in real time:
* **Interactive Clicks:** Buttons, links, inputs, and elements with `role="button"`, generating clean semantic selectors (e.g. `button#checkout-btn "Proceed to Checkout"`).
* **Form Inputs & Changes:** Debounced typing preview with mandatory edge-redaction for passwords, tokens, credit cards, or fields marked `data-private`.
* **Form Submissions:** Form targets, actions, and validation states.
* **SPA Client-Side Navigation:** Automatic tracking of `history.pushState`, `replaceState`, `popstate`, and `hashchange`.

### 3. ⏱️ Unified Chronological Flow Timeline (`domray_get_flow_timeline`)
Essential for diagnosing **silent or logic bugs** where no uncaught JavaScript error is thrown (e.g., "User clicked apply coupon, button disabled, but total didn't change"). Interleaves user interactions, API network calls, console logs, and errors into a single chronological replay.

### 4. 💬 Live Browser Console Stream (`domray_get_console_logs`)
Captures all `console.log`, `console.info`, `console.warn`, and `console.error` calls via CDP `Runtime.consoleAPICalled`. AI agents can query and filter console output by severity or search keyword.

### 5. 🗄️ Client Storage State Inspector (`domray_get_storage_state`)
Inspects `localStorage`, `sessionStorage`, or `document.cookie` directly on the active web page with automatic secret masking. Perfect for diagnosing stale tokens, expired session cookies, or cart persistence bugs.

### 6. 🔄 Automatic State Lifecycle & 1-Click Reset
* **Auto-Wipe on Detach:** When the debugger detaches (infobar cancel, DevTools opened, or user disconnect), in-memory buffers and session storage are cleanly wiped, and the MCP server store is reset.
* **Fresh Attach State:** Attaching to a tab always starts with clean, zero-pollution buffers.
* **1-Click Manual Reset:** The **🧹** button in the Side Panel header instantly purges all captured telemetry and audit logs on both the extension and MCP server with visual confirmation.

### 7. 🖥️ Real-Time AI Audit & Telemetry Side Panel (`chrome.sidePanel`)
Unlike popups that close on click, DOMRay uses Chrome's native Side Panel to remain docked alongside your web application:
* **Live AI Audit Log:** Whenever your AI coding agent executes an MCP tool query, an event flashes live on the panel showing the tool name, timestamp, arguments, and return payload.
* **Exceptions & Live Breadcrumbs:** Real-time stack traces and the last user actions displayed with colored category badges.
* **"What AI Sees" Masking Inspector:** Live verification that `Authorization`, `Cookie`, and passwords are edge-masked (`🛡️ ***MASKED***`) before leaving the browser.
* **DOM & State Explorer:** Preview token-pruned HTML or inspect React Fiber / Vue 3 component state directly.

### 8. 🧠 Semantic DOM Sanitizer & Token Pruning Engine
Raw `outerHTML` often consumes 10,000+ tokens due to SVG paths, inline styles, and verbose Tailwind utility classes:
* Replaces massive `<svg>` icons with `<svg aria-label="..." role="img"><!-- [SVG Icon] --></svg>`.
* Prunes cosmetic layout utility classes while preserving semantic and state classes (`error`, `active`, `btn`, `modal`, `hidden`, `is-invalid`).
* Strips `<script>`, `<style>`, `<link>`, and `<template>`.
* Masks sensitive input fields (`type="password"`, `data-private`, `token`, `secret`).
* **Result:** **70% to 90% token reduction**, keeping LLM context clean and focused on business logic.

### 9. 🔍 Framework State Inspector (React Fiber, Vue 3 & Modern SPAs)
DOM bugs are frequently state bugs. The `domray_get_component_state` tool traverses DOM nodes via CDP `Runtime.evaluate` to:
* **React 18 & 19 Root & Container Detection:** Automatically recognizes `__reactContainer$<id>` and `_reactRootContainer`, enabling seamless inspection of `#root`, `#__next`, `#app`, or `body` containers down to root components (`<App />`, `<Layout />`).
* **Functional Component Hooks Unrolling:** Unrolls the React Fiber `memoizedState` linked list into structured hook values (`useState`, `useRef`, `useReducer`, `useMemo`), filtering out circular dispatcher queues and internal effect loops.
* **Component Hierarchy Breadcrumbs:** Climbs fiber/component parents to construct full tree path breadcrumbs (e.g. `App > Layout > Navbar > SearchInput`).
* **Higher-Order & Wrapped Components:** Gracefully unwraps `React.memo`, `React.forwardRef`, `React.Suspense`, and Context Providers.
* **Vue 3 (Dev & Production Builds):** Inspects both development (`__vueParentComponent`) and production bundles (`_vnode.component`), unwrapping Vue 3 reactive `ref()` / `computed()` values (`_v_isRef`) inside `setupState` and Options API `data`.
* **Vue 2 & Svelte Support:** Fallback inspection for Vue 2 (`__vue__`) and Svelte (`$capture_state`).
* **Descendant Tree Walking:** If a queried parent container doesn't have an attached fiber directly, scans descendants up to 50 nodes to locate the nearest rendered framework component.
* **Vanilla / HTML Fallback:** Provides detailed tag, id, class names, attributes, and child counts if no framework is attached.

### 10. 🛡️ DevTools F12 Conflict Management (Auto-Heal)
Because Chrome allows only one active debugger per tab, opening Chrome DevTools (F12) normally kills debugger attachments. DOMRay detects this cleanly:
* Detects `replaced_with_devtools` and marks tracing as paused.
* Shows an **`F12`** badge on the extension icon and displays an alert banner in the popup & side panel.
* Offers a single-click **"🔄 Re-attach Debugger"** button once DevTools is closed.

---

## Quick Start

### 1. Installation & Build

```bash
# Clone the repository
git clone https://github.com/bishoku/domray.git
cd domray

# Install dependencies for all workspaces
npm install

# Clean build both mcp-server and extension
npm run clean && npm run build
```

### 2. Load the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Turn on **Developer Mode** (top right toggle).
3. Click **Load unpacked** and select the directory:
   ```
   domray/extension/dist/
   ```
4. The **DOMRay** extension icon will appear in your Chrome toolbar. Pin it for easy access.

### 3. Start the MCP Server

```bash
# Start standalone for development or direct testing
node mcp-server/dist/index.js
```

Server output (written strictly to `stderr` to preserve stdio JSON-RPC):
```
[DOMRay] Starting MCP server v0.1.0
[DOMRay] Session token written to: ~/.domray/session.token
[DOMRay Bridge] Listening on http://127.0.0.1:9123 and ws://127.0.0.1:9123
[DOMRay] MCP server ready. Waiting for AI agent connection...
```

### 4. Connect Extension & Open Side Panel

1. Navigate to the web application you want to debug.
2. Click the **DOMRay** icon in your toolbar.
3. Click **⚡ Auto-Connect (1-Click)** (The badge will turn 🟢 **Connected**).
4. Click **Attach Debugger** (Chrome will display the standard debugger infobar).
5. Click **🖥️ Open Live Telemetry Panel** to launch the side panel docked next to your page!

### 5. Configure Your AI Coding Agent

Add DOMRay to your AI agent's MCP configuration file (e.g. `~/.cursor/mcp.json`, Claude Code, or Windsurf config):

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

*Note: No environment variables are required by default. Auto-pairing handles extension authorization seamlessly.*

---

## MCP Tools Reference

DOMRay exposes 8 tools to AI coding agents:

| Tool | Description | Key Parameters |
| :--- | :--- | :--- |
| `domray_get_active_session` | Returns the currently attached tab URL, page title, uptime, and buffer counts. | None |
| `domray_get_latest_error` | Returns the latest unhandled runtime exception, formatted stack trace, up to 15 causal user breadcrumbs, and preceding console warnings. | `include_breadcrumbs: boolean` (default: `true`) |
| `domray_get_flow_timeline` | Interleaves user interactions, API network calls, console messages, and exceptions into a single chronological replay for investigating causal flows and silent logic bugs. | `limit: number` (default: `30`), `include_network: boolean` (default: `true`), `include_console: boolean` (default: `true`), `failed_network_only: boolean` (default: `false`) |
| `domray_get_console_logs` | Returns live browser console messages (`log`, `info`, `warn`, `error`) captured via CDP. | `level: "all" \| "error" \| "warn" \| "info" \| "log"` (default: `"all"`), `limit: number` (default: `30`), `search?: string` |
| `domray_get_storage_state` | Inspects client-side browser storage (`localStorage`, `sessionStorage`, or cookies) with edge-side secret masking. | `storage_type: "local" \| "session" \| "cookies"` (default: `"local"`), `key?: string` |
| `domray_get_network_timeline` | Returns recent HTTP requests captured by the page (status, duration, headers). | `failed_only: boolean` (default: `true`), `limit: number` (default: `10`) |
| `domray_get_scoped_dom` | Returns a token-pruned, sanitized HTML subtree for a given CSS selector. | `selector: string`, `max_depth: number` (default: `3`), `max_characters: number` (default: `4000`) |
| `domray_get_component_state` | Harvests internal runtime state: React Fiber `props`/`state` (with hooks unrolling & hierarchy) or Vue 3 `setupState`/`props` (dev & prod). | `selector: string` (e.g. `'#root'`, `'.cart-item'`, `'form#checkout'`) |

---

## Enterprise Security & Zero-Data-Leak Guarantees

1. **CSWSH Protection (Cross-Site WebSocket Hijacking):**  
   The local server rejects any connection whose `Origin` header is not an authorized `chrome-extension://<EXTENSION_ID>`. Normal web pages (`http://`, `https://`) are rejected immediately.
2. **Ephemeral Session Tokens:**  
   Every time the MCP server boots, it generates a fresh 32-byte cryptographic random token. Connections must provide this token.
3. **Timing-Safe Authentication:**  
   Tokens are validated using `crypto.timingSafeEqual` to prevent timing side-channel attacks.
4. **Edge Redaction (Zero Leakage Before Dispatch):**  
   All redaction happens in the browser extension **before** data is sent over the local socket:
   - `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-Auth-Token` are replaced with `***MASKED***`.
   - Sensitive URL query parameters (`token`, `secret`, `password`, `key`) are masked.
   - Form inputs with `type="password"`, sensitive names (`cvv`, `card`, `pin`), or `data-private` never transmit their values.
   - Storage values for keys matching authentication or secrets are masked.
5. **Strict Loopback Binding:**  
   The HTTP/WS bridge binds exclusively to `127.0.0.1`. No external networking or telemetry servers are contacted.

---

## Project Structure

```
domray/
├── package.json                          # Monorepo root workspace (npm workspaces)
├── tsconfig.base.json                    # Shared base TypeScript configuration
├── README.md                             # Comprehensive project documentation
├── mcp-server/                           # Local MCP Server (Node.js & TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                      # stdio transport & MCP server entrypoint
│       ├── ws-bridge.ts                  # Hybrid HTTP (/pair) + WebSocket bridge
│       ├── session-store.ts              # Circular ring buffers & callback maps
│       ├── security.ts                   # Token generation, origin whitelist & validation
│       └── tools/
│           ├── session-tools.ts          # domray_get_active_session
│           ├── error-tools.ts            # domray_get_latest_error (Enriched with breadcrumbs)
│           ├── timeline-tools.ts         # domray_get_flow_timeline (Unified replay)
│           ├── console-tools.ts          # domray_get_console_logs
│           ├── storage-tools.ts          # domray_get_storage_state
│           ├── network-tools.ts          # domray_get_network_timeline
│           ├── dom-tools.ts              # domray_get_scoped_dom
│           ├── dom-sanitizer.ts          # Semantic DOM Sanitizer & Token Pruner
│           └── framework-tools.ts        # domray_get_component_state (Fiber/Vue)
└── extension/                            # Chrome Extension (Manifest V3)
    ├── manifest.json                     # MV3 manifest with debugger, storage, sidePanel, content_scripts
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts                    # Build config (SW ESM, Popup IIFE, Sidepanel IIFE, Tracker IIFE)
    └── src/
        ├── content/
        │   └── tracker.ts                # User interaction tracker (clicks, inputs, submits, SPA navigation)
        ├── background/
        │   ├── index.ts                  # Service Worker entry (synchronous top-level listeners)
        │   ├── cdp-client.ts             # CDP wrapper (Runtime, Network, Fiber inspector, Storage)
        │   ├── ring-buffer.ts            # Circular buffers (Errors, Network, Breadcrumbs, Console)
        │   ├── redaction.ts              # Edge-side header, URL, and credential maskers
        │   └── ws-client.ts              # WebSocket client, keepalive heartbeat & auto-pair
        ├── popup/                        # Extension popup (1-Click connect & status)
        │   ├── popup.html
        │   ├── popup.css
        │   └── popup.ts
        ├── sidepanel/                    # 🖥️ Live Telemetry & AI Audit Side Panel
        │   ├── sidepanel.html
        │   ├── sidepanel.css
        │   └── sidepanel.ts
        └── utils/
            └── constants.ts              # Port, buffer limits, and masked key sets
├── articles/
│   └── bridging-the-runtime-gap-for-ai-coding-agents.md  # 📰 Deep-dive engineering article
└── examples/
    └── checkout-app/                             # 🛒 Runnable case study application (React 18 + Vite)
        ├── src/
        │   ├── App.tsx                           # Simulated SSO & session storage
        │   └── components/
        │       ├── CouponForm.tsx                # 🐛 Contains the case-study bug
        │       ├── OrderSummary.tsx
        │       ├── CheckoutLayout.tsx
        │       └── WalkthroughGuide.tsx
        ├── vite.config.ts                        # Built-in mock API middleware (/api/cart/coupon)
        └── README.md
```

---

## 🛒 Real-World Playground Example

We provide a ready-to-run React 18 application simulating the exact case study from our article (*"The Case of the Frozen Button"*):

```bash
# 1. Install dependencies
npm install

# 2. Launch the example app (starts on http://localhost:5173)
npm run dev:example
```

* **The Scenario:** Enterprise checkout page with simulated SSO 2FA session cookies.
* **The Bug:** Entering `EXPIRED20` triggers an HTTP 422 response. Due to a state bug in `CouponForm.tsx`, `isSubmitting` is never reset to `false`, permanently freezing the button without throwing any unhandled JavaScript errors.
* **Diagnosing with AI:** Prompt your AI coding agent (Cursor, Claude Code, Antigravity):
  > *"The apply coupon button is stuck in a disabled state. Can you inspect the active page with DOMRay and fix the issue in `CouponForm.tsx`?"*
* **The Result:** The AI uses `domray_get_flow_timeline` (sees the click and HTTP 422) and `domray_get_component_state` (inspects React Fiber hooks to see `isSubmitting: true`), and produces the exact fix in seconds!

---

## 📰 Articles & Publications

* **[Bridging the Runtime Blindspot: Giving AI Coding Agents Eyes Behind Auth Walls and Modern Web State](articles/bridging-the-runtime-gap-for-ai-coding-agents.md)**  
  *A comprehensive 8-minute deep dive on how DOMRay solves the authentication barrier, unrolls React/Vue internal state, tracks user breadcrumbs, and maintains enterprise-grade security.*

---

## Development & Testing

```bash
# Start MCP server in watch mode
npm run dev:server

# Start Chrome Extension in watch mode (auto-recompiles on file edit)
npm run dev:extension

# Start the example checkout app
npm run dev:example

# Test MCP tools interactively using official MCP Inspector
npx @modelcontextprotocol/inspector node mcp-server/dist/index.js
```

---

## Roadmap & Shipped Status

- [x] **Chrome DevTools Protocol (CDP) Telemetry Engine** (Exceptions, console, network)
- [x] **MV3 Service Worker Lifecycle Management** (15s heartbeat keepalive + session storage recovery)
- [x] **Edge-Side Data Masking** (Sensitive headers, passwords, and tokens)
- [x] **Zero-Friction 1-Click Auto-Pairing** (`POST/GET /pair` loopback handshake)
- [x] **User Action Tracking & Causal Breadcrumbs** (Clicks, inputs, form submits, SPA route changes)
- [x] **Unified Chronological Flow Timeline** (`domray_get_flow_timeline` for silent & logic bugs)
- [x] **Live Console Stream Inspector** (`domray_get_console_logs` filterable by level)
- [x] **Client Storage State Inspector** (`domray_get_storage_state` for localStorage/sessionStorage/cookies)
- [x] **State Lifecycle Auto-Reset & 1-Click Clear** (Clean detach/attach state + sidebar purge)
- [x] **Semantic DOM Sanitizer & Token Pruner** (-80% LLM token consumption)
- [x] **Framework State Inspector** (React Fiber props/state & Vue 3 setupState)
- [x] **DevTools F12 Auto-Heal** (Detection and graceful pause/re-attach)
- [x] **Live Telemetry & AI Audit Side Panel** (`chrome.sidePanel` real-time transparency dashboard)
- [ ] **Accessibility Tree Mode** (Direct CDP `Accessibility.getFullAXTree` export option)
- [ ] **Native Messaging Transport** (Alternative loopback transport without WebSockets)
