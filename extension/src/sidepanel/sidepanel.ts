/**
 * sidepanel.ts — DOMRay Live Telemetry & AI Audit Side Panel Controller.
 *
 * Provides real-time reactive monitoring of everything captured by the extension
 * and served to AI coding agents via MCP.
 */

interface ErrorEntry {
  timestamp: number;
  message: string;
  stack?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface NetworkEntry {
  timestamp: number;
  requestId: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  failed: boolean;
  failureReason?: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  durationMs?: number;
}

interface BreadcrumbEntry {
  timestamp: number;
  type: string;
  description: string;
}

interface PersistedRing {
  errors: ErrorEntry[];
  network: NetworkEntry[];
  breadcrumbs: BreadcrumbEntry[];
}

interface AiAuditEvent {
  toolName: string;
  timestamp: number;
  params: Record<string, unknown>;
  summary: string;
}

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const mcpStatusChip = document.getElementById("mcp-status-chip")!;
const mcpChipText = document.getElementById("mcp-chip-text")!;
const tracingStatusChip = document.getElementById("tracing-status-chip")!;
const tracingChipText = document.getElementById("tracing-chip-text")!;

const tabTitleEl = document.getElementById("tab-title")!;
const pausedBanner = document.getElementById("paused-banner")!;
const pausedBannerText = document.getElementById("paused-banner-text")!;
const reattachBtn = document.getElementById("reattach-btn")!;
const attachBtn = document.getElementById("attach-btn")!;
const clearBtn = document.getElementById("clear-btn")!;
const snapshotBtn = document.getElementById("snapshot-btn")!;

const countAuditEl = document.getElementById("count-audit")!;
const countErrorsEl = document.getElementById("count-errors")!;
const countCrumbsEl = document.getElementById("count-crumbs");
const countNetworkEl = document.getElementById("count-network")!;

const auditListEl = document.getElementById("audit-list")!;
const errorsListEl = document.getElementById("errors-list")!;
const breadcrumbsListEl = document.getElementById("breadcrumbs-list");
const networkListEl = document.getElementById("network-list")!;

const netSearchInput = document.getElementById("net-search") as HTMLInputElement;
const netFailedOnlyCheck = document.getElementById("net-failed-only") as HTMLInputElement;

const domSelectorInput = document.getElementById("dom-selector-input") as HTMLInputElement;
const domInspectBtn = document.getElementById("dom-inspect-btn")!;
const frameworkInspectBtn = document.getElementById("framework-inspect-btn")!;
const domResultArea = document.getElementById("dom-result-area")!;

const inspectBtn = document.getElementById("inspect-btn")!;
const capsuleBtn = document.getElementById("capsule-btn")!;
const inspectorCard = document.getElementById("inspector-card")!;
const inspectCompName = document.getElementById("inspect-comp-name")!;
const inspectSelector = document.getElementById("inspect-selector")!;
const inspectLocator = document.getElementById("inspect-locator")!;
const btnCopyLocator = document.getElementById("btn-copy-locator")!;
const btnCopyCompCapsule = document.getElementById("btn-copy-comp-capsule")!;
const btnReinspect = document.getElementById("btn-reinspect")!;
const inspectCloseBtn = document.getElementById("inspect-close-btn")!;
const toastEl = document.getElementById("domray-toast")!;
const toastMessageEl = document.getElementById("toast-message")!;

let isInspecting = false;
let lastInspectedLocator = "";
let lastInspectedElement: any = null;
let toastTimer: number | null = null;

// Local cache
let currentRing: PersistedRing = { errors: [], network: [], breadcrumbs: [] };
let currentAuditLogs: AiAuditEvent[] = [];
let isDebugAttached = false;
let currentTabId: number | null = null;

// ---------------------------------------------------------------------------
// Startup & Re-Sync
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // 1. Fetch active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id ?? null;
    tabTitleEl.textContent = tab.title ? `${tab.title} (${tab.url ?? ""})` : "Active Tab";
  }

  // 2. Fetch session data
  const data = await chrome.storage.session.get([
    "domray_ring",
    "domray_ai_audit_log",
    "domray_ws_status",
    "domray_debug_attached",
    "domray_detach_reason",
  ]);

  currentRing = (data["domray_ring"] as PersistedRing | undefined) ?? { errors: [], network: [], breadcrumbs: [] };
  currentAuditLogs = (data["domray_ai_audit_log"] as AiAuditEvent[] | undefined) ?? [];
  isDebugAttached = (data["domray_debug_attached"] as boolean | undefined) ?? false;

  const wsStatus = (data["domray_ws_status"] as string | undefined) ?? "disconnected";
  const detachReason = (data["domray_detach_reason"] as string | null | undefined) ?? null;

  updateDualStatus(wsStatus, isDebugAttached, detachReason);
  updateDevToolsBanner(detachReason);
  updateAttachButton(detachReason);

  renderAuditLogs();
  renderErrors();
  renderNetwork();
}

