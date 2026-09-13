# Bridging the Runtime Blindspot: Giving AI Coding Agents Eyes Behind Auth Walls and Modern Web State

*How DOMRay connects live Chrome runtime telemetry to Cursor, Claude Code, and AI agents via MCP — without headless browsers, token bloat, or security compromises.*

---

## The AI Coding Boom and the "Runtime Blindspot"

If you are a modern frontend developer, your daily workflow has likely transformed over the past year. Tools like Cursor, Claude Code, Windsurf, and Antigravity have made scaffolding components, writing unit tests, and refactoring business logic remarkably fast.

Yet, every frontend engineer inevitably hits a brick wall: **The Runtime Blindspot.**

Web applications are not static files sitting on disk. They are dynamic, living systems. They run on hydration cycles, asynchronous network cascades, and complex client-side state machines built with React 18/19, Vue 3, Pinia, or Redux. More importantly, real-world applications don't live on public, unauthenticated URLs:

* They sit behind **corporate SSO and Okta logins**.
* They require **Hardware 2FA / YubiKeys** or authenticator codes.
* They live behind **private VPNs or zero-trust staging environments**.
* They depend on **authenticated session cookies and ephemeral state**.

When something breaks inside an authenticated web app, what is your workflow today?

```
You encounter a bug
      │
      ▼
Open Chrome DevTools (F12)
      │
      ▼
Manually copy the error message & stack trace
      │
      ▼
Inspect the Network tab, copy the request payload & 422 error response
      │
      ▼
Take a screenshot of the broken UI
      │
      ▼
Switch to your IDE and write a 4-paragraph prompt:
"I was logged in as an admin, clicked on the checkout coupon button,
typed 'SAVE20', submitted the form, and the button got disabled but
nothing updated. Here is the console error, here is the network payload..."
```

This manual "human bridge" is exhausting, lossy, and slow. You spend more time copy-pasting JSON and taking screenshots than actually fixing the bug.

---

## Why Existing Headless Solutions Fail

When developers try to automate this, they often turn to headless browser tools like Puppeteer, Playwright, or browser-automation MCP servers. But for real-world frontend development, these tools fail for three fundamental reasons:

1. **The Auth Barrier:** A headless browser starts with a blank slate. It cannot bypass your company's two-factor authentication, biometric logins, or SSO gates without fragile, hacky credential sharing.
2. **Context & Token Bloat:** Feeding raw `document.body.outerHTML` into an LLM burns 20,000+ tokens on SVG coordinate paths, inline styles, and hundreds of cosmetic Tailwind classes, drowning the model in noise and skyrocketing costs.
3. **The "Silent Bug" Paradox:** Not every bug throws an uncaught JavaScript error. Many of the hardest frontend bugs are **state and logic bugs** — a button stays disabled, a modal fails to open, or a shopping cart total doesn't update. Headless tools that only look for console errors are completely blind to these issues.

We asked ourselves a simple question:

> *What if your AI coding agent could tap directly into the Chrome tab you are already looking at — with full access to the authenticated session, recent user clicks, network traffic, and React/Vue state — in a secure, token-optimized format?*

That is why we built **DOMRay**.

---

## What is DOMRay?

**DOMRay** is an open-source, zero-cloud runtime telemetry engine that bridges your live browser to AI coding agents via the **Model Context Protocol (MCP)**.

It consists of two lightweight components working over a private local loopback connection (`127.0.0.1`):

