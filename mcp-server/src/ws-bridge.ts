/**
 * ws-bridge.ts — Hybrid HTTP + WebSocket bridge for DOMRay.
 *
 * Runs on 127.0.0.1:9123:
 *   - HTTP GET /pair: Zero-friction auto-pairing for Chrome Extension.
 *   - HTTP GET /health: Status endpoint.
 *   - WebSocket: Inbound telemetry + bidirectional DOM/Component queries.
 */

import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { validateOrigin, validateToken, registerAllowedExtension, isAllowedExtensionId } from "./security.js";
import { store } from "./session-store.js";
import type {
  ErrorEntry,
  NetworkEntry,
  BreadcrumbEntry,
  ConsoleEntry,
} from "./session-store.js";

export const WS_PORT = 9123;
export const WS_HOST = "127.0.0.1";

// The single active WebSocket client (Extension connection)
let activeClient: WebSocket | null = null;

// ---------------------------------------------------------------------------
// Incoming message types from Extension
// ---------------------------------------------------------------------------

type ExtensionMessage =
  | { type: "session-info"; tabId: number; url: string; title: string }
  | { type: "error"; payload: ErrorEntry }
  | { type: "network"; payload: NetworkEntry }
  | { type: "breadcrumb"; payload: BreadcrumbEntry }
  | { type: "console"; payload: ConsoleEntry }
  | { type: "reset-store" }
  | { type: "dom-response"; requestId: string; html: string; error?: string }
  | { type: "component-state-response"; requestId: string; data: string; error?: string }
  | { type: "storage-response"; requestId: string; data: string; error?: string }
  | { type: "a11y-tree-response"; requestId: string; tree: string; error?: string }
  | { type: "query-cache-response"; requestId: string; data: string; error?: string }
  | { type: "web-vitals"; payload: Record<string, unknown> }
  | { type: "heartbeat" };

// ---------------------------------------------------------------------------
// Queries to Extension (Server -> Extension)
// ---------------------------------------------------------------------------

export function sendDomQuery(
  requestId: string,
  selector: string,
  maxDepth: number,
): boolean {
  if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return false;
  activeClient.send(
    JSON.stringify({ type: "dom-query", requestId, selector, maxDepth }),
  );
  return true;
}

export function sendComponentStateQuery(
  requestId: string,
  selector: string,
): boolean {
  if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return false;
  activeClient.send(
    JSON.stringify({ type: "component-state-query", requestId, selector }),
  );
  return true;
}

export function sendStorageQuery(
  requestId: string,
  storageType: "local" | "session" | "cookies",
  key?: string,
): boolean {
  if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return false;
  activeClient.send(
    JSON.stringify({ type: "storage-query", requestId, storageType, key }),
  );
  return true;
}

export function queryStorage(
  storageType: "local" | "session" | "cookies",
  key?: string,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!isExtensionConnected()) {
      return reject(new Error("No active DOMRay extension connection. Attach debugger in Chrome first."));
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      store.storageQueryCallbacks.delete(requestId);
      reject(new Error(`Storage query timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    store.storageQueryCallbacks.set(requestId, { resolve, reject, timer });

    const sent = sendStorageQuery(requestId, storageType, key);
    if (!sent) {
      clearTimeout(timer);
      store.storageQueryCallbacks.delete(requestId);
      reject(new Error("Failed to dispatch storage query over WebSocket"));
    }
  });
}

export function sendA11yTreeQuery(
  requestId: string,
  selector?: string,
  maxDepth?: number,
  filter?: "all" | "interesting_only",
): boolean {
  if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return false;
  activeClient.send(
    JSON.stringify({ type: "a11y-tree-query", requestId, selector, maxDepth, filter }),
  );
  return true;
}

export function queryA11yTree(
  selector?: string,
  maxDepth?: number,
  filter?: "all" | "interesting_only",
  timeoutMs = 8000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!isExtensionConnected()) {
      return reject(new Error("No active DOMRay extension connection. Attach debugger in Chrome first."));
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      store.a11yTreeCallbacks.delete(requestId);
      reject(new Error(`Accessibility tree query timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    store.a11yTreeCallbacks.set(requestId, { resolve, reject, timer });

    const sent = sendA11yTreeQuery(requestId, selector, maxDepth, filter);
    if (!sent) {
      clearTimeout(timer);
      store.a11yTreeCallbacks.delete(requestId);
      reject(new Error("Failed to dispatch accessibility tree query over WebSocket"));
    }
  });
}

