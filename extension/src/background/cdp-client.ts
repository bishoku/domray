/**
 * cdp-client.ts — Chrome DevTools Protocol wrapper via chrome.debugger API.
 *
 * Handles:
 *   - Attaching/detaching to tabs
 *   - Enabling CDP domains (Runtime, Network)
 *   - Handling CDP events: exceptions, console, network lifecycle
 *   - Executing DOM queries via Runtime.evaluate
 *
 * TODO: [DETAYLANDIRILACAK ALAN: Framework State Inspector (React Fiber / Vue Reactive)]
 *   MVP: reads only DOM attributes (data-*, class, id).
 *   Future: CDP Runtime.evaluate to serialize React props/state from Fiber nodes.
 */

import { redactHeaders, redactUrl, redactBody } from "./redaction.js";
import {
  errorBuffer,
  networkBuffer,
  breadcrumbBuffer,
  consoleBuffer,
  persistBuffers,
  type ErrorEntry,
  type NetworkEntry,
  type ConsoleEntry,
  type BreadcrumbEntry,
} from "./ring-buffer.js";
import {
  sendNetwork,
  sendError,
  sendConsole,
  sendBreadcrumb,
} from "./ws-client.js";

// Active debuggee tab ID
let activeTabId: number | null = null;

// Pending network requests (requestId → partial NetworkEntry)
const pendingRequests = new Map<string, NetworkEntry>();

// ---------------------------------------------------------------------------
// Attach / Detach
// ---------------------------------------------------------------------------

/**
 * Called on Service Worker startup to restore active tab tracking if still attached.
 */
export function restoreActiveTabId(tabId: number): void {
  activeTabId = tabId;
}

/**
 * Called when Chrome reports a debugger detach (e.g. user clicked Cancel on infobar,
 * tab navigated to restricted URL, or DevTools opened).
 */
export function handleDebuggerDetached(tabId?: number): void {
  if (tabId === undefined || activeTabId === tabId) {
    activeTabId = null;
    pendingRequests.clear();
  }
}

async function injectTracker(tabId: number): Promise<void> {
  try {
    if (chrome.scripting && typeof chrome.scripting.executeScript === "function") {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/tracker.js"],
      });
    }
  } catch {
    // Ignored for internal chrome:// pages or if already injected
  }
}

export async function attachToTab(
  tabId: number,
): Promise<{ success: boolean; error?: string; isDevTools?: boolean }> {
  // 1. Check if WE (DOMRay) are already attached to this tab
  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    // Succeeded! DOMRay is already attached to this tab.
    activeTabId = tabId;
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", { maxPostDataSize: 0 });
    await injectTracker(tabId);
    return { success: true };
  } catch {
    // We are not currently attached to this tab. Proceed with attach flow.
  }

  // 2. If attached to a different tab, detach it first
  if (activeTabId !== null && activeTabId !== tabId) {
    await detach(activeTabId);
  }

  try {
    // 3. Attempt fresh attach
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (attachErr) {
      const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);

      // Check if another debugger is attached
      if (
        msg.toLowerCase().includes("another debugger is already attached") ||
        msg.toLowerCase().includes("already attached")
      ) {
        // Probe whether our extension is actually the one attached
        try {
          await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
          activeTabId = tabId;
          await chrome.debugger.sendCommand({ tabId }, "Network.enable", { maxPostDataSize: 0 });
          await injectTracker(tabId);
          return { success: true };
        } catch {
          // Probe failed: Chrome DevTools (F12) or another debugger is truly active
          activeTabId = null;
          return {
            success: false,
            isDevTools: true,
            error: "Chrome DevTools (F12) is already open on this tab. Close F12 or click Re-attach.",
          };
        }
      }

      activeTabId = null;
      return { success: false, error: msg };
    }

    activeTabId = tabId;

    // Enable required CDP domains
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxPostDataSize: 0, // Don't capture request bodies (reduces PII risk)
    });

    await injectTracker(tabId);

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    activeTabId = null;
    return { success: false, error: msg };
  }
}

export async function detach(tabIdToDetach?: number): Promise<void> {
  const tabId = tabIdToDetach ?? activeTabId;
  if (tabIdToDetach === undefined || tabIdToDetach === activeTabId) {
    activeTabId = null;
    pendingRequests.clear();
  }

  if (tabId !== null && tabId !== undefined) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Already detached by browser — ignore
    }
  }
}