// ---------------------------------------------------------------------------
// Reactive Storage Listener
// ---------------------------------------------------------------------------

chrome.storage.session.onChanged.addListener((changes) => {
  if ("domray_ring" in changes) {
    currentRing = (changes["domray_ring"]?.newValue as PersistedRing | undefined) ?? { errors: [], network: [], breadcrumbs: [] };
    renderErrors();
    renderNetwork();
  }

  if ("domray_ai_audit_log" in changes) {
    currentAuditLogs = (changes["domray_ai_audit_log"]?.newValue as AiAuditEvent[] | undefined) ?? [];
    renderAuditLogs();
  }

  if (
    "domray_ws_status" in changes ||
    "domray_debug_attached" in changes ||
    "domray_detach_reason" in changes
  ) {
    void init();
  }
});

// ---------------------------------------------------------------------------
// Tab Switching
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));

    btn.classList.add("active");
    const targetId = btn.getAttribute("data-tab");
    if (targetId) {
      document.getElementById(targetId)?.classList.add("active");
    }
  });
});

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderAuditLogs(): void {
  countAuditEl.textContent = String(currentAuditLogs.length);

  if (currentAuditLogs.length === 0) {
    auditListEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">🤖</span>
        <p class="empty-state__text">No AI tool queries yet</p>
        <p class="empty-state__subtext">When your AI coding agent requests telemetry via MCP, queries will stream here live.</p>
      </div>`;
    return;
  }

  const reversed = [...currentAuditLogs].reverse();
  auditListEl.innerHTML = reversed
    .map((item) => {
      const timeStr = new Date(item.timestamp).toLocaleTimeString();
      const paramsJson = JSON.stringify(item.params, null, 2);
      return `
        <div class="audit-card">
          <div class="audit-card__top">
            <span class="audit-card__tool">${escapeHtml(item.toolName)}</span>
            <span class="audit-card__time">${timeStr}</span>
          </div>
          <p class="audit-card__summary">${escapeHtml(item.summary)}</p>
          <pre class="audit-card__params"><code>${escapeHtml(paramsJson)}</code></pre>
        </div>
      `;
    })
    .join("");
}

function renderErrors(): void {
  const errors = currentRing.errors ?? [];
  const crumbs = currentRing.breadcrumbs ?? [];

  countErrorsEl.textContent = errors.length > 0 ? String(errors.length) : String(crumbs.length);
  if (countCrumbsEl) {
    countCrumbsEl.textContent = `${crumbs.length} action${crumbs.length === 1 ? "" : "s"}`;
  }

  // 1. Render User Interactions (Causal Breadcrumbs)
  if (breadcrumbsListEl) {
    if (crumbs.length === 0) {
      breadcrumbsListEl.innerHTML = `
        <div class="empty-state" style="padding: 20px 16px;">
          <span class="empty-state__icon" style="font-size:24px;">🖱️</span>
          <p class="empty-state__text" style="font-size:12px;">No interactions recorded yet</p>
          <p class="empty-state__subtext" style="font-size:10.5px;">Click buttons, type in inputs, or navigate on the active tab to see live breadcrumbs.</p>
        </div>`;
    } else {
      const recentCrumbs = [...crumbs].slice(-15).reverse();
      breadcrumbsListEl.innerHTML = recentCrumbs
        .map((c) => {
          const timeStr = new Date(c.timestamp).toLocaleTimeString();
          const badgeColor =
            c.type === "click"
              ? "#7aa2f7"
              : c.type === "submit"
              ? "#9ece6a"
              : c.type === "input"
              ? "#bb9af7"
              : "#e0af68";
          return `
            <div style="display:flex; align-items:center; gap:8px; font-size:11px; padding:6px 8px; background:var(--surface); border-radius:4px; border:1px solid var(--border); margin-bottom:4px;">
              <span style="font-size:9px; font-weight:700; color:${badgeColor}; text-transform:uppercase; padding:2px 4px; background:rgba(255,255,255,0.05); border-radius:3px;">${c.type}</span>
              <span class="truncate" style="flex:1; color:var(--text-bright); font-family:var(--font-mono); font-size:11px;" title="${escapeHtml(c.description)}">${escapeHtml(c.description)}</span>
              <span style="font-size:9px; color:var(--text-dim); white-space:nowrap;">${timeStr}</span>
            </div>
          `;
        })
        .join("");
    }
  }

  // 2. Render Exceptions
  if (errors.length === 0) {
    errorsListEl.innerHTML = `
      <div class="empty-state" style="padding: 20px 16px;">
        <span class="empty-state__icon" style="font-size:24px;">✅</span>
        <p class="empty-state__text" style="font-size:12px;">Zero errors recorded</p>
        <p class="empty-state__subtext" style="font-size:10.5px;">Unhandled exceptions on the page will be caught, frozen, and timestamped here.</p>
      </div>`;
  } else {
    const reversed = [...errors].reverse();
    errorsListEl.innerHTML = reversed
      .map((err) => {
        const timeStr = new Date(err.timestamp).toLocaleTimeString();
        return `
          <div class="error-card">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span class="error-card__msg">${escapeHtml(err.message)}</span>
              <span style="font-size:10px; color:var(--text-dim);">${timeStr}</span>
            </div>
            ${err.url ? `<span class="error-card__src">${escapeHtml(err.url)}:${err.lineNumber ?? "?"}</span>` : ""}
            ${err.stack ? `<pre class="error-card__stack"><code>${escapeHtml(err.stack)}</code></pre>` : ""}
          </div>
        `;
      })
      .join("");
  }
}

function renderNetwork(): void {
  let list = currentRing.network;
  countNetworkEl.textContent = String(list.length);

  const query = netSearchInput.value.toLowerCase().trim();
  const failedOnly = netFailedOnlyCheck.checked;

  if (failedOnly) {
    list = list.filter((n) => n.failed || (n.status !== undefined && n.status >= 400));
  }

  if (query) {
    list = list.filter((n) => n.url.toLowerCase().includes(query) || String(n.status).includes(query) || n.method.toLowerCase().includes(query));
  }

  if (list.length === 0) {
    networkListEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">🌐</span>
        <p class="empty-state__text">No network requests match</p>
        <p class="empty-state__subtext">XHR and fetch requests will stream here as the page communicates with APIs.</p>
      </div>`;
    return;
  }

  const reversed = [...list].reverse();
  networkListEl.innerHTML = reversed
    .map((item, idx) => {
      const isFailed = item.failed || (item.status !== undefined && item.status >= 400);
      const statusClass = isFailed ? "net-status--fail" : "net-status--ok";
      const statusLabel = item.failed ? "FAIL" : (item.status ?? "…");

      const headerEntries = Object.entries(item.requestHeaders);
      const hasHeaders = headerEntries.length > 0;

      const headerRows = headerEntries
        .map(([k, v]) => {
          const isMasked = v === "***MASKED***";
          return `
            <div class="net-header-row">
              <span class="net-header-name">${escapeHtml(k)}:</span>
              <span class="net-header-val ${isMasked ? "net-header-val--masked" : ""}">${isMasked ? "🛡️ ***MASKED***" : escapeHtml(v)}</span>
            </div>
          `;
        })
        .join("");

      return `
        <div class="net-card" data-idx="${idx}">
          <div class="net-card__main">
            <span class="net-method net-method--${item.method}">${item.method}</span>
            <span class="net-status ${statusClass}">${statusLabel}</span>
            <span class="net-url truncate" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
            <span class="net-duration">${item.durationMs !== undefined ? `${item.durationMs}ms` : "—"}</span>
          </div>
          ${hasHeaders ? `<div class="net-card__details hidden">${headerRows}</div>` : ""}
        </div>
      `;
    })
    .join("");

  // Toggle details on click
  document.querySelectorAll(".net-card").forEach((card) => {
    card.addEventListener("click", () => {
      const details = card.querySelector(".net-card__details");
      if (details) details.classList.toggle("hidden");
    });
  });
}

