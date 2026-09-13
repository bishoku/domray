/**
 * constants.ts — Shared constants for the DOMRay Chrome Extension.
 */

/** WebSocket server endpoint on the local MCP server */
export const WS_URL_BASE = "ws://127.0.0.1:9123";

/** Heartbeat interval in ms to keep the Service Worker alive */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Auto-reconnect delay in ms */
export const RECONNECT_DELAY_MS = 3_000;

/** Maximum reconnect attempts before giving up */
export const MAX_RECONNECT_ATTEMPTS = 5;

/** Ring buffer capacities */
export const RING_BUFFER_ERRORS = 20;
export const RING_BUFFER_NETWORK = 100;
export const RING_BUFFER_BREADCRUMBS = 50;

/** HTTP headers that must be masked before sending */
export const MASKED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "proxy-authorization",
]);

/** URL query param names whose values must be masked */
export const MASKED_QUERY_PARAMS = new Set([
  "token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "passwd",
  "access_token",
  "refresh_token",
  "auth",
  "key",
]);

/** chrome.storage.session key for persisting the session token */
export const STORAGE_KEY_TOKEN = "domray_session_token";

/** chrome.storage.session key for ring buffer data */
export const STORAGE_KEY_RING = "domray_ring";
