/**
 * tracker.ts — DOMRay User Interaction Tracker & Visual Inspector (Content Script)
 *
 * Captures user interactions on the web page:
 *   - Button, link, and interactive element clicks (with semantic roles & accessible names)
 *   - Form inputs and changes (with edge-side sensitive data redaction)
 *   - Form submissions
 *   - Client-side SPA route changes (pushState, popstate, hashchange)
 *
 * Provides visual element inspector:
 *   - Interactive hover bounding box
 *   - React component name & semantic locator detection
 *   - 1-click element selection reporting to Side Panel
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
  role?: string;
  accessibleName?: string;
  tagName?: string;
  testId?: string;
  inputType?: string;
  inputValue?: string;
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
// Semantic Accessibility & Selector Utilities
// ---------------------------------------------------------------------------

function getCleanSelector(el: HTMLElement): string {
  if (el.id) {
    return `#${el.id}`;
  }
  const tag = el.tagName.toLowerCase();
  const testId = getTestId(el);
  if (testId) {
    return `${tag}[data-testid="${testId}"]`;
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

function getTestId(el: HTMLElement): string | undefined {
  return (
    el.getAttribute("data-testid") ||
    el.getAttribute("data-test") ||
    el.getAttribute("data-cy") ||
    undefined
  );
}

function getSemanticRole(el: HTMLElement): string | undefined {
  const explicitRole = el.getAttribute("role");
  if (explicitRole) return explicitRole.toLowerCase();

  const tag = el.tagName.toUpperCase();
  if (tag === "BUTTON") return "button";
  if (tag === "A" && el.hasAttribute("href")) return "link";
  if (tag === "SELECT") return "combobox";
  if (tag === "TEXTAREA") return "textbox";
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    if (input.type === "button" || input.type === "submit" || input.type === "reset") return "button";
    if (input.type === "checkbox") return "checkbox";
    if (input.type === "radio") return "radio";
    return "textbox";
  }
  return undefined;
}

function getAccessibleName(el: HTMLElement): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().slice(0, 50);

  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    const labelledEl = document.getElementById(ariaLabelledBy);
    if (labelledEl?.textContent?.trim()) {
      return labelledEl.textContent.trim().replace(/\s+/g, " ").slice(0, 50);
    }
  }

  if (el.id) {
    try {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl?.textContent?.trim()) {
        return labelEl.textContent.trim().replace(/\s+/g, " ").slice(0, 50);
      }
    } catch {
      // ignore selector escaping error
    }
  }

  const parentLabel = el.closest("label");
  if (parentLabel?.textContent?.trim()) {
    return parentLabel.textContent.trim().replace(/\s+/g, " ").slice(0, 50);
  }

  const title = el.getAttribute("title");
  if (title && title.trim()) return title.trim().slice(0, 50);

  if (el instanceof HTMLInputElement) {
    if (el.type === "submit" || el.type === "button") {
      return el.value ? el.value.trim().slice(0, 50) : undefined;
    }
    if (el.placeholder) return el.placeholder.trim().slice(0, 50);
    return el.name || el.id || undefined;
  }

  const text = el.innerText || el.textContent || "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length > 0) {
    return clean.slice(0, 50);
  }

  return undefined;
}

function getReactComponentName(el: HTMLElement): string | undefined {
  try {
    const keys = Object.keys(el);
    const fiberKey = keys.find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    if (!fiberKey) return undefined;

    let fiber = (el as unknown as Record<string, any>)[fiberKey];
    while (fiber) {
      if (typeof fiber.type === "function") {
        return fiber.type.displayName || fiber.type.name || undefined;
      }
      fiber = fiber.return;
    }
  } catch {
    // Ignore fiber traversal errors
  }
  return undefined;
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
    // If inspector mode is active, do not treat as user interaction
    if (isInspectorActive) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Find nearest interactive ancestor
    const interactive =
      target.closest<HTMLElement>(
        'button, a, input[type="button"], input[type="submit"], [role="button"], select, summary, [tabindex]'
      ) || target;

    const selector = getCleanSelector(interactive);
    const role = getSemanticRole(interactive);
    const accessibleName = getAccessibleName(interactive);
    const testId = getTestId(interactive);
    const label = accessibleName ? `"${accessibleName}"` : "";
    const desc = label ? `Clicked ${selector} ${label}` : `Clicked ${selector}`;

    sendBreadcrumb({
      timestamp: Date.now(),
      type: "click",
      description: desc,
      selector,
      role,
      accessibleName,
      testId,
      tagName: interactive.tagName.toLowerCase(),
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
    if (isInspectorActive) return;

    const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    const timer = inputTimers.get(target);
    if (timer) clearTimeout(timer);

    const newTimer = window.setTimeout(() => {
      const selector = getCleanSelector(target);
      const role = getSemanticRole(target) || "textbox";
      const accessibleName = getAccessibleName(target);
      const testId = getTestId(target);
      let preview = "";
      let safeValue = "";

      if (isSensitiveField(target)) {
        preview = `(masked: ${target.value.length} chars)`;
        safeValue = "***MASKED***";
      } else if (target.value.length === 0) {
        preview = `(cleared)`;
        safeValue = "";
      } else {
        const val = target.value.slice(0, 30);
        preview = `("${val}${target.value.length > 30 ? "…" : ""}")`;
        safeValue = val;
      }

      sendBreadcrumb({
        timestamp: Date.now(),
        type: "input",
        description: `Input in ${selector} ${preview}`,
        selector,
        role,
        accessibleName,
        testId,
        tagName: target.tagName.toLowerCase(),
        inputType: target.type,
        inputValue: safeValue,
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
    if (isInspectorActive) return;

    const form = event.target as HTMLFormElement | null;
    if (!form || !(form instanceof HTMLFormElement)) return;

    const selector = form.id ? `#${form.id}` : form.name ? `form[name="${form.name}"]` : "form";
    const action = form.action ? ` (action: ${form.action.split("/").pop() || "/"})` : "";
    const testId = getTestId(form);

    sendBreadcrumb({
      timestamp: Date.now(),
      type: "submit",
      description: `Submitted form ${selector}${action}`,
      selector,
      role: "form",
      testId,
      tagName: "form",
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

// ---------------------------------------------------------------------------
// 5. Visual Element Inspector Overlay
// ---------------------------------------------------------------------------

let isInspectorActive = false;
let overlayEl: HTMLDivElement | null = null;
let badgeEl: HTMLDivElement | null = null;
let hoveredElement: HTMLElement | null = null;

function createInspectorDom(): void {
  if (overlayEl) return;

  overlayEl = document.createElement("div");
  overlayEl.id = "__domray_inspect_overlay__";
  overlayEl.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    border: 2px solid #06b6d4;
    background: rgba(6, 182, 212, 0.12);
    border-radius: 4px;
    box-shadow: 0 0 16px rgba(6, 182, 212, 0.5), inset 0 0 8px rgba(6, 182, 212, 0.2);
    transition: all 0.06s ease-out;
    display: none;
  `;

  badgeEl = document.createElement("div");
  badgeEl.id = "__domray_inspect_badge__";
  badgeEl.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    background: #0f172a;
    color: #e2e8f0;
    border: 1px solid #06b6d4;
    padding: 3px 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-weight: 600;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
    display: none;
    white-space: nowrap;
  `;

  document.body.appendChild(overlayEl);
  document.body.appendChild(badgeEl);
}

function updateHighlight(target: HTMLElement): void {
  if (!overlayEl || !badgeEl) createInspectorDom();
  if (!overlayEl || !badgeEl) return;

  hoveredElement = target;
  const rect = target.getBoundingClientRect();

  overlayEl.style.display = "block";
  overlayEl.style.top = `${rect.top}px`;
  overlayEl.style.left = `${rect.left}px`;
  overlayEl.style.width = `${rect.width}px`;
  overlayEl.style.height = `${rect.height}px`;

  // Badge label
  const tag = target.tagName.toLowerCase();
  const idStr = target.id ? `#${target.id}` : "";
  const compName = getReactComponentName(target);
  const compPrefix = compName ? `<${compName}> ` : "";

  badgeEl.style.display = "block";
  badgeEl.textContent = `${compPrefix}${tag}${idStr}`;

  // Position badge above element if space permits, otherwise below
  const badgeTop = rect.top > 28 ? rect.top - 26 : rect.bottom + 6;
  badgeEl.style.top = `${badgeTop}px`;
  badgeEl.style.left = `${Math.max(6, rect.left)}px`;
}

function hideHighlight(): void {
  if (overlayEl) overlayEl.style.display = "none";
  if (badgeEl) badgeEl.style.display = "none";
  hoveredElement = null;
}

function onInspectorMouseMove(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target || target === overlayEl || target === badgeEl) return;
  updateHighlight(target);
}

function onInspectorClick(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();

  const selected = hoveredElement || (e.target as HTMLElement | null);
  stopInspector();

  if (!selected) return;

  const selector = getCleanSelector(selected);
  const role = getSemanticRole(selected);
  const accessibleName = getAccessibleName(selected);
  const testId = getTestId(selected);
  const componentName = getReactComponentName(selected);
  const outerHtml = selected.outerHTML.slice(0, 1500);

  // Send inspection report to extension sidepanel & background
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "domray-element-inspected",
        payload: {
          selector,
          role,
          accessibleName,
          testId,
          tagName: selected.tagName.toLowerCase(),
          componentName,
          outerHtml,
          timestamp: Date.now(),
        },
      });
    }
  } catch {
    // Ignore context invalidation
  }
}

function onInspectorKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    stopInspector();
  }
}

function startInspector(): void {
  if (isInspectorActive) return;
  isInspectorActive = true;
  createInspectorDom();

  window.addEventListener("mousemove", onInspectorMouseMove, true);
  window.addEventListener("click", onInspectorClick, true);
  window.addEventListener("keydown", onInspectorKeyDown, true);
  document.body.style.cursor = "crosshair";
}

function stopInspector(): void {
  if (!isInspectorActive) return;
  isInspectorActive = false;
  hideHighlight();

  window.removeEventListener("mousemove", onInspectorMouseMove, true);
  window.removeEventListener("click", onInspectorClick, true);
  window.removeEventListener("keydown", onInspectorKeyDown, true);
  document.body.style.cursor = "";

  // Notify sidepanel that inspector stopped
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "domray-inspect-mode-changed", active: false });
    }
  } catch {
    // Ignore
  }
}

// Listen for commands from sidepanel / background
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "domray-toggle-inspect") {
      if (isInspectorActive) {
        stopInspector();
        sendResponse({ active: false });
      } else {
        startInspector();
        sendResponse({ active: true });
      }
      return true;
    }
    if (msg.type === "domray-stop-inspect") {
      stopInspector();
      sendResponse({ active: false });
      return true;
    }
  });
}
})();
