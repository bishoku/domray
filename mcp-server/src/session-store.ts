/**
 * session-store.ts — In-memory ring buffers and session state for telemetry data.
 */

// ---------------------------------------------------------------------------
// Data types
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
  value?: string;
  role?: string;
  accessibleName?: string;
  tagName?: string;
  testId?: string;
  inputType?: string;
  inputValue?: string;
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
  /** HTTP status code; undefined if request never completed */
  status?: number;
  statusText?: string;
  failed: boolean;
  failureReason?: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  /** Duration in ms; undefined if no response */
  durationMs?: number;
}

export interface SessionInfo {
  tabId: number;
  url: string;
  title: string;
  connectedAt: number;
}

export interface DomSnapshot {
  timestamp: number;
  selector: string;
  html: string;
  triggeredBy: "manual" | "error";
}

// ---------------------------------------------------------------------------
// Generic fixed-capacity circular ring buffer
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

  /** Returns entries from oldest to newest. */
  toArray(): T[] {
    if (this._size < this.capacity) return [...this.buf];
    return [
      ...this.buf.slice(this.head),
      ...this.buf.slice(0, this.head),
    ];
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this.buf = [];
    this.head = 0;
    this._size = 0;
  }
}

// ---------------------------------------------------------------------------
// Session store singleton
// ---------------------------------------------------------------------------

const ERROR_CAPACITY = 20;
const NETWORK_CAPACITY = 100;
const BREADCRUMB_CAPACITY = 50;
const CONSOLE_CAPACITY = 100;

class SessionStore {
  activeSession: SessionInfo | null = null;
  readonly errors = new RingBuffer<ErrorEntry>(ERROR_CAPACITY);
  readonly network = new RingBuffer<NetworkEntry>(NETWORK_CAPACITY);
  readonly breadcrumbs = new RingBuffer<BreadcrumbEntry>(BREADCRUMB_CAPACITY);
  readonly consoleLogs = new RingBuffer<ConsoleEntry>(CONSOLE_CAPACITY);
  lastSnapshot: DomSnapshot | null = null;

  /** Pending DOM query callbacks keyed by a request-id */
  readonly domQueryCallbacks = new Map<
    string,
    { resolve: (html: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  /** Pending Component state query callbacks keyed by a request-id */
  readonly componentStateCallbacks = new Map<
    string,
    { resolve: (data: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  /** Pending Storage query callbacks keyed by a request-id */
  readonly storageQueryCallbacks = new Map<
    string,
    { resolve: (data: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  /** Pending Accessibility Tree query callbacks keyed by a request-id */
  readonly a11yTreeCallbacks = new Map<
    string,
    { resolve: (tree: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  /** Pending Query Cache callbacks keyed by a request-id */
  readonly queryCacheCallbacks = new Map<
    string,
    { resolve: (data: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  latestWebVitals: Record<string, unknown> | null = null;

  reset(): void {
    this.activeSession = null;
    this.errors.clear();
    this.network.clear();
    this.breadcrumbs.clear();
    this.consoleLogs.clear();
    this.lastSnapshot = null;
    this.latestWebVitals = null;
    this.domQueryCallbacks.clear();
    this.componentStateCallbacks.clear();
    this.storageQueryCallbacks.clear();
    this.a11yTreeCallbacks.clear();
    this.queryCacheCallbacks.clear();
  }
}

export const store = new SessionStore();