1. **A Manifest V3 Chrome Extension:** Attaches to your active browser tab using the Chrome DevTools Protocol (CDP) and a non-intrusive background tracker. It observes exceptions, network requests, user interactions (breadcrumbs), and internal framework state.
2. **A Local MCP Server:** Runs locally alongside your IDE (Cursor, Claude Code, etc.), exposing high-level diagnostic tools that AI models can invoke on demand.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        YOUR WORKSTATION (Local Only)                   │
│                                                                        │
│   ┌───────────────────────────┐         ┌──────────────────────────┐   │
│   │   Google Chrome (MV3)     │         │    AI Coding Assistant   │   │
│   │  ┌─────────────────────┐  │         │ (Cursor, Claude Code...) │   │
│   │  │ Authenticated Tab   │  │         └────────────┬─────────────┘   │
│   │  │ (SSO, 2FA, Cookies) │  │                      │                 │
│   │  └──────────┬──────────┘  │                      │ stdio           │
│   │             │ CDP         │                      │                 │
│   │  ┌──────────▼──────────┐  │   ws://127.0.0.1     ┌──────▼──────┐   │
│   │  │ DOMRay Extension    ├──┼─────────────────────►│ DOMRay MCP  │   │
│   │  │ (Telemetry & Audit) │◄─┼──────────────────────┤ Server      │   │
│   │  └─────────────────────┘  │   (Token & CSWSH)    └─────────────┘   │
│   └───────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────────┘
```

Because DOMRay attaches directly to your active browser tab, **zero authentication re-negotiation is required**. If you can see the page in Chrome, your AI agent can inspect the telemetry.

---

## Key Technical Innovations

DOMRay wasn't designed just to dump data into an LLM; it was built to give AI agents the *exact* context they need while preserving privacy and minimizing token usage.

### 1. Causal Breadcrumbs (Tracking How You Got There)
A stack trace tells you *where* code crashed; it never tells you *what the user did* to trigger it. 

DOMRay includes a lightweight content tracker that intercepts user intent without logging keystroke data:
* **Clicks:** Captures target selectors and semantic labels (`Clicked button#apply-coupon "Apply Discount"`).
* **Inputs:** Debounces typing and records field focus while **strictly redacting** passwords, credit cards, CVVs, and fields marked with `data-private`.
* **Form Submissions:** Captures submitted forms and action endpoints.
* **SPA Routing:** Automatically intercepts `history.pushState`, `replaceState`, and `popstate` route transitions.

When an error happens, the AI doesn't just see `TypeError: Cannot read properties of undefined`; it sees the exact 10 steps the user took leading up to that line of code.

### 2. The Unified Flow Timeline (`domray_get_flow_timeline`)
To solve the "Silent Bug" problem where no error is thrown, DOMRay interleaves user interactions, API network calls, console logs, and exceptions into a single chronological replay:

```markdown
| Time | Type | Summary | Details |
| :--- | :--- | :--- | :--- |
| +0ms | 🖱️ CLICK | Clicked button#coupon-btn "Apply" | form#checkout |
| +42ms | 🌐 NETWORK | POST /api/v1/coupons/apply | Status: 422 Unprocessable |
| +48ms | 💬 CONSOLE | [warn] Coupon validation failed | "Code expired on 2026-09-01" |
| +50ms | ⚡ ACTION | Input in input#coupon-code | Cleared |
```

With one tool call, an AI model can immediately recognize: *"The coupon API returned a 422 with an expiration message, but the UI failed to update the error state and left the button disabled."*

### 3. Deep Framework State Inspection (React Fiber & Vue 3)
DOM bugs are frequently state bugs. Attempting to inspect React internal state from the outside is notoriously difficult, especially in modern React 18/19 functional components where state is stored as an internal linked list of hooks.

DOMRay's `domray_get_component_state` tool traverses the runtime fiber tree via CDP `Runtime.evaluate` to:
* **Detect React 18/19 Containers:** Automatically recognizes `__reactContainer$` on `#root` or `body` and navigates down to user components (`<App />`).
* **Unroll Hook Linked Lists:** Decouples `fiber.memoizedState` linked lists into clean, typed JSON:
  * `useState` & `useReducer` values
  * `useRef` current values
  * `useMemo` calculated results
* **Construct Hierarchy Breadcrumbs:** Climbs fiber return chains to show the exact component path (e.g., `App > Dashboard > CartView > CheckoutButton`).
* **Support Vue 3 in Production:** Inspects `_vnode.component` and unwraps reactive `ref().value` (`_v_isRef`) inside `setupState`.

