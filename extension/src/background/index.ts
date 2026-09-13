/**
 * index.ts — DOMRay Service Worker entrypoint.
 *
 * CRITICAL MV3 RULE: All event listeners MUST be registered synchronously
 * at the top level. Never register listeners inside async functions or after
 * an await — Chrome won't be able to wake the SW for those events.
 */

import {
  attachToTab,
  detach,
  handleCdpEvent,
  getActiveTabId,
  handleDebuggerDetached,
  inspectComponentState,
  restoreActiveTabId,
} from "./cdp-client.js";
import {
  restoreBuffers,
  breadcrumbBuffer,
  persistBuffers,
  clearAllBuffers,
  type BreadcrumbEntry,
} from "./ring-buffer.js";
import {
  connectFromStorage,
  connectWithToken,
  autoPairAndConnect,
  disconnectWs,
  getWsStatus,
  sendBreadcrumb,
  sendResetStore,
  sendSessionInfo,
} from "./ws-client.js";

// ---------------------------------------------------------------------------
// Top-level event listener registrations (synchronous — MV3 requirement)
// ---------------------------------------------------------------------------

// CDP events from attached debugger
chrome.debugger.onEvent.addListener((source, method, params) => {
  handleCdpEvent(source, method, params);
});

// CDP detach (user clicked "Cancel" on infobar, or DevTools took over)
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`[DOMRay] Debugger detached from tab ${source.tabId}: ${reason}`);
  handleDebuggerDetached(source.tabId);

  // Wipes state on detach
  void clearAllBuffers();
  sendResetStore();

  void chrome.storage.session.set({
    domray_debug_attached: false,
    domray_active_tab: null,
  });

  if (reason === "replaced_with_devtools") {
    void chrome.storage.session.set({ domray_detach_reason: "devtools" });
    void chrome.action.setBadgeText({ text: "F12" });
    void chrome.action.setBadgeBackgroundColor({ color: "#e0af68" });
  } else {
    // Normal detach (user canceled infobar or closed tab) — clear reason
    void chrome.storage.session.set({ domray_detach_reason: null });
    void chrome.action.setBadgeText({ text: "" });
  }
});

// Keyboard shortcut: Ctrl+Shift+D / Cmd+Shift+D → take snapshot
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "take-snapshot" && tab?.id) {
    void takeSnapshot(tab.id);
  }
});

// Tab navigation — update session info when URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const activeTab = getActiveTabId();
  if (tabId === activeTab && changeInfo.status === "complete") {
    void onTabNavigated(tab);
  }
});

// Tab closed — detach debugger
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === getActiveTabId()) {
    void detach();
    void clearAllBuffers();
    sendResetStore();
    void chrome.action.setBadgeText({ text: "" });
  }
});

// Extension icon clicked (when no popup — toggle debug on active tab)
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void toggleDebugging(tab.id);
});

// Messages from popup, sidepanel, and content scripts
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (typeof message !== "object" || message === null) {
    sendResponse({ ok: false });
    return true;
  }

  const msg = message as { type?: string; payload?: unknown };

  // 1. Content Script User Action Breadcrumb
  if (msg.type === "user-action-breadcrumb") {
    const b = (msg as { payload: BreadcrumbEntry }).payload;
    if (sender.tab?.id === getActiveTabId()) {
      breadcrumbBuffer.push(b);
      void persistBuffers();
      sendBreadcrumb(b);
    }
    sendResponse({ ok: true });
    return true;
  }

  // 2. Element inspected event from content script
  if (msg.type === "domray-element-inspected") {
    void chrome.storage.session.set({ domray_inspected_element: msg.payload });
    // Broadcast to open sidepanels
    chrome.runtime.sendMessage(msg).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // 3. Inspect mode changed event
  if (msg.type === "domray-inspect-mode-changed") {
    chrome.runtime.sendMessage(msg).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // 4. Popup / Sidepanel command messages
  void handlePopupMessage(message as PopupMessage, sendResponse);
  return true; // Keep message channel open for async response
});

// ---------------------------------------------------------------------------
// Startup — restore state after SW restart
// ---------------------------------------------------------------------------