export function getActiveTabId(): number | null {
  return activeTabId;
}

// ---------------------------------------------------------------------------
// DOM query via CDP Runtime.evaluate
// ---------------------------------------------------------------------------

export async function queryDom(
  selector: string,
  maxDepth: number,
): Promise<string> {
  if (activeTabId === null) throw new Error("No active debugging session");

  // We use outerHTML of the matched element.
  // max_depth is enforced at the sanitizer level (server-side for MVP).
  const script = `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found: ' + ${JSON.stringify(selector)} });
      return JSON.stringify({ html: el.outerHTML });
    })()
  `;

  const result = await chrome.debugger.sendCommand(
    { tabId: activeTabId },
    "Runtime.evaluate",
    {
      expression: script,
      returnByValue: true,
      silent: true,
    },
  ) as { result?: { value?: string }; exceptionDetails?: unknown };

  if (result.exceptionDetails) {
    throw new Error("CDP evaluation exception");
  }

  const parsed = JSON.parse(result.result?.value ?? "{}") as { html?: string; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  return parsed.html ?? "";
}

// ---------------------------------------------------------------------------
// Framework State Inspector via CDP Runtime.evaluate (React Fiber & Vue)
// ---------------------------------------------------------------------------

export async function inspectComponentState(selector: string): Promise<string> {
  if (activeTabId === null) throw new Error("No active debugging session");

  const script = `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found: ' + ${JSON.stringify(selector)} });

      function clean(obj, depth, visited) {
        if (depth > 3 || obj === null || obj === undefined) return undefined;
        if (typeof obj !== 'object') {
          if (typeof obj === 'function') return undefined;
          if (typeof obj === 'symbol') return obj.toString();
          return obj;
        }
        if (visited.has(obj)) return '[Circular]';
        visited.add(obj);

        // Unwrap Vue 3 ref
        if (obj && (obj._v_isRef || obj.__v_isRef)) {
          return clean(obj.value, depth, visited);
        }

        // DOM node representation
        if (obj.nodeType && obj.tagName) {
          return '<' + obj.tagName.toLowerCase() + (obj.id ? '#' + obj.id : '') + ' />';
        }

        if (Array.isArray(obj)) {
          return obj.slice(0, 20).map(v => clean(v, depth + 1, visited));
        }

        const res = {};
        for (const [k, v] of Object.entries(obj)) {
          if (
            typeof v === 'function' ||
            typeof v === 'symbol' ||
            k.startsWith('$$') ||
            k === 'children' ||
            k === '_owner' ||
            k === '_store' ||
            k === 'dispatch' ||
            k === 'lastRenderedReducer'
          ) continue;
          if (k.startsWith('_') && k !== '_value') continue;

          const cleanedVal = clean(v, depth + 1, visited);
          if (cleanedVal !== undefined) {
            res[k] = cleanedVal;
          }
        }
        return res;
      }

      // --- React Fiber Inspection ---
      function getFiberFromElement(node) {
        if (!node) return null;
        const fiberKey = Object.keys(node).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (fiberKey && node[fiberKey]) return node[fiberKey];

        const containerKey = Object.keys(node).find(k => k.startsWith('__reactContainer$'));
        if (containerKey && node[containerKey]?.current) return node[containerKey].current;

        if (node._reactRootContainer?._internalRoot?.current) {
          return node._reactRootContainer._internalRoot.current;
        }
        return null;
      }

      function getComponentName(fiber) {
        if (!fiber || !fiber.type) return null;
        const t = fiber.type;
        if (typeof t === 'string') return t;
        if (typeof t === 'function') return t.displayName || t.name || 'Anonymous';
        if (typeof t === 'object') {
          if (t.displayName) return t.displayName;
          if (t.name) return t.name;
          if (t.type) {
            const inner = getComponentName({ type: t.type });
            return inner ? inner + ' (Memo)' : 'Memo';
          }
          if (t.render) {
            const inner = t.render.displayName || t.render.name || 'ForwardRef';
            return inner + ' (ForwardRef)';
          }
          if (t._context) {
            return (t._context.displayName || 'Context') + '.Provider';
          }
        }
        return null;
      }

      function findTargetComponentFiber(fiber) {
        if (!fiber) return null;
        // If it's a HostRoot (container like #root), walk down child to find the first component
        if (fiber.tag === 3 || fiber.type === null) {
          let curr = fiber.child;
          while (curr) {
            const name = getComponentName(curr);
            if (name && typeof curr.type !== 'string') return curr;
            if (curr.child) curr = curr.child;
            else break;
          }
          return fiber.child || fiber;
        }

        // If it's a host element (DOM tag), climb up to find the closest user component
        let comp = fiber;
        while (comp) {
          if (typeof comp.type === 'function' || (comp.type && typeof comp.type === 'object')) {
            return comp;
          }
          comp = comp.return;
        }
        return fiber;
      }

      function extractHooks(fiber) {
        if (!fiber || !fiber.memoizedState) return null;
        const hooks = [];
        let curr = fiber.memoizedState;
        let idx = 0;
        while (curr && idx < 30) {
          if (curr.queue && typeof curr.queue === 'object') {
            // useState / useReducer
            hooks.push({
              hook: idx,
              type: 'useState',
              value: clean(curr.memoizedState, 0, new Set())
            });
          } else if (curr.memoizedState && typeof curr.memoizedState === 'object' && 'current' in curr.memoizedState && !curr.queue) {
            // useRef
            hooks.push({
              hook: idx,
              type: 'useRef',
              value: clean(curr.memoizedState.current, 0, new Set())
            });
          } else if (Array.isArray(curr.memoizedState) && curr.memoizedState.length === 2 && Array.isArray(curr.memoizedState[1])) {
            // useMemo / useCallback
            if (typeof curr.memoizedState[0] !== 'function') {
              hooks.push({
                hook: idx,
                type: 'useMemo',
                value: clean(curr.memoizedState[0], 0, new Set())
              });
            }
          } else if (curr.memoizedState && typeof curr.memoizedState === 'object' && ('create' in curr.memoizedState || 'destroy' in curr.memoizedState)) {
            // Skip effects
          } else if (curr.memoizedState !== undefined && curr.memoizedState !== null) {
            hooks.push({
              hook: idx,
              type: 'hook',
              value: clean(curr.memoizedState, 0, new Set())
            });
          }
          curr = curr.next;
          idx++;
        }
        return hooks.length > 0 ? hooks : null;
      }

      let targetFiber = getFiberFromElement(el);

      // If not found directly on el, search descendants (e.g. if selector was #root or body)
      if (!targetFiber) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
        let count = 0;
        while (walker.nextNode() && count < 50) {
          count++;
          const f = getFiberFromElement(walker.currentNode);
          if (f) {
            targetFiber = f;
            break;
          }
        }
      }

      // React DevTools Hook Fallback
      if (!targetFiber && window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers) {
        try {
          for (const r of window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values()) {
            if (typeof r.findFiberByHostInstance === 'function') {
              const f = r.findFiberByHostInstance(el);
              if (f) { targetFiber = f; break; }
            }
          }
        } catch {}
      }

      if (targetFiber) {
        const comp = findTargetComponentFiber(targetFiber);
        const compName = getComponentName(comp) || 'Component';

        // Build hierarchy
        const hierarchy = [];
        let p = comp;
        while (p && hierarchy.length < 8) {
          const n = getComponentName(p);
          if (n && typeof p.type !== 'string') {
            if (hierarchy.length === 0 || hierarchy[hierarchy.length - 1] !== n) {
              hierarchy.push(n);
            }
          }
          p = p.return;
        }
        const hierarchyStr = hierarchy.reverse().join(' > ');

        const props = comp?.memoizedProps ? clean(comp.memoizedProps, 0, new Set()) : undefined;

        let state = extractHooks(comp);
        if (!state && comp?.stateNode?.state) {
          state = clean(comp.stateNode.state, 0, new Set());
        }

        return JSON.stringify({
          framework: 'React',
          component: compName,
          hierarchy: hierarchyStr || compName,
          props,
          state
        });
      }

      // --- Vue 3 Inspection (Dev & Production) ---
      function getVueComponent(node) {
        if (!node) return null;
        if (node.__vueParentComponent) return node.__vueParentComponent;
        if (node._vnode?.component) return node._vnode.component;
        if (node.__vue_app__?._instance) return node.__vue_app__._instance;
        return null;
      }

      let vueComp = getVueComponent(el);
      if (!vueComp) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
        let count = 0;
        while (walker.nextNode() && count < 40) {
          count++;
          const vc = getVueComponent(walker.currentNode);
          if (vc) { vueComp = vc; break; }
        }
      }

      if (vueComp) {
        const name = vueComp.type?.name || vueComp.type?.__name || vueComp.type?.__file?.split('/').pop()?.replace('.vue', '') || 'VueComponent';
        const props = vueComp.props ? clean(vueComp.props, 0, new Set()) : undefined;
        const setupState = vueComp.setupState ? clean(vueComp.setupState, 0, new Set()) : undefined;
        const data = vueComp.data ? clean(vueComp.data, 0, new Set()) : undefined;

        return JSON.stringify({
          framework: 'Vue 3',
          component: name,
          props,
          setupState: setupState || data
        });
      }

      // --- Vue 2 Inspection ---
      const vue2 = el.__vue__;
      if (vue2) {
        const name = vue2.$options?.name || vue2.$options?._componentTag || 'Vue2Component';
        return JSON.stringify({
          framework: 'Vue 2',
          component: name,
          props: clean(vue2.$props, 0, new Set()),
          state: clean(vue2.$data, 0, new Set())
        });
      }

      // --- Svelte Inspection ---
      if (typeof el.$capture_state === 'function') {
        return JSON.stringify({
          framework: 'Svelte',
          component: el.tagName.toLowerCase(),
          state: clean(el.$capture_state(), 0, new Set())
        });
      }

      // --- Vanilla / HTML Fallback ---
      const attrs = {};
      for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i];
        attrs[a.name] = a.value;
      }

      return JSON.stringify({
        framework: 'Vanilla / HTML',
        component: el.tagName.toLowerCase(),
        element: {
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          childElementCount: el.childElementCount,
          attributes: attrs
        },
        message: 'No React Fiber or Vue component instance attached to this element or its immediate children.'
      });
    })()
  `;

  const result = await chrome.debugger.sendCommand(
    { tabId: activeTabId },
    "Runtime.evaluate",
    {
      expression: script,
      returnByValue: true,
      silent: true,
    },
  ) as { result?: { value?: string }; exceptionDetails?: unknown };

  if (result.exceptionDetails) {
    throw new Error("CDP evaluation failed during component state inspection");
  }

  return result.result?.value ?? "{}";
}

// ---------------------------------------------------------------------------
// Storage Inspector via CDP Runtime.evaluate (localStorage, sessionStorage, cookies)
// ---------------------------------------------------------------------------

export async function inspectStorage(
  storageType: "local" | "session" | "cookies",
  targetKey?: string,
): Promise<string> {
  if (activeTabId === null) throw new Error("No active debugging session");

  const script = `
    (function(type, targetKey) {
      const result = {};
      const isSensitive = (k) => /token|secret|password|key|auth|session|credential/i.test(k);

      if (type === "cookies") {
        const cookies = document.cookie ? document.cookie.split("; ") : [];
        for (const c of cookies) {
          const idx = c.indexOf("=");
          const k = idx > -1 ? c.slice(0, idx).trim() : c.trim();
          const val = idx > -1 ? c.slice(idx + 1).trim() : "";
          if (targetKey && k !== targetKey) continue;
          result[k] = isSensitive(k) ? "***MASKED***" : val.slice(0, 300);
        }
        return JSON.stringify(result);
      }

      const store = type === "local" ? window.localStorage : window.sessionStorage;
      if (!store) return JSON.stringify({ error: "Storage not accessible" });

      if (targetKey) {
        const val = store.getItem(targetKey);
        if (val === null) return JSON.stringify({ [targetKey]: null });
        result[targetKey] = isSensitive(targetKey) ? "***MASKED***" : val.slice(0, 1000);
        return JSON.stringify(result);
      }

      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (!k) continue;
        const val = store.getItem(k) || "";
        result[k] = isSensitive(k) ? "***MASKED***" : val.slice(0, 500);
      }
      return JSON.stringify(result);
    })(${JSON.stringify(storageType)}, ${JSON.stringify(targetKey || null)})
  `;

  const result = (await chrome.debugger.sendCommand(
    { tabId: activeTabId },
    "Runtime.evaluate",
    {
      expression: script,
      returnByValue: true,
      silent: true,
    },
  )) as { result?: { value?: string }; exceptionDetails?: unknown };

  if (result.exceptionDetails) {
    throw new Error("Failed to evaluate storage inspection script");
  }

  return result.result?.value ?? "{}";
}

// ---------------------------------------------------------------------------
// ♿ Accessibility Tree (AXTree) Inspector via CDP Accessibility.getFullAXTree
// ---------------------------------------------------------------------------

interface AXValue {
  type: string;
  value?: any;
}

interface AXProperty {
  name: string;
  value: AXValue;
}

interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: AXValue;
  name?: AXValue;
  description?: AXValue;
  value?: AXValue;
  properties?: AXProperty[];
  childIds?: string[];
  parentId?: string;
}