// ---------------------------------------------------------------------------
// Actions & Buttons
// ---------------------------------------------------------------------------

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-buffers" });
  currentRing = { errors: [], network: [], breadcrumbs: [] };
  currentAuditLogs = [];
  renderAuditLogs();
  renderErrors();
  renderNetwork();
  clearBtn.textContent = "✓";
  setTimeout(() => { clearBtn.textContent = "🧹"; }, 1000);
});

snapshotBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "take-snapshot" });
  snapshotBtn.textContent = "✓";
  setTimeout(() => { snapshotBtn.textContent = "📸"; }, 1000);
});

attachBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? currentTabId;
  if (!currentTabId) return;

  attachBtn.setAttribute("disabled", "true");

  if (isDebugAttached) {
    attachBtn.textContent = "Stopping…";
    await chrome.runtime.sendMessage({ type: "detach-tab", tabId: currentTabId });
  } else {
    attachBtn.textContent = "Attaching…";
    const res = (await chrome.runtime.sendMessage({
      type: "attach-tab",
      tabId: currentTabId,
    })) as { success?: boolean; error?: string; isDevTools?: boolean };

    if (res && !res.success) {
      alert(`Could not start tracing: ${res.error ?? "Unknown error"}`);
    }
  }

  await init();
  attachBtn.removeAttribute("disabled");
});

reattachBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? currentTabId;
  if (!currentTabId) return;

  reattachBtn.setAttribute("disabled", "true");
  reattachBtn.textContent = "Attaching…";
  const res = (await chrome.runtime.sendMessage({
    type: "attach-tab",
    tabId: currentTabId,
  })) as { success?: boolean; error?: string };

  reattachBtn.removeAttribute("disabled");
  reattachBtn.textContent = "Re-attach";

  if (res && !res.success) {
    alert(`Could not re-attach: ${res.error ?? "Unknown error"}`);
  }
  await init();
});

mcpStatusChip.addEventListener("click", async () => {
  const data = await chrome.storage.session.get("domray_ws_status");
  if (data["domray_ws_status"] !== "connected") {
    mcpChipText.textContent = "MCP: Connecting…";
    await chrome.runtime.sendMessage({ type: "auto-pair" });
    await init();
  }
});

// Listen to tab switches and updates
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  currentTabId = activeInfo.tabId;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    tabTitleEl.textContent = tab.title ? `${tab.title} (${tab.url ?? ""})` : "Active Tab";
  } catch {}
  await init();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId === currentTabId && changeInfo.status === "complete") {
    tabTitleEl.textContent = tab.title ? `${tab.title} (${tab.url ?? ""})` : "Active Tab";
    await init();
  }
});

netSearchInput.addEventListener("input", renderNetwork);
netFailedOnlyCheck.addEventListener("change", renderNetwork);

