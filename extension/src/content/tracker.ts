/**
 * tracker.ts — DOMRay User Interaction Tracker (Content Script)
 *
 * Captures user interactions on the web page:
 *   - Button, link, and interactive element clicks
 *   - Form inputs and changes (with edge-side sensitive data redaction)
 *   - Form submissions
 *   - Client-side SPA route changes (pushState, popstate, hashchange)
 *
 * Sends breadcrumb events to the background service worker.
 */

(function initTracker() {
  const win = window as unknown as { __DOMRAY_TRACKER_INIT__?: boolean };
  if (win.__DOMRAY_TRACKER_INIT__) return;
  win.__DOMRAY_TRACKER_INIT__ = true;

interface BreadcrumbPayload {
  timestamp: number;
  type: "click" | "input" | "submit" | "navigation";
  description: string;
  selector?: string;
}

function sendBreadcrumb(payload: BreadcrumbPayload): void {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "user-action-breadcrumb",
        payload,
      }).catch(() => {
        // Background SW might be idle or extension reloaded; ignore safely
      });
    }
  } catch {
    // Ignore context invalidation
  }
}

// ---------------------------------------------------------------------------
// Selector and Label Utilities
// ---------------------------------------------------------------------------

function getCleanSelector(el: HTMLElement): string {
  if (el.id) {
    return `#${el.id}`;
  }
  const tag = el.tagName.toLowerCase();
  if (el.getAttribute("data-testid")) {
    return `${tag}[data-testid="${el.getAttribute("data-testid")}"]`;
  }
  if (el.getAttribute("name")) {
    return `${tag}[name="${el.getAttribute("name")}"]`;
  }
  if (el.getAttribute("role")) {
    return `${tag}[role="${el.getAttribute("role")}"]`;
  }
  if (el.classList.length > 0) {
    const classes = Array.from(el.classList)
      .filter((c) => !c.startsWith("focus:") && !c.startsWith("hover:") && c.length < 25)
      .slice(0, 2)
      .join(".");
    if (classes) return `${tag}.${classes}`;
  }
  return tag;
}

function getElementLabel(el: HTMLElement): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `"${ariaLabel.trim().slice(0, 30)}"`;

  const title = el.getAttribute("title");
  if (title) return `"${title.trim().slice(0, 30)}"`;

  if (el instanceof HTMLInputElement) {
    if (el.type === "submit" || el.type === "button") {
      return `"${el.value.slice(0, 30)}"`;
    }
    return el.placeholder ? `"${el.placeholder.slice(0, 30)}"` : `"${el.name || el.id || el.type}"`;
  }

  const text = el.innerText || el.textContent || "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length > 0) {
    return `"${clean.slice(0, 30)}${clean.length > 30 ? "…" : ""}"`;
  }

  return "";
}

function isSensitiveField(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.type === "password") return true;
  if (el.hasAttribute("data-private") || el.hasAttribute("data-masked")) return true;

  const nameOrId = `${el.name || ""} ${el.id || ""} ${el.autocomplete || ""}`.toLowerCase();
  return /password|passcode|secret|token|card|cvv|cvc|ssn|pin/i.test(nameOrId);
}

// ---------------------------------------------------------------------------
// 1. Click Tracking
// ---------------------------------------------------------------------------

window.addEventListener(
  "click",
  (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Find nearest interactive ancestor
    const interactive =
      target.closest<HTMLElement>(
        'button, a, input[type="button"], input[type="submit"], [role="button"], select, summary, [tabindex]'
      ) || target;

    const selector = getCleanSelector(interactive);
    const label = getElementLabel(interactive);
    const desc = label ? `Clicked ${selector} ${label}` : `Clicked ${selector}`;

    sendBreadcrumb({
      timestamp: Date.now(),
      type: "click",
      description: desc,
      selector,
    });
  },
  true // Use capture phase
);

// ---------------------------------------------------------------------------
// 2. Input / Change Tracking (Debounced & Redacted)
// ---------------------------------------------------------------------------

const inputTimers = new WeakMap<HTMLElement, number>();

window.addEventListener(
  "input",
  (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    const timer = inputTimers.get(target);
    if (timer) clearTimeout(timer);

    const newTimer = window.setTimeout(() => {
      const selector = getCleanSelector(target);
      let preview = "";

      if (isSensitiveField(target)) {
        preview = `(masked: ${target.value.length} chars)`;
      } else if (target.value.length === 0) {
        preview = `(cleared)`;
      } else {
        const val = target.value.slice(0, 20);
        preview = `("${val}${target.value.length > 20 ? "…" : ""}")`;
      }

      sendBreadcrumb({
        timestamp: Date.now(),
        type: "input",
        description: `Input in ${selector} ${preview}`,
        selector,
      });
    }, 350);

    inputTimers.set(target, newTimer);
  },
  true
);

// ---------------------------------------------------------------------------
// 3. Form Submit Tracking
// ---------------------------------------------------------------------------

window.addEventListener(
  "submit",
  (event) => {
    const form = event.target as HTMLFormElement | null;
    if (!form || !(form instanceof HTMLFormElement)) return;

    const selector = form.id ? `#${form.id}` : form.name ? `form[name="${form.name}"]` : "form";
    const action = form.action ? ` (action: ${form.action.split("/").pop() || "/"})` : "";

    sendBreadcrumb({
      timestamp: Date.now(),
      type: "submit",
      description: `Submitted form ${selector}${action}`,
      selector,
    });
  },
  true
);

// ---------------------------------------------------------------------------
// 4. SPA Client-Side Route Transitions
// ---------------------------------------------------------------------------

let lastUrl = window.location.href;

function checkUrlChange(): void {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    sendBreadcrumb({
      timestamp: Date.now(),
      type: "navigation",
      description: `Navigated to ${window.location.pathname}${window.location.search}`,
    });
  }
}

// Monkey-patch history API
const originalPushState = history.pushState;
history.pushState = function (...args) {
  const res = originalPushState.apply(this, args);
  checkUrlChange();
  return res;
};

const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  const res = originalReplaceState.apply(this, args);
  checkUrlChange();
  return res;
};

window.addEventListener("popstate", checkUrlChange);
window.addEventListener("hashchange", checkUrlChange);
})();