export async function inspectA11yTree(
  _selector?: string,
  maxDepth = 6,
  filter: "all" | "interesting_only" = "interesting_only",
): Promise<string> {
  if (activeTabId === null) throw new Error("No active debugging session");

  try {
    await chrome.debugger.sendCommand({ tabId: activeTabId }, "Accessibility.enable");
  } catch {
    // Already enabled or supported
  }

  const res = (await chrome.debugger.sendCommand(
    { tabId: activeTabId },
    "Accessibility.getFullAXTree",
    {},
  )) as { nodes?: AXNode[] };

  const nodes = res.nodes || [];
  if (nodes.length === 0) {
    return "Accessibility tree is empty or unavailable for this document.";
  }

  const nodeMap = new Map<string, AXNode>();
  for (const n of nodes) {
    nodeMap.set(n.nodeId, n);
  }

  // Find root node (RootWebArea or first node)
  const root = nodes.find((n) => n.role?.value === "RootWebArea") || nodes[0];
  if (!root) return "No root accessibility node found.";

  const lines: string[] = [];

  function formatNodeLine(node: AXNode): string {
    const role = node.role?.value || "generic";
    const name = node.name?.value ? ` "${node.name.value.trim().slice(0, 80)}"` : "";
    const val = node.value?.value !== undefined ? ` (value: "${String(node.value.value).slice(0, 40)}")` : "";

    const props: string[] = [];
    if (node.properties) {
      for (const p of node.properties) {
        if (p.name === "level") props.push(`level=${p.value.value}`);
        else if (p.name === "disabled" && p.value.value) props.push("disabled");
        else if (p.name === "focused" && p.value.value) props.push("focused");
        else if (p.name === "required" && p.value.value) props.push("required");
        else if (p.name === "checked" && p.value.value) props.push(`checked=${p.value.value}`);
        else if (p.name === "expanded" && p.value.value !== undefined) props.push(`expanded=${p.value.value}`);
        else if (p.name === "modal" && p.value.value) props.push("modal");
      }
    }
    const propStr = props.length > 0 ? ` [${props.join(", ")}]` : "";
    return `[${role}]${name}${val}${propStr}`;
  }

  function walk(nodeId: string, depth: number): void {
    if (depth > maxDepth) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const isIgnored = node.ignored;
    if (filter === "interesting_only" && isIgnored) {
      return;
    }

    const role = node.role?.value;
    const hasName = Boolean(node.name?.value && node.name.value.trim().length > 0);
    const isGeneric = (role === "generic" || role === "none" || role === "InlineTextBox") && !hasName;

    if (!isGeneric || filter === "all") {
      const indent = "  ".repeat(depth);
      lines.push(`${indent}- ${formatNodeLine(node)}`);
    }

    const nextDepth = isGeneric ? depth : depth + 1;
    if (node.childIds) {
      for (const cid of node.childIds) {
        walk(cid, nextDepth);
      }
    }
  }

  walk(root.nodeId, 0);

  return [
    `# ♿ Accessibility Semantic Tree (${lines.length} nodes, depth: ${maxDepth})`,
    "",
    "```text",
    lines.slice(0, 400).join("\n"),
    lines.length > 400 ? `\n... (${lines.length - 400} more nodes truncated for token efficiency)` : "",
    "```",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// ⚡ TanStack / React Query Cache Inspector via CDP Runtime.evaluate
// ---------------------------------------------------------------------------

export async function inspectQueryCache(
  queryKey?: string,
  statusFilter?: string,
): Promise<string> {
  if (activeTabId === null) throw new Error("No active debugging session");

  const script = `
    (function(targetKey, statusFilter) {
      try {
        let queryClient = window.queryClient || window.__REACT_QUERY_CLIENT__ || window.__TANSTACK_QUERY_CLIENT__;

        if (!queryClient) {
          const roots = [
            document.querySelector("#root"),
            document.querySelector("#__next"),
            document.querySelector("#app"),
            document.body
          ].filter(Boolean);

          for (const root of roots) {
            const fiberKey = Object.keys(root).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactContainer$"));
            if (!fiberKey) continue;
            let fiber = root[fiberKey];
            let depth = 0;
            while (fiber && depth < 60) {
              if (fiber.memoizedProps?.client?.getQueryCache) {
                queryClient = fiber.memoizedProps.client;
                break;
              }
              if (fiber.stateNode?.props?.client?.getQueryCache) {
                queryClient = fiber.stateNode.props.client;
                break;
              }
              fiber = fiber.child;
              depth++;
            }
            if (queryClient) break;
          }
        }

        if (!queryClient || typeof queryClient.getQueryCache !== "function") {
          return JSON.stringify({
            found: false,
            message: "No TanStack Query / React Query client found on active page.",
          });
        }

        const cache = queryClient.getQueryCache();
        const allQueries = cache.getAll();

        let filtered = allQueries;
        if (targetKey) {
          filtered = filtered.filter(q => JSON.stringify(q.queryKey).toLowerCase().includes(targetKey.toLowerCase()));
        }
        if (statusFilter && statusFilter !== "all") {
          filtered = filtered.filter(q => q.state.status === statusFilter);
        }

        const queries = filtered.slice(0, 30).map(q => {
          let dataPreview = null;
          if (q.state.data !== undefined) {
            try {
              dataPreview = JSON.stringify(q.state.data).slice(0, 400);
            } catch {
              dataPreview = String(q.state.data).slice(0, 100);
            }
          }

          return {
            queryKey: q.queryKey,
            queryHash: q.queryHash,
            status: q.state.status,
            fetchStatus: q.state.fetchStatus,
            isStale: typeof q.isStale === "function" ? q.isStale() : false,
            dataUpdatedAt: q.state.dataUpdatedAt,
            errorUpdatedAt: q.state.errorUpdatedAt,
            error: q.state.error ? String(q.state.error.message || q.state.error) : null,
            dataPreview: dataPreview,
          };
        });

        return JSON.stringify({
          found: true,
          totalCount: allQueries.length,
          matchedCount: filtered.length,
          queries,
        });
      } catch (err) {
        return JSON.stringify({
          found: false,
          error: String(err),
        });
      }
    })(${JSON.stringify(queryKey || null)}, ${JSON.stringify(statusFilter || "all")})
  `;

  const result = (await chrome.debugger.sendCommand(
    { tabId: activeTabId },
    "Runtime.evaluate",
    {
      expression: script,
      returnByValue: true,
      silent: true,
    },
  )) as { result?: { value?: string }; exceptionDetails?: unknown };

  if (result.exceptionDetails) {
    throw new Error("CDP evaluation failed during query cache inspection");
  }

  return result.result?.value ?? "{}";
}


// ---------------------------------------------------------------------------
// CDP event dispatcher — called from background/index.ts top-level listener
// ---------------------------------------------------------------------------

export function handleCdpEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params: unknown,
): void {
  if (source.tabId !== activeTabId) return;

  switch (method) {
    case "Runtime.exceptionThrown":
      onExceptionThrown(params as RuntimeExceptionThrownParams);
      break;
    case "Runtime.consoleAPICalled":
      onConsoleApiCalled(params as RuntimeConsoleApiCalledParams);
      break;
    case "Network.requestWillBeSent":
      onRequestWillBeSent(params as NetworkRequestWillBeSentParams);
      break;
    case "Network.responseReceived":
      onResponseReceived(params as NetworkResponseReceivedParams);
      break;
    case "Network.loadingFailed":
      onLoadingFailed(params as NetworkLoadingFailedParams);
      break;
    case "Network.loadingFinished":
      void onLoadingFinished(params as NetworkLoadingFinishedParams);
      break;
  }
}

// ---------------------------------------------------------------------------
// CDP event handlers
// ---------------------------------------------------------------------------

interface RuntimeExceptionThrownParams {
  timestamp: number;
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    stackTrace?: { callFrames: Array<{ url: string; lineNumber: number; columnNumber: number; functionName: string }> };
  };
}