export function sendQueryCacheQuery(
  requestId: string,
  queryKey?: string,
  statusFilter?: string,
): boolean {
  if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return false;
  activeClient.send(
    JSON.stringify({ type: "query-cache-query", requestId, queryKey, statusFilter }),
  );
  return true;
}

export function queryQueryCache(
  queryKey?: string,
  statusFilter?: string,
  timeoutMs = 6000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!isExtensionConnected()) {
      return reject(new Error("No active DOMRay extension connection. Attach debugger in Chrome first."));
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      store.queryCacheCallbacks.delete(requestId);
      reject(new Error(`Query cache query timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    store.queryCacheCallbacks.set(requestId, { resolve, reject, timer });

    const sent = sendQueryCacheQuery(requestId, queryKey, statusFilter);
    if (!sent) {
      clearTimeout(timer);
      store.queryCacheCallbacks.delete(requestId);
      reject(new Error("Failed to dispatch query cache query over WebSocket"));
    }
  });
}

/**
 * Broadcasts an AI audit event to the Chrome Extension
 * whenever an AI coding agent calls an MCP tool.
 */
export function broadcastAiAuditEvent(
  toolName: string,
  params: Record<string, unknown>,
  summary: string,
): void {
  if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return;
  activeClient.send(
    JSON.stringify({
      type: "ai-audit-event",
      toolName,
      timestamp: Date.now(),
      params,
      summary,
    }),
  );
}

export function isExtensionConnected(): boolean {
  return activeClient !== null && activeClient.readyState === WebSocket.OPEN;
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export function startWsBridge(sessionToken: string, extensionId: string): void {
  // 1. Create HTTP server for /pair and /health
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers["origin"] as string | undefined;
    const reqUrl = req.url ?? "/";

    // Set CORS headers allowing Chrome Extension origins
    if (origin && origin.startsWith("chrome-extension://")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else if (!origin) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DOMRay-Extension-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsed = new URL(reqUrl, `http://${WS_HOST}:${WS_PORT}`);

    // /pair — Zero-Friction Auto-Pairing (GET or POST)
    if (parsed.pathname === "/pair") {
      // 1. If Origin header is present and is NOT a chrome-extension, REJECT immediately.
      // This protects against malicious web pages (http://, https://) attempting drive-by pairing.
      if (origin && !origin.startsWith("chrome-extension://")) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Only chrome-extension origins can pair" }));
        return;
      }

      const completePairing = (rawExtId?: string) => {
        let extId = "";
        if (origin && origin.startsWith("chrome-extension://")) {
          extId = origin.replace("chrome-extension://", "").split("/")[0] ?? "";
        }
        if (!extId && rawExtId) {
          extId = rawExtId.trim();
        }
        if (!extId) {
          const headerExtId = req.headers["x-domray-extension-id"];
          if (typeof headerExtId === "string") extId = headerExtId.trim();
        }
        if (!extId) {
          extId = parsed.searchParams.get("extensionId") ?? "";
        }

        if (!isAllowedExtensionId(extId, extensionId)) {
          console.error(`[DOMRay Pair] Rejected pairing attempt for extId: "${extId}"`);
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Extension ID invalid or rejected by policy" }));
          return;
        }

        console.error(`[DOMRay Pair] Handshake approved for extension: ${extId}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, token: sessionToken, extensionId: extId }));
      };

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 2048) req.destroy();
        });
        req.on("end", () => {
          let extIdFromBody = "";
          try {
            if (body) {
              const parsedBody = JSON.parse(body) as { extensionId?: string };
              extIdFromBody = parsedBody.extensionId ?? "";
            }
          } catch {
            // fallback
          }
          completePairing(extIdFromBody);
        });
      } else {
        completePairing();
      }
      return;
    }

    // GET /health
    if (parsed.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        service: "DOMRay",
        connected: isExtensionConnected(),
        activeTab: store.activeSession?.url ?? null,
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("DOMRay Local Bridge");
  });

  // 2. Create WebSocket server attached to HTTP server
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // --- 1. Origin validation ---
    const origin = req.headers["origin"];
    if (!validateOrigin(origin, extensionId)) {
      console.error(
        `[DOMRay WS] Rejected connection from unauthorized origin: ${origin ?? "(none)"}`,
      );
      ws.terminate();
      return;
    }

    // --- 2. Token validation ---
    const rawUrl = req.url ?? "";
    let providedToken = "";
    try {
      const parsed = new URL(rawUrl, `ws://${WS_HOST}`);
      providedToken = parsed.searchParams.get("token") ?? "";
    } catch {
      ws.terminate();
      return;
    }

    if (!validateToken(providedToken, sessionToken)) {
      console.error("[DOMRay WS] Rejected connection: invalid token");
      ws.terminate();
      return;
    }

    // --- 3. Accept connection ---
    console.error("[DOMRay WS] Extension connected successfully");
    activeClient = ws;

    ws.on("message", (raw) => {
      let msg: ExtensionMessage;
      try {
        msg = JSON.parse(raw.toString()) as ExtensionMessage;
      } catch {
        console.error("[DOMRay WS] Failed to parse incoming message");
        return;
      }

      switch (msg.type) {
        case "session-info":
          store.activeSession = {
            tabId: msg.tabId,
            url: msg.url,
            title: msg.title,
            connectedAt: Date.now(),
          };
          console.error(`[DOMRay WS] Active tab: "${msg.title}" (${msg.url})`);
          break;

        case "error":
          store.errors.push(msg.payload);
          console.error(`[DOMRay WS] Error captured: ${msg.payload.message}`);
          break;

        case "network":
          store.network.push(msg.payload);
          break;

        case "breadcrumb":
          store.breadcrumbs.push(msg.payload);
          break;

        case "console":
          store.consoleLogs.push(msg.payload);
          break;

        case "reset-store":
          store.reset();
          console.error("[DOMRay WS] Session store reset on extension notification");
          break;

        case "dom-response": {
          const cb = store.domQueryCallbacks.get(msg.requestId);
          if (cb) {
            clearTimeout(cb.timer);
            store.domQueryCallbacks.delete(msg.requestId);
            if (msg.error) {
              cb.reject(new Error(msg.error));
            } else {
              cb.resolve(msg.html);
            }
          }
          break;
        }

        case "component-state-response": {
          const cb = store.componentStateCallbacks.get(msg.requestId);
          if (cb) {
            clearTimeout(cb.timer);
            store.componentStateCallbacks.delete(msg.requestId);
            if (msg.error) {
              cb.reject(new Error(msg.error));
            } else {
              cb.resolve(msg.data);
            }
          }
          break;
        }

        case "storage-response": {
          const cb = store.storageQueryCallbacks.get(msg.requestId);
          if (cb) {
            clearTimeout(cb.timer);
            store.storageQueryCallbacks.delete(msg.requestId);
            if (msg.error) {
              cb.reject(new Error(msg.error));
            } else {
              cb.resolve(msg.data);
            }
          }
          break;
        }

        case "a11y-tree-response": {
          const cb = store.a11yTreeCallbacks.get(msg.requestId);
          if (cb) {
            clearTimeout(cb.timer);
            store.a11yTreeCallbacks.delete(msg.requestId);
            if (msg.error) {
              cb.reject(new Error(msg.error));
            } else {
              cb.resolve(msg.tree);
            }
          }
          break;
        }

        case "query-cache-response": {
          const cb = store.queryCacheCallbacks.get(msg.requestId);
          if (cb) {
            clearTimeout(cb.timer);
            store.queryCacheCallbacks.delete(msg.requestId);
            if (msg.error) {
              cb.reject(new Error(msg.error));
            } else {
              cb.resolve(msg.data);
            }
          }
          break;
        }

        case "web-vitals":
          store.latestWebVitals = msg.payload;
          break;

        case "heartbeat":
          // Keep-alive; no-op
          break;

        default:
          console.error("[DOMRay WS] Unknown message type");
      }
    });

    ws.on("close", () => {
      console.error("[DOMRay WS] Extension disconnected");
      if (activeClient === ws) {
        activeClient = null;
        store.reset();
      }
    });

    ws.on("error", (err) => {
      console.error("[DOMRay WS] WebSocket error:", err.message);
    });
  });

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[DOMRay Bridge] FATAL: Port ${WS_PORT} is already in use by another process. Run 'kill $(lsof -t -i :${WS_PORT})' to release it.`
      );
      process.exit(1);
    } else {
      console.error("[DOMRay WS] WebSocket server error:", err.message);
    }
  });

  server.listen(WS_PORT, WS_HOST, () => {
    console.error(`[DOMRay Bridge] Listening on http://${WS_HOST}:${WS_PORT} and ws://${WS_HOST}:${WS_PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[DOMRay Bridge] FATAL: Port ${WS_PORT} is already in use by another process. Run 'kill $(lsof -t -i :${WS_PORT})' to release it.`
      );
      process.exit(1);
    } else {
      console.error("[DOMRay Bridge] Server error:", err.message);
    }
  });
}