void (async () => {
  await restoreBuffers();
  await connectFromStorage();

  // Re-sync debugger state if SW woke up while attached
  try {
    const sessionData = await chrome.storage.session.get([
      "domray_active_tab",
      "domray_debug_attached",
    ]);
    const savedTabId = sessionData["domray_active_tab"] as number | undefined;
    if (savedTabId && sessionData["domray_debug_attached"]) {
      try {
        await chrome.debugger.sendCommand({ tabId: savedTabId }, "Runtime.enable");
        restoreActiveTabId(savedTabId);
        void sendSessionInfo(savedTabId);
      } catch {
        // Tab was closed or debugger was detached while SW was sleeping
        await chrome.storage.session.set({
          domray_debug_attached: false,
          domray_active_tab: null,
          domray_detach_reason: null,
        });
      }
    }
  } catch {
    // Ignore on initial boot
  }
})();

// ---------------------------------------------------------------------------
// Message types from popup / sidepanel
// ---------------------------------------------------------------------------

type PopupMessage =
  | { type: "connect"; token: string }
  | { type: "auto-pair" }
  | { type: "disconnect" }
  | { type: "disconnect-mcp" }
  | { type: "get-status" }
  | { type: "attach-tab"; tabId?: number }
  | { type: "detach-tab"; tabId?: number }
  | { type: "take-snapshot" }
  | { type: "open-sidepanel" }
  | { type: "clear-buffers" }
  | { type: "inspect-component"; selector: string }
  | { type: "toggle-inspect" }
  | { type: "get-capsule-data" };