function onExceptionThrown(params: RuntimeExceptionThrownParams): void {
  const d = params.exceptionDetails;
  if (!d) return;

  const message =
    d.exception?.description ?? d.text ?? "Unknown error";
  const stack =
    d.stackTrace?.callFrames
      .map((f) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
      .join("\n") ?? "";

  const errEntry: ErrorEntry = {
    timestamp: Date.now(),
    message,
    stack: stack || undefined,
    url: d.url,
    lineNumber: d.lineNumber,
    columnNumber: d.columnNumber,
  };

  errorBuffer.push(errEntry);
  sendError(errEntry);
  void persistBuffers();
}

interface RuntimeConsoleApiCalledParams {
  type: string;
  args: Array<{ type: string; value?: unknown; description?: string }>;
  timestamp: number;
}

function onConsoleApiCalled(params: RuntimeConsoleApiCalledParams): void {
  const text = params.args
    .map((a) => a.description ?? String(a.value ?? ""))
    .join(" ");

  const rawType = params.type.toLowerCase();
  const type = (["log", "info", "warn", "error", "debug"].includes(rawType)
    ? rawType
    : "log") as "log" | "info" | "warn" | "error" | "debug";

  const entry: ConsoleEntry = {
    timestamp: Date.now(),
    type,
    text: text.slice(0, 1000),
  };

  consoleBuffer.push(entry);
  sendConsole(entry);

  // Also track error/warn level as breadcrumbs
  if (type === "error" || type === "warn") {
    const b: BreadcrumbEntry = {
      timestamp: Date.now(),
      type: "console",
      description: `console.${type}: ${text.slice(0, 200)}`,
    };
    breadcrumbBuffer.push(b);
    sendBreadcrumb(b);
  }

  void persistBuffers();
}

interface NetworkRequestWillBeSentParams {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  wallTime: number;
}

function onRequestWillBeSent(params: NetworkRequestWillBeSentParams): void {
  const entry: NetworkEntry = {
    timestamp: Math.round(params.wallTime * 1000),
    requestId: params.requestId,
    method: params.request.method,
    url: redactUrl(params.request.url),
    requestHeaders: redactHeaders(params.request.headers),
    failed: false,
    _sentAt: Date.now(),
  };
  pendingRequests.set(params.requestId, entry);
}

interface NetworkResponseReceivedParams {
  requestId: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
  };
}

