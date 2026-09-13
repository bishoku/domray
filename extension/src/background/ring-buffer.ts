/**
 * ring-buffer.ts — Circular fixed-capacity buffer with chrome.storage.session persistence.
 *
 * MV3 Service Workers can be terminated at any time. chrome.storage.session
 * persists data in-memory for the duration of the browser session and survives
 * SW restarts, so ring buffer state is not lost on SW termination.
 */

import {
  RING_BUFFER_ERRORS,
  RING_BUFFER_NETWORK,
  RING_BUFFER_BREADCRUMBS,
  STORAGE_KEY_RING,
} from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Types (mirrored from mcp-server for consistency)
// ---------------------------------------------------------------------------

export interface ErrorEntry {
  timestamp: number;
  message: string;
  stack?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface BreadcrumbEntry {
  timestamp: number;
  type: "click" | "input" | "submit" | "navigation" | "console" | "custom";
  description: string;
  selector?: string;
}

export interface ConsoleEntry {
  timestamp: number;
  type: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  url?: string;
  lineNumber?: number;
}

export interface NetworkEntry {
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
  /** Tracks when request was sent (for duration calculation) */
  _sentAt?: number;
}

// ---------------------------------------------------------------------------
// In-memory circular buffer (synchronous, fast)
// ---------------------------------------------------------------------------

export class RingBuffer<T> {
  private buf: T[] = [];
  private head = 0;
  private _size = 0;

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    if (this._size < this.capacity) {
      this.buf.push(item);
      this._size++;
    } else {
      this.buf[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  toArray(): T[] {
    if (this._size < this.capacity) return [...this.buf];
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  get size(): number { return this._size; }
  clear(): void { this.buf = []; this.head = 0; this._size = 0; }
}

// ---------------------------------------------------------------------------
// Shared ring buffer instances
// ---------------------------------------------------------------------------

export const errorBuffer = new RingBuffer<ErrorEntry>(RING_BUFFER_ERRORS);
export const networkBuffer = new RingBuffer<NetworkEntry>(RING_BUFFER_NETWORK);
export const breadcrumbBuffer = new RingBuffer<BreadcrumbEntry>(RING_BUFFER_BREADCRUMBS);
export const consoleBuffer = new RingBuffer<ConsoleEntry>(100);

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface PersistedRing {
  errors: ErrorEntry[];
  network: NetworkEntry[];
  breadcrumbs: BreadcrumbEntry[];
  consoleLogs?: ConsoleEntry[];
}

/** Saves current buffer state to chrome.storage.session */
export async function persistBuffers(): Promise<void> {
  const data: PersistedRing = {
    errors: errorBuffer.toArray(),
    network: networkBuffer.toArray(),
    breadcrumbs: breadcrumbBuffer.toArray(),
    consoleLogs: consoleBuffer.toArray(),
  };
  await chrome.storage.session.set({ [STORAGE_KEY_RING]: data });
}

/** Restores buffer state from chrome.storage.session (called on SW startup) */
export async function restoreBuffers(): Promise<void> {
  const result = await chrome.storage.session.get(STORAGE_KEY_RING);
  const data = result[STORAGE_KEY_RING] as PersistedRing | undefined;
  if (!data) return;

  for (const e of data.errors) errorBuffer.push(e);
  for (const n of data.network) networkBuffer.push(n);
  for (const b of data.breadcrumbs) breadcrumbBuffer.push(b);
  if (data.consoleLogs) {
    for (const c of data.consoleLogs) consoleBuffer.push(c);
  }
}

/** Completely wipes all in-memory buffers and session storage (on detach or user clear) */
export async function clearAllBuffers(): Promise<void> {
  errorBuffer.clear();
  networkBuffer.clear();
  breadcrumbBuffer.clear();
  consoleBuffer.clear();
  await chrome.storage.session.set({
    [STORAGE_KEY_RING]: { errors: [], network: [], breadcrumbs: [], consoleLogs: [] },
    domray_ai_audit_log: [],
  });
}