### 4. Semantic DOM Sanitizer (-80% Token Reduction)
Passing raw HTML to an LLM is wasteful. DOMRay features a token-pruning engine:
* Replaces massive `<svg>` icons with concise `<svg aria-label="..." role="img"><!-- [SVG Icon] --></svg>`.
* Strips `<script>`, `<style>`, `<link>`, and `<template>`.
* Prunes cosmetic layout utility classes while preserving semantic and state classes (`error`, `active`, `btn`, `modal`, `hidden`, `is-invalid`).
* Masks sensitive input fields and values.

The result is an **80% to 90% reduction in token consumption**, allowing the AI to focus entirely on structural DOM hierarchy and business logic.

### 5. Transparency: The Live AI Audit Side Panel
Developers should never have to wonder what an AI agent is reading from their browser. 

DOMRay includes a Chrome Side Panel that displays:
* **Live User Interactions:** Real-time stream of captured clicks, inputs, and navigations.
* **Network & Error Monitors:** Filterable views of failed requests and runtime exceptions.
* **AI Audit Feed:** Whenever Cursor, Claude, or any MCP client executes a tool call, DOMRay displays the exact tool name, arguments, and timestamp live in the panel.

---

## Real-World Walkthrough: The Case of the Frozen Button

Let’s look at a realistic scenario that every frontend engineer faces.

### The Problem
You are working on an e-commerce checkout flow behind a staging login. A QA engineer reports:
> *"When I enter an expired coupon code in the cart, the 'Apply' button becomes permanently disabled, but no error message appears on the screen. The user is stuck."*

### The Old Way
1. You log into the staging environment.
2. You open DevTools, reproduce the bug, look at the Console (nothing logged), look at the Network tab (find the request), inspect the React DevTools component tree, find the state variable `isSubmitting: true`, and realize the `finally` block didn't reset the state.
3. You manually explain all this to Cursor or Claude. Total time: **10–15 minutes**.

### The DOMRay Way

1. **Attach:** You open the staging tab in Chrome and click **"Attach"** in the DOMRay Side Panel.
2. **Reproduce:** You type `EXPIRED20` into the input and click "Apply". The button freezes.
3. **Ask the AI:** In Cursor or Claude Code, you simply type:

> *"The coupon apply button is stuck in a disabled state on the checkout page. Can you inspect the active page and fix the issue?"*

### What Happens Under the Hood
1. The AI invokes `domray_get_flow_timeline`:
   * It sees the click event on `button#apply-coupon`.
   * It sees the `POST /api/cart/coupon` request returned HTTP `422 Unprocessable Entity`.
   * It sees zero uncaught errors.
2. The AI invokes `domray_get_component_state` with `selector: "button#apply-coupon"`:
   * DOMRay navigates the React Fiber tree up to `<CouponForm>`.
   * It extracts the component hierarchy: `App > CartPage > CheckoutLayout > CouponForm`.
   * It unrolls the hooks:
     ```json
     {
       "component": "CouponForm",
       "hierarchy": "App > CartPage > CheckoutLayout > CouponForm",
       "state": [
         { "hook": 0, "type": "useState", "value": "EXPIRED20" },
         { "hook": 1, "type": "useState", "value": true } // isSubmitting is stuck at true!
       ]
     }
     ```
3. **The AI's Response:**

> *"I inspected your live browser session. The `POST /api/cart/coupon` endpoint returned a 422 error with `{ error: 'Coupon expired' }`. In `CouponForm.tsx`, your `handleSubmit` function sets `setIsSubmitting(true)` in the `try` block, but does not have a `finally` block or catch handler to reset `setIsSubmitting(false)` when an API error occurs. Here is the fix:"*

The AI applies the diff. You save the file. Total time: **35 seconds**.

---

## Enterprise-Grade Security: Zero Data Leakage

Connecting browser telemetry to AI models raises legitimate security questions. DOMRay was designed with strict security constraints from line one:

* **CSWSH Protection (Cross-Site WebSocket Hijacking):** The local WebSocket server rejects any connection whose `Origin` does not match the authorized Chrome Extension ID. Malicious websites running in other tabs cannot connect to DOMRay.
* **Ephemeral Session Tokens:** Every time the MCP server boots, it generates a fresh, cryptographically secure 32-byte token. The extension authenticates using timing-safe comparisons (`crypto.timingSafeEqual`).
* **Zero-Leak Edge Redaction:** Redaction happens inside the browser extension **before** data is sent over the local socket. `Authorization` headers, session cookies, passwords, and sensitive input fields are replaced with `***MASKED***`.
* **Strict Loopback Binding:** The server binds strictly to `127.0.0.1`. No external ports are opened, and **zero data is ever sent to third-party telemetry servers or cloud services**. Everything stays on your machine.

---

## Getting Started

DOMRay is distributed as a self-contained, open-source monorepo. Everything is built and operated directly from source — no third-party npm packages to install globally and no closed Chrome Web Store submissions to wait for. You retain 100% ownership and local control over your browser telemetry.

### 1. Clone & Build

```bash
# Clone the open-source repository
git clone https://github.com/bishoku/domray.git
cd domray

# Install dependencies and build both workspaces (MCP server & Chrome extension)
npm install
npm run clean && npm run build
```

### 2. Load the Chrome Extension

Because DOMRay inspects your private, local browser sessions, running it directly as an unpacked extension provides full security transparency:

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `extension/dist` folder from the cloned repository.
4. Pin the **DOMRay** icon in your Chrome toolbar for instant access.

### 3. Connect to Your AI Coding Assistant

Add the DOMRay MCP server to your AI tool configuration (for example, in Claude Desktop's `claude_desktop_config.json` or Cursor's MCP Settings):

```json
{
  "mcpServers": {
    "domray": {
      "command": "node",
      "args": ["/absolute/path/to/domray/mcp-server/dist/index.js"]
    }
  }
}
```

### 4. 1-Click Auto-Pairing

1. When the MCP server starts, open the DOMRay popup in Chrome.
2. Click **⚡ Auto-Connect**. The extension securely performs a handshake with the local server, stores the session token, and connects immediately.
3. Click **Attach** on any tab to start streaming telemetry.

---

## The 8 Available MCP Tools

Once connected, your AI coding assistant gains access to 8 specialized tools:

| Tool Name | What the AI Uses It For |
| :--- | :--- |
| `domray_get_active_session` | Checks connected tab title, URL, uptime, and active buffer stats. |
| `domray_get_flow_timeline` | Interleaved chronological replay of user clicks, network requests, console logs, and errors. |
| `domray_get_latest_error` | Inspects the most recent runtime exception, complete with stack trace and preceding user breadcrumbs. |
| `domray_get_component_state` | Harvests internal React Fiber props/hooks or Vue 3 setupState for any CSS selector. |
| `domray_get_scoped_dom` | Retrieves token-pruned, sanitized semantic HTML for any element (-80% token bloat). |
| `domray_get_network_timeline` | Analyzes recent HTTP requests, status codes, and durations with edge-masked headers. |
| `domray_get_console_logs` | Queries the live browser console stream, filterable by severity (`error`, `warn`, `log`) or text search. |
| `domray_get_storage_state` | Inspects `localStorage`, `sessionStorage`, or cookies with automatic secret masking. |

---

## Conclusion: The Next Frontier of AI-Assisted Engineering

AI coding assistants have mastered understanding static source code. The next leap in engineering velocity is giving these models **runtime awareness**.

By bridging the gap between your live, authenticated browser session and your AI coding assistant, DOMRay eliminates the friction of copy-pasting logs, taking screenshots, and writing lengthy bug reproduction steps. It allows you and your AI agent to diagnose complex, stateful web applications together — faster, safer, and with zero context loss.

*Give your AI agent eyes in the browser.*

---

### Resources & Links

* **GitHub Repository:** [github.com/bishoku/domray](https://github.com/bishoku/domray) — Full source code, documentation, and architecture diagrams.
* **Interactive Playground:** [`examples/checkout-app`](https://github.com/bishoku/domray/tree/main/examples/checkout-app) — A runnable React 18 application reproducing *"The Case of the Frozen Button"*.
* **Contributions & Feedback:** Star the project on GitHub, file an issue, or open a discussion!
