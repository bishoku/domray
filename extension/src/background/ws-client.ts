/**
 * ws-client.ts — WebSocket client connecting to the DOMRay MCP server.
 *
 * Lifecycle:
 *   - connect() is called once the user provides a valid token via popup
 *   - A heartbeat is sent every 15s to keep the MV3 Service Worker alive
 *   - On unexpected close, auto-reconnect up to MAX_RECONNECT_ATTEMPTS
 *   - On server-side DOM query request, forwards to cdp-client and replies
 */

import {
  WS_URL_BASE,
  HEARTBEAT_INTERVAL_MS,
  RECONNECT_DELAY_MS,
  MAX_RECONNECT_ATTEMPTS,
  STORAGE_KEY_TOKEN,
} from "../utils/constants.js";
import {
  errorBuffer,
  networkBuffer,
  breadcrumbBuffer,
  consoleBuffer,
  type ErrorEntry,
  type NetworkEntry,
  type BreadcrumbEntry,
  type ConsoleEntry,
} from "./ring-buffer.js";
import { getActiveTabId, queryDom, inspectComponentState, inspectStorage } from "./cdp-client.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type WsStatus = "disconnected" | "connecting" | "connected" | "error";

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let currentStatus: WsStatus = "disconnected";
let currentToken: string | null = null;