// DOM & State Inspection
domInspectBtn.addEventListener("click", async () => {
  const sel = domSelectorInput.value.trim() || "body";
  domResultArea.textContent = "Querying and pruning DOM…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Send Runtime.evaluate via background debugger
    const res = await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(sel)})?.outerHTML || 'Element not found'`,
      returnByValue: true,
    }) as { result?: { value?: string } };

    const raw = res.result?.value ?? "Element not found";
    domResultArea.textContent = raw.length > 5000 ? `${raw.slice(0, 5000)}\n\n[Truncated...]` : raw;
  } catch (err) {
    domResultArea.textContent = `Error: ${String(err)}`;
  }
});

frameworkInspectBtn.addEventListener("click", async () => {
  const sel = domSelectorInput.value.trim() || "#root";
  domResultArea.textContent = "Harvesting React Fiber / Vue component state…";

  try {
    const res = (await chrome.runtime.sendMessage({
      type: "inspect-component",
      selector: sel,
    })) as { ok?: boolean; data?: string; error?: string };

    if (!res || !res.ok) {
      domResultArea.textContent = `Inspection error: ${res?.error ?? "Unknown error"}`;
      return;
    }

    try {
      const parsed = JSON.parse(res.data ?? "{}");
      domResultArea.textContent = JSON.stringify(parsed, null, 2);
    } catch {
      domResultArea.textContent = res.data ?? "No state returned";
    }
  } catch (err) {
    domResultArea.textContent = `Inspection error: ${String(err)}`;
  }
});

// ---------------------------------------------------------------------------
// 1-Click AI Context Capsule & Visual Element Inspector
// ---------------------------------------------------------------------------

function showToast(msg: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastMessageEl.textContent = msg;
  toastEl.classList.remove("hidden");
  toastTimer = window.setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 2500);
}

capsuleBtn.addEventListener("click", () => {
  void copyContextCapsule();
});

async function copyContextCapsule(): Promise<void> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "get-capsule-data" })) as {
      ok: boolean;
      session?: { url: string; title: string; tabId: number; timestamp: number };
      latestError?: ErrorEntry | null;
      breadcrumbs?: BreadcrumbEntry[];
      failedNetwork?: NetworkEntry[];
      recentConsole?: Array<{ type: string; text: string }>;
      inspectedElement?: {
        selector: string;
        componentName?: string;
        role?: string;
        accessibleName?: string;
        testId?: string;
        outerHtml?: string;
      } | null;
    };

    if (!res || !res.ok) {
      showToast("❌ Could not retrieve session data");
      return;
    }

    const lines: string[] = [
      `# 🐞 DOMRay Telemetry Context Capsule`,
      `**Session:** ${res.session?.title || "Active Page"} (\`${res.session?.url || "unknown"}\`)`,
      `**Timestamp:** ${new Date().toISOString()}`,
      ``,
    ];

    if (res.latestError) {
      lines.push(`## 🔴 Latest Runtime Exception`);
      lines.push(`**Error:** \`${res.latestError.message}\``);
      if (res.latestError.stack) {
        lines.push(`\`\`\`\n${res.latestError.stack.slice(0, 1000)}\n\`\`\``);
      }
      lines.push(``);
    }

    if (res.inspectedElement) {
      const el = res.inspectedElement;
      lines.push(`## 🎯 Inspected Component / Element`);
      if (el.componentName) lines.push(`**Component:** \`<${el.componentName}>\``);
      lines.push(`**Selector:** \`${el.selector}\``);
      const loc =
        el.role && el.accessibleName
          ? `page.getByRole('${el.role}', { name: '${el.accessibleName}' })`
          : el.testId
          ? `page.getByTestId('${el.testId}')`
          : `page.locator('${el.selector}')`;
      lines.push(`**Playwright Locator:** \`${loc}\``);
      lines.push(``);
    }

    if (res.breadcrumbs && res.breadcrumbs.length > 0) {
      lines.push(`## 👣 Recent User Actions (Breadcrumbs)`);
      res.breadcrumbs.forEach((b, idx) => {
        lines.push(`${idx + 1}. [${b.type}] ${b.description}`);
      });
      lines.push(``);
    }

    if (res.failedNetwork && res.failedNetwork.length > 0) {
      lines.push(`## 🌐 Failed Network Calls`);
      res.failedNetwork.forEach((n) => {
        lines.push(`- \`${n.method}\` ${n.url} -> **HTTP ${n.status || "ERR"}** ${n.statusText || n.failureReason || ""}`);
      });
      lines.push(``);
    }

    if (res.recentConsole && res.recentConsole.length > 0) {
      lines.push(`## 💬 Recent Console Warnings & Errors`);
      res.recentConsole.forEach((c) => {
        lines.push(`- \`[${c.type}]\` ${c.text.slice(0, 150)}`);
      });
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(`*Generated by DOMRay for AI-assisted debugging & test writing.*`);

    const md = lines.join("\n");
    await navigator.clipboard.writeText(md);
    showToast("✅ AI Context Capsule Copied! (Ready for ChatGPT/Claude)");
  } catch (err) {
    showToast("❌ Failed to copy capsule: " + String(err));
  }
}

// Visual Element Inspector interactions
inspectBtn.addEventListener("click", async () => {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "toggle-inspect" })) as {
      ok: boolean;
      active?: boolean;
    };
    if (res && res.ok) {
      isInspecting = Boolean(res.active);
      inspectBtn.classList.toggle("active", isInspecting);
      if (isInspecting) {
        showToast("🎯 Inspect Mode: Click any element on the page (Esc to cancel)");
      }
    }
  } catch {
    showToast("❌ Could not toggle inspector");
  }
});

btnReinspect.addEventListener("click", () => {
  inspectBtn.click();
});