async function handlePopupMessage(
  msg: PopupMessage,
  sendResponse: (r: unknown) => void,
): Promise<void> {
  switch (msg.type) {
    case "open-sidepanel": {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
          await chrome.sidePanel.open({ tabId: tab.id });
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: "SidePanel API not available on this tab" });
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      break;
    }

    case "clear-buffers": {
      await clearAllBuffers();
      sendResetStore();
      sendResponse({ ok: true });
      break;
    }

    case "auto-pair": {
      const res = await autoPairAndConnect();
      if (res.success) {
        // Clear any old detach reasons upon successful pairing
        await chrome.storage.session.set({ domray_detach_reason: null });

        // Auto-attach active tab in 1 click!
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (
            tab?.id &&
            tab.url &&
            !tab.url.startsWith("chrome://") &&
            !tab.url.startsWith("chrome-extension://")
          ) {
            const attachRes = await attachToTab(tab.id);
            if (attachRes.success) {
              await clearAllBuffers();
              sendResetStore();
              await sendSessionInfo(tab.id);
              await chrome.storage.session.set({
                domray_debug_attached: true,
                domray_active_tab: tab.id,
                domray_detach_reason: null,
              });
              void chrome.action.setBadgeText({ text: "" });
            }
          }
        } catch {
          // Tab attach is best effort
        }
      }
      sendResponse(res);
      break;
    }

    case "connect":
      await connectWithToken(msg.token);
      await chrome.storage.session.set({ domray_detach_reason: null });
      sendResponse({ ok: true });
      break;

    case "disconnect":
      await detach();
      await disconnectWs();
      await clearAllBuffers();
      sendResetStore();
      await chrome.storage.session.set({
        domray_debug_attached: false,
        domray_active_tab: null,
        domray_detach_reason: null,
      });
      void chrome.action.setBadgeText({ text: "" });
      sendResponse({ ok: true });
      break;

    case "disconnect-mcp":
      await disconnectWs();
      sendResponse({ ok: true });
      break;

    case "get-status": {
      const result = await chrome.storage.session.get([
        "domray_ws_status",
        "domray_debug_attached",
        "domray_active_tab",
        "domray_detach_reason",
      ]);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      sendResponse({
        wsStatus: result["domray_ws_status"] ?? getWsStatus() ?? "disconnected",
        debugAttached: result["domray_debug_attached"] ?? false,
        activeTab: result["domray_active_tab"] ?? null,
        activeTabTitle: tab?.title ?? null,
        activeTabUrl: tab?.url ?? null,
        detachReason: result["domray_detach_reason"] ?? null,
      });
      break;
    }

    case "attach-tab": {
      let targetId = msg.tabId;
      if (!targetId) {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        targetId = currentTab?.id;
      }
      if (!targetId) {
        sendResponse({ success: false, error: "No active tab found" });
        break;
      }

      const { success, error, isDevTools } = await attachToTab(targetId);
      if (success) {
        await clearAllBuffers();
        sendResetStore();
        await sendSessionInfo(targetId);
        await chrome.storage.session.set({
          domray_debug_attached: true,
          domray_active_tab: targetId,
          domray_detach_reason: null,
        });
        void chrome.action.setBadgeText({ text: "" });
      } else {
        await chrome.storage.session.set({
          domray_debug_attached: false,
          domray_active_tab: null,
          domray_detach_reason: isDevTools ? "devtools" : null,
        });
      }
      sendResponse({ success, error, isDevTools });
      break;
    }

    case "detach-tab": {
      await detach(msg.tabId);
      await clearAllBuffers();
      sendResetStore();
      await chrome.storage.session.set({
        domray_debug_attached: false,
        domray_active_tab: null,
        domray_detach_reason: null,
      });
      void chrome.action.setBadgeText({ text: "" });
      sendResponse({ success: true });
      break;
    }

    case "take-snapshot": {
      const tabId = getActiveTabId();
      if (tabId) await takeSnapshot(tabId);
      sendResponse({ ok: true });
      break;
    }

    case "inspect-component": {
      try {
        const raw = await inspectComponentState(msg.selector);
        sendResponse({ ok: true, data: raw });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      break;
    }

    case "toggle-inspect": {
      const tabId = getActiveTabId();
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab attached" });
        break;
      }
      try {
        const res = (await chrome.tabs.sendMessage(tabId, { type: "domray-toggle-inspect" })) as {
          active?: boolean;
        };
        sendResponse({ ok: true, active: res?.active });
      } catch (err) {
        sendResponse({ ok: false, error: "Cannot communicate with tab content script. Ensure tab is loaded." });
      }
      break;
    }

    case "get-capsule-data": {
      const activeTabId = getActiveTabId();
      let tabTitle = "(unknown)";
      let tabUrl = "(unknown)";

      if (activeTabId) {
        try {
          const tab = await chrome.tabs.get(activeTabId);
          tabTitle = tab.title || tabTitle;
          tabUrl = tab.url || tabUrl;
        } catch {
          // Tab may be closing
        }
      }

      const errors = errorBuffer.getAll();
      const latestError = errors.length > 0 ? errors[errors.length - 1] : null;
      const breadcrumbs = breadcrumbBuffer.getAll().slice(-15);
      const failedNetwork = networkBuffer
        .getAll()
        .filter((n) => n.failed || (n.status !== undefined && n.status >= 400))
        .slice(-5);
      const recentConsole = consoleBuffer
        .getAll()
        .filter((c) => c.type === "error" || c.type === "warn")
        .slice(-5);

      const sessionStore = await chrome.storage.session.get("domray_inspected_element");
      const inspectedElement = sessionStore["domray_inspected_element"] || null;

      sendResponse({
        ok: true,
        session: {
          url: tabUrl,
          title: tabTitle,
          tabId: activeTabId,
          timestamp: Date.now(),
        },
        latestError,
        breadcrumbs,
        failedNetwork,
        recentConsole,
        inspectedElement,
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Tab navigation handler
// ---------------------------------------------------------------------------

async function onTabNavigated(tab: chrome.tabs.Tab): Promise<void> {
  // Re-enable CDP domains after navigation (they reset on page reload)
  const tabId = tab.id;
  if (!tabId) return;

  try {
    await attachToTab(tabId); // Re-attach if needed
    void sendSessionInfo(tabId);
    breadcrumbBuffer.push({
      timestamp: Date.now(),
      type: "navigation",
      description: `Navigated to: ${tab.url ?? "(unknown)"}`,
    });
    await persistBuffers();
  } catch {
    // Tab may have closed or navigated to a restricted page
  }
}

// ---------------------------------------------------------------------------
// Manual snapshot trigger (Ctrl+Shift+D)
// ---------------------------------------------------------------------------

async function takeSnapshot(tabId: number): Promise<void> {
  breadcrumbBuffer.push({
    timestamp: Date.now(),
    type: "custom",
    description: "Manual snapshot triggered (Ctrl+Shift+D)",
  });
  await persistBuffers();
  // Snapshot request is fulfilled via domray_get_scoped_dom tool on the server side
}

// ---------------------------------------------------------------------------
// Toggle debugging on a tab
// ---------------------------------------------------------------------------

async function toggleDebugging(tabId: number): Promise<void> {
  const activeTab = getActiveTabId();
  if (activeTab === tabId) {
    await detach();
    await chrome.storage.session.set({ domray_debug_attached: false });
  } else {
    const { success } = await attachToTab(tabId);
    if (success) {
      await chrome.storage.session.set({ domray_debug_attached: true, domray_active_tab: tabId });
    }
  }
}