type StatusChangeCallback = (status: WsStatus) => void;
const statusListeners: StatusChangeCallback[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getWsStatus(): WsStatus {
  return currentStatus;
}

export function onStatusChange(cb: StatusChangeCallback): void {
  statusListeners.push(cb);
}

/** Requests auto-pairing from local MCP server via HTTP POST /pair */
export async function autoPairAndConnect(): Promise<{ success: boolean; error?: string }> {
  try {
    const extId = chrome.runtime.id;
    const pairUrl = `http://127.0.0.1:9123/pair?extensionId=${encodeURIComponent(extId)}`;
    const res = await fetch(pairUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DOMRay-Extension-Id": extId,
      },
      body: JSON.stringify({ extensionId: extId }),
    });

    if (!res.ok) {
      let serverError = `Server returned HTTP ${res.status}`;
      try {
        const errJson = (await res.json()) as { error?: string };
        if (errJson.error) serverError += `: ${errJson.error}`;
      } catch {
        // Fallback to HTTP status
      }
      return { success: false, error: serverError };
    }

    const data = (await res.json()) as { ok: boolean; token?: string; error?: string };
    if (!data.ok || !data.token) {
      return { success: false, error: data.error ?? "Pairing failed" };
    }

    await connectWithToken(data.token);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Cannot reach DOMRay server at 127.0.0.1:9123: ${msg}` };
  }
}

/** Loads token from storage and connects. */
export async function connectFromStorage(): Promise<void> {
  const result = await chrome.storage.session.get(STORAGE_KEY_TOKEN);
  const token = result[STORAGE_KEY_TOKEN] as string | undefined;
  if (token) {
    currentToken = token;
    connect(token);
  }
}

/** Saves token and connects. Called from popup when user submits token. */
export async function connectWithToken(token: string): Promise<void> {
  currentToken = token;
  await chrome.storage.session.set({ [STORAGE_KEY_TOKEN]: token });
  connect(token);
}

export async function disconnectWs(): Promise<void> {
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
  stopHeartbeat();
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
  currentToken = null;
  await chrome.storage.session.remove([STORAGE_KEY_TOKEN, "domray_session_token"]);
  setStatus("disconnected");
}

// ---------------------------------------------------------------------------
// Internal connect
// ---------------------------------------------------------------------------

function connect(token: string): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = `${WS_URL_BASE}?token=${encodeURIComponent(token)}`;
  setStatus("connecting");

  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectAttempts = 0;
    setStatus("connected");
    startHeartbeat();
    void sendSessionInfo();
    flushBuffers();
  };

  ws.onmessage = (event: MessageEvent) => {
    handleIncoming(event.data as string);
  };

  ws.onerror = () => {
    setStatus("error");
  };

  ws.onclose = () => {
    stopHeartbeat();
    if (currentStatus !== "error") setStatus("disconnected");

    // Auto-reconnect
    if (currentToken && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(() => {
        if (currentToken) connect(currentToken);
      }, RECONNECT_DELAY_MS);
    }
  };
}

// ---------------------------------------------------------------------------
// Heartbeat — keeps Service Worker alive (resets 30s idle timer)
// ---------------------------------------------------------------------------

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    send({ type: "heartbeat" });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Send session metadata on connect, attach, and tab navigation
// ---------------------------------------------------------------------------

export async function sendSessionInfo(targetTabId?: number): Promise<void> {
  const tabId = targetTabId ?? getActiveTabId();
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) {
        send({
          type: "session-info",
          tabId: tab.id ?? tabId,
          url: tab.url ?? "",
          title: tab.title ?? "",
        });
        return;
      }
    } catch {
      // Tab may not exist
    }
  }

  // Fallback: active tab query
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      send({
        type: "session-info",
        tabId: tab.id ?? -1,
        url: tab.url ?? "",
        title: tab.title ?? "",
      });
    }
  } catch {
    // Ignore
  }
}

// ---------------------------------------------------------------------------
// Flush buffered data immediately after connection
// ---------------------------------------------------------------------------

function flushBuffers(): void {
  for (const e of errorBuffer.toArray()) {
    send({ type: "error", payload: e });
  }
  for (const n of networkBuffer.toArray()) {
    send({ type: "network", payload: n });
  }
  for (const b of breadcrumbBuffer.toArray()) {
    send({ type: "breadcrumb", payload: b });
  }
  for (const c of consoleBuffer.toArray()) {
    send({ type: "console", payload: c });
  }
}

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

export function sendError(entry: ErrorEntry): void {
  send({ type: "error", payload: entry });
}

export function sendNetwork(entry: NetworkEntry): void {
  send({ type: "network", payload: entry });
}

export function sendBreadcrumb(entry: BreadcrumbEntry): void {
  send({ type: "breadcrumb", payload: entry });
}

export function sendConsole(entry: ConsoleEntry): void {
  send({ type: "console", payload: entry });
}

export function sendResetStore(): void {
  send({ type: "reset-store" });
}

function send(obj: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ---------------------------------------------------------------------------
// Incoming message handler (server → extension)
// ---------------------------------------------------------------------------

export interface AiAuditEvent {
  toolName: string;
  timestamp: number;
  params: Record<string, unknown>;
  summary: string;
}

type IncomingMessage =
  | {
      type: "dom-query";
      requestId: string;
      selector: string;
      maxDepth: number;
    }
  | {
      type: "component-state-query";
      requestId: string;
      selector: string;
    }
  | {
      type: "ai-audit-event";
      toolName: string;
      timestamp: number;
      params: Record<string, unknown>;
      summary: string;
    }
  | {
      type: "storage-query";
      requestId: string;
      storageType: "local" | "session" | "cookies";
      key?: string;
    };

function handleIncoming(raw: string): void {
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(raw) as IncomingMessage;
  } catch {
    return;
  }

  if (msg.type === "dom-query") {
    // Execute DOM query and respond
    queryDom(msg.selector, msg.maxDepth)
      .then((html) => {
        send({ type: "dom-response", requestId: msg.requestId, html });
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        send({ type: "dom-response", requestId: msg.requestId, html: "", error });
      });
  } else if (msg.type === "component-state-query") {
    // Execute React / Vue component state inspection and respond
    inspectComponentState(msg.selector)
      .then((data) => {
        send({ type: "component-state-response", requestId: msg.requestId, data });
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        send({
          type: "component-state-response",
          requestId: msg.requestId,
          data: JSON.stringify({ error }),
        });
      });
  } else if (msg.type === "storage-query") {
    inspectStorage(msg.storageType, msg.key)
      .then((data) => {
        send({ type: "storage-response", requestId: msg.requestId, data });
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        send({
          type: "storage-response",
          requestId: msg.requestId,
          data: JSON.stringify({ error }),
        });
      });
  } else if (msg.type === "ai-audit-event") {
    // Record AI audit event to chrome.storage.session for Side Panel
    chrome.storage.session.get("domray_ai_audit_log", (res) => {
      const logs = (res["domray_ai_audit_log"] as AiAuditEvent[] | undefined) ?? [];
      logs.push({
        toolName: msg.toolName,
        timestamp: msg.timestamp,
        params: msg.params,
        summary: msg.summary,
      });
      if (logs.length > 50) logs.shift();
      void chrome.storage.session.set({ domray_ai_audit_log: logs });
    });
  }
}

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

function setStatus(status: WsStatus): void {
  currentStatus = status;
  for (const cb of statusListeners) cb(status);
  // Notify popup via storage (popup may not be open)
  void chrome.storage.session.set({ domray_ws_status: status });
}