inspectCloseBtn.addEventListener("click", () => {
  inspectorCard.classList.add("hidden");
});

btnCopyLocator.addEventListener("click", async () => {
  if (lastInspectedLocator) {
    await navigator.clipboard.writeText(lastInspectedLocator);
    showToast("⚡ Playwright Locator Copied!");
  }
});

btnCopyCompCapsule.addEventListener("click", async () => {
  if (lastInspectedElement) {
    const text = [
      `### Target Component: <${lastInspectedElement.componentName || "Element"}>`,
      `Selector: \`${lastInspectedElement.selector}\``,
      `Playwright: \`${lastInspectedLocator}\``,
      `HTML:`,
      `\`\`\`html\n${lastInspectedElement.outerHtml || ""}\n\`\`\``,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    showToast("📋 Component Details Copied!");
  }
});

// Listen for inspected element messages from content script
chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as { type?: string; payload?: Record<string, any>; active?: boolean };

  if (m.type === "domray-element-inspected" && m.payload) {
    const p = m.payload;
    lastInspectedElement = p;
    isInspecting = false;
    inspectBtn.classList.remove("active");

    let loc = "";
    if (p.role && p.accessibleName) {
      loc = `page.getByRole('${p.role}', { name: '${p.accessibleName}' })`;
    } else if (p.testId) {
      loc = `page.getByTestId('${p.testId}')`;
    } else if (p.accessibleName && p.tagName === "input") {
      loc = `page.getByPlaceholder('${p.accessibleName}')`;
    } else {
      loc = `page.locator('${p.selector}')`;
    }
    lastInspectedLocator = loc;

    inspectCompName.textContent = p.componentName ? `<${p.componentName}>` : `<${p.tagName || "element"}>`;
    inspectSelector.textContent = p.selector;
    inspectLocator.textContent = loc;
    inspectorCard.classList.remove("hidden");

    domSelectorInput.value = p.selector;
    showToast(`🎯 Selected <${p.componentName || p.tagName}>!`);
  }

  if (m.type === "domray-inspect-mode-changed") {
    isInspecting = Boolean(m.active);
    inspectBtn.classList.toggle("active", isInspecting);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateDualStatus(wsStatus: string, debugAttached: boolean, detachReason: string | null): void {
  // 1. MCP Server Status Chip
  if (wsStatus === "connected") {
    mcpStatusChip.className = "status-chip status-chip--connected";
    mcpChipText.textContent = "MCP: Connected";
  } else if (wsStatus === "connecting") {
    mcpStatusChip.className = "status-chip status-chip--paused";
    mcpChipText.textContent = "MCP: Connecting…";
  } else {
    mcpStatusChip.className = "status-chip status-chip--disconnected";
    mcpChipText.textContent = "MCP: Offline (Click to pair)";
  }

  // 2. Tab Tracing Status Chip
  const isDevTools = !debugAttached && detachReason === "devtools";
  if (debugAttached) {
    tracingStatusChip.className = "status-chip status-chip--active";
    tracingChipText.textContent = "Tracing: Active";
  } else if (isDevTools) {
    tracingStatusChip.className = "status-chip status-chip--paused";
    tracingChipText.textContent = "Tracing: F12 Paused";
  } else {
    tracingStatusChip.className = "status-chip status-chip--inactive";
    tracingChipText.textContent = "Tracing: Inactive";
  }
}

function updateDevToolsBanner(reason: string | null): void {
  if (isDebugAttached || !reason || reason !== "devtools") {
    pausedBanner.classList.add("hidden");
    return;
  }

  pausedBanner.classList.remove("hidden");
  pausedBannerText.innerHTML = "⚠️ <strong>Tracing Paused:</strong> Chrome DevTools (F12) is active. Close DevTools to resume.";
}

function updateAttachButton(detachReason: string | null): void {
  const isDevToolsConflict = !isDebugAttached && detachReason === "devtools";
  if (isDebugAttached) {
    attachBtn.textContent = "⏹ Stop Tracing";
    attachBtn.className = "btn btn--sm btn--secondary";
  } else if (isDevToolsConflict) {
    attachBtn.textContent = "🔄 Re-attach";
    attachBtn.className = "btn btn--sm btn--warning";
  } else {
    attachBtn.textContent = "▶ Start Tracing";
    attachBtn.className = "btn btn--sm btn--primary";
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

void init();