function onResponseReceived(params: NetworkResponseReceivedParams): void {
  const entry = pendingRequests.get(params.requestId);
  if (!entry) return;

  entry.status = params.response.status;
  entry.statusText = params.response.statusText;
  entry.responseHeaders = redactHeaders(params.response.headers);
  entry.durationMs = entry._sentAt ? Date.now() - entry._sentAt : undefined;
}

interface NetworkLoadingFailedParams {
  requestId: string;
  errorText: string;
  canceled?: boolean;
}

function onLoadingFailed(params: NetworkLoadingFailedParams): void {
  const entry = pendingRequests.get(params.requestId);
  if (!entry) return;

  entry.failed = true;
  entry.failureReason = params.canceled ? "Canceled" : params.errorText;
  entry.durationMs = entry._sentAt ? Date.now() - entry._sentAt : undefined;

  networkBuffer.push(entry);
  sendNetwork(entry);
  pendingRequests.delete(params.requestId);
  void persistBuffers();
}

interface NetworkLoadingFinishedParams {
  requestId: string;
}

async function onLoadingFinished(params: NetworkLoadingFinishedParams): Promise<void> {
  const entry = pendingRequests.get(params.requestId);
  if (!entry) return;

  // Only persist to network buffer if it had a response already recorded
  if (entry.status !== undefined) {
    if (activeTabId !== null) {
      const isError = entry.status >= 400;
      const isJson =
        entry.responseHeaders &&
        Object.entries(entry.responseHeaders).some(
          ([k, v]) => k.toLowerCase() === "content-type" && v.toLowerCase().includes("json")
        );

      if (isError || isJson) {
        try {
          const bodyRes = (await chrome.debugger.sendCommand(
            { tabId: activeTabId },
            "Network.getResponseBody",
            { requestId: params.requestId }
          )) as { body?: string; base64Encoded?: boolean };

          if (bodyRes && bodyRes.body) {
            const raw = bodyRes.base64Encoded ? atob(bodyRes.body) : bodyRes.body;
            entry.responseBody = redactBody(raw.slice(0, 4000));
          }
        } catch {
          // Body not available or evicted; ignore safely
        }
      }
    }

    networkBuffer.push(entry);
    sendNetwork(entry);
    void persistBuffers();
  }
  pendingRequests.delete(params.requestId);
}
