/**
 * popup.ts — DOMRay extension popup controller.
 */
export {};

type WsStatus = "disconnected" | "connecting" | "connected" | "error";

interface StatusResponse {
  wsStatus: WsStatus;
  debugAttached: boolean;
  activeTab: number | null;
  activeTabTitle: string | null;
  activeTabUrl: string | null;
  detachReason: string | null;
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const overallBadge = document.getElementById("overall-badge")!;
const openSidepanelBtn = document.getElementById("open-sidepanel-btn");

// Warning banner
const pausedBanner = document.getElementById("paused-banner")!;
const bannerReattachBtn = document.getElementById("banner-reattach-btn")!;

// Card 1: MCP Server
const mcpStatusPill = document.getElementById("mcp-status-pill")!;
const mcpDisconnectedView = document.getElementById("mcp-disconnected-view")!;
const mcpConnectedView = document.getElementById("mcp-connected-view")!;
const autoPairBtn = document.getElementById("auto-pair-btn")!;
const pairError = document.getElementById("pair-error")!;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn")!;

// Card 2: Tab Tracing
const tracingStatusPill = document.getElementById("tracing-status-pill")!;
const sessionTitle = document.getElementById("session-title")!;
const tracingToggleBtn = document.getElementById("tracing-toggle-btn")!;
const capsuleBtn = document.getElementById("capsule-btn")!;
const snapshotBtn = document.getElementById("snapshot-btn")!;
const toastEl = document.getElementById("domray-toast")!;
const toastMessageEl = document.getElementById("toast-message")!;

// Bottom actions
const bottomActions = document.getElementById("bottom-actions")!;
const disconnectBtn = document.getElementById("disconnect-btn")!;

// State cache
let isWsConnected = false;
let isDebugAttached = false;
let currentTabId: number | null = null;

// ---------------------------------------------------------------------------
// Startup — fetch current state from Service Worker
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    currentTabId = tab.id;
    sessionTitle.textContent = tab.title ? `${tab.title}` : (tab.url ?? "—");
    sessionTitle.title = `${tab.title ?? ""} (${tab.url ?? ""})`;
  }

  const status = await sendMessage<StatusResponse>({ type: "get-status" });
  updateUI(status.wsStatus, status.debugAttached, status.activeTab, status.detachReason);

  // Pre-fill token if stored
  const result = await chrome.storage.session.get("domray_session_token");
  const token = result["domray_session_token"] as string | undefined;
  if (token) {
    tokenInput.value = token;
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

// Open Side Panel
openSidepanelBtn?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
      return;
    } catch {
      // Fallback to background message
    }
  }
  await sendMessage({ type: "open-sidepanel" });
  window.close();
});

// ⚡ 1-Click Auto-Pairing (Connects MCP + Auto-Attaches active tab)
autoPairBtn.addEventListener("click", async () => {
  autoPairBtn.setAttribute("disabled", "true");
  autoPairBtn.textContent = "⚡ Connecting to DOMRay…";
  pairError.classList.add("hidden");

  const result = await sendMessage<{ success: boolean; error?: string }>({
    type: "auto-pair",
  });

  if (result.success) {
    setTimeout(init, 300);
  } else {
    pairError.textContent = result.error ?? "Could not connect to DOMRay server at 127.0.0.1:9123.";
    pairError.classList.remove("hidden");
  }

  autoPairBtn.removeAttribute("disabled");
  autoPairBtn.textContent = "⚡ Auto-Connect (1-Click)";
});

// Manual Token Connect
connectBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    tokenInput.focus();
    return;
  }
  connectBtn.setAttribute("disabled", "true");
  connectBtn.textContent = "Connecting…";
  await sendMessage({ type: "connect", token });
  setTimeout(init, 500);
  connectBtn.removeAttribute("disabled");
  connectBtn.textContent = "Connect";
});

// Disconnect All
disconnectBtn.addEventListener("click", async () => {
  disconnectBtn.setAttribute("disabled", "true");
  await sendMessage({ type: "disconnect" });
  tokenInput.value = "";
  await init();
  disconnectBtn.removeAttribute("disabled");
});

// Tracing Toggle Button (Start / Stop)
tracingToggleBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetId = tab?.id ?? currentTabId;
  if (!targetId) return;

  tracingToggleBtn.setAttribute("disabled", "true");

  if (isDebugAttached) {
    tracingToggleBtn.textContent = "Stopping…";
    await sendMessage({ type: "detach-tab", tabId: targetId });
  } else {
    tracingToggleBtn.textContent = "Attaching…";
    const result = await sendMessage<{ success: boolean; error?: string; isDevTools?: boolean }>({
      type: "attach-tab",
      tabId: targetId,
    });
    if (!result.success) {
      alert(`Could not start tracing: ${result.error ?? "unknown error"}`);
    }
  }

  await init();
  tracingToggleBtn.removeAttribute("disabled");
});

// Re-attach from conflict banner
bannerReattachBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetId = tab?.id ?? currentTabId;
  if (!targetId) return;

  bannerReattachBtn.setAttribute("disabled", "true");
  const result = await sendMessage<{ success: boolean; error?: string }>({
    type: "attach-tab",
    tabId: targetId,
  });

  if (!result.success) {
    alert(`Could not re-attach: ${result.error ?? "unknown error"}`);
  }
  await init();
  bannerReattachBtn.removeAttribute("disabled");
});

let toastTimer: number | null = null;
function showToast(msg: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastMessageEl.textContent = msg;
  toastEl.classList.remove("hidden");
  toastTimer = window.setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 2200);
}

// 1-Click AI Context Capsule
capsuleBtn.addEventListener("click", async () => {
  try {
    const res = (await sendMessage<{
      ok: boolean;
      session?: { url: string; title: string };
      latestError?: { message: string; stack?: string };
      breadcrumbs?: Array<{ type: string; description: string }>;
      failedNetwork?: Array<{ method: string; url: string; status?: number; statusText?: string }>;
    }>({ type: "get-capsule-data" }));

    if (!res || !res.ok) {
      showToast("❌ Could not get data");
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
      if (res.latestError.stack) lines.push(`\`\`\`\n${res.latestError.stack.slice(0, 1000)}\n\`\`\``);
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
        lines.push(`- \`${n.method}\` ${n.url} -> **HTTP ${n.status || "ERR"}** ${n.statusText || ""}`);
      });
      lines.push(``);
    }

    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("✅ AI Capsule Copied!");
  } catch {
    showToast("❌ Failed to copy");
  }
});

// Snapshot Trigger
snapshotBtn.addEventListener("click", async () => {
  await sendMessage({ type: "take-snapshot" });
  snapshotBtn.textContent = "✓ Snapshot Taken";
  setTimeout(() => {
    snapshotBtn.textContent = "📸 Snapshot";
  }, 1200);
});

// Update badge when storage changes (SW sends status updates via session storage)
chrome.storage.session.onChanged.addListener((changes) => {
  if (
    "domray_ws_status" in changes ||
    "domray_detach_reason" in changes ||
    "domray_debug_attached" in changes
  ) {
    void init();
  }
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updateUI(
  wsStatus: WsStatus,
  debugAttached: boolean,
  _activeTab: number | null,
  detachReason: string | null,
): void {
  isWsConnected = wsStatus === "connected";
  isDebugAttached = debugAttached;

  // 1. Overall Header Badge
  if (isWsConnected && isDebugAttached) {
    overallBadge.textContent = "READY";
    overallBadge.className = "badge badge--connected";
  } else if (isWsConnected && !isDebugAttached) {
    overallBadge.textContent = "IDLE";
    overallBadge.className = "badge badge--connecting";
  } else {
    overallBadge.textContent = "OFFLINE";
    overallBadge.className = "badge badge--disconnected";
  }

  // 2. Card 1: MCP Server Bridge
  mcpDisconnectedView.classList.toggle("hidden", isWsConnected);
  mcpConnectedView.classList.toggle("hidden", !isWsConnected);

  if (isWsConnected) {
    mcpStatusPill.textContent = "Connected";
    mcpStatusPill.className = "pill pill--connected";
  } else if (wsStatus === "connecting") {
    mcpStatusPill.textContent = "Connecting…";
    mcpStatusPill.className = "pill pill--paused";
  } else {
    mcpStatusPill.textContent = "Offline";
    mcpStatusPill.className = "pill pill--disconnected";
  }

  // 3. DevTools Conflict Warning Banner
  const isDevToolsConflict = !isDebugAttached && detachReason === "devtools";
  pausedBanner.classList.toggle("hidden", !isDevToolsConflict);

  // 4. Card 2: Active Tab Tracing
  if (isDebugAttached) {
    tracingStatusPill.textContent = "Tracing Active";
    tracingStatusPill.className = "pill pill--connected";
    tracingToggleBtn.textContent = "⏹ Stop Tracing";
    tracingToggleBtn.className = "btn btn--secondary btn--sm";
  } else if (isDevToolsConflict) {
    tracingStatusPill.textContent = "Paused (F12)";
    tracingStatusPill.className = "pill pill--paused";
    tracingToggleBtn.textContent = "🔄 Re-attach Tracing";
    tracingToggleBtn.className = "btn btn--warning btn--sm";
  } else {
    tracingStatusPill.textContent = "Not Tracing";
    tracingStatusPill.className = "pill pill--inactive";
    tracingToggleBtn.textContent = "▶ Start Tracing";
    tracingToggleBtn.className = "btn btn--primary btn--sm";
  }

  // 5. Bottom Actions (Disconnect All)
  bottomActions.classList.toggle("hidden", !isWsConnected && !isDebugAttached);
}

// ---------------------------------------------------------------------------
// Messaging helper
// ---------------------------------------------------------------------------

function sendMessage<T = unknown>(msg: unknown): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

void init();
