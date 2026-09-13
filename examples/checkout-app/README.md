# 🛒 DOMRay Case Study: E-Commerce Checkout Example

This is a standalone, runnable React application created to reproduce the real-world case study described in the Medium article: **"The Case of the Frozen Button"**.

It simulates an enterprise checkout page behind a private SSO/2FA authentication wall with an active session in browser storage and a subtle, stateful frontend bug.

---

## 🚀 Quick Start

From the repository root:

```bash
# 1. Install dependencies (if not already installed)
npm install

# 2. Start the example app
npm run dev:example
```

Alternatively, from within this folder:

```bash
cd examples/checkout-app
npm install
npm run dev
```

The application will be running at **`http://localhost:5173`**.

---

## 🎯 The Bug Scenario: "The Frozen Button"

### Expected Behavior
When a customer enters an expired coupon code (`EXPIRED20`), the checkout form should:
1. Make a `POST /api/cart/coupon` request.
2. Receive an HTTP `422 Unprocessable Entity` response with `{ error: "Coupon expired on 2026-09-01" }`.
3. Display a red error banner: *"⚠️ Coupon expired on 2026-09-01"*.
4. Re-enable the "Apply" button so the customer can try another code.

### Actual (Buggy) Behavior
1. In `src/components/CouponForm.tsx`, when `response.ok` is `false`:
   - The developer **forgot to call `setIsSubmitting(false)`**!
   - The developer **forgot to call `setErrorMessage(...)`**!
2. **Result:**
   - The button stays permanently stuck in a disabled state displaying **`Applying…`**.
   - No error message appears on screen.
   - Zero uncaught JavaScript errors are thrown in the console.
   - The customer is completely frozen in the checkout flow!

---

## 🧪 How to Inspect with DOMRay & AI Coding Agents

### Step 1: Attach DOMRay
1. Open `http://localhost:5173` in Google Chrome.
2. Open the **DOMRay** Chrome extension (or Side Panel).
3. Click **Attach**.

### Step 2: Reproduce the Bug
1. In the **Order Summary** box on the right, enter `EXPIRED20` in the coupon code field.
2. Click **Apply**.
3. Notice that the button freezes in "Applying…" with no error message.

### Step 3: Ask Your AI Coding Agent
In your IDE (Cursor, Claude Code, Windsurf, or Antigravity with DOMRay MCP enabled), type:

> *"The apply coupon button is stuck in a disabled state on the checkout page. Can you inspect the active browser page with DOMRay and fix the issue in `CouponForm.tsx`?"*

### Step 4: Watch the AI Diagnose & Fix It

The AI will invoke DOMRay MCP tools:
1. **`domray_get_flow_timeline`**: Sees your click on `#apply-coupon`, followed by the `POST /api/cart/coupon` request returning HTTP 422, and the console warning.
2. **`domray_get_component_state`** (`selector: "form#coupon-form"` or `"#apply-coupon"`):
   - DOMRay unrolls the React Fiber hooks linked list.
   - Shows component hierarchy: `App > CheckoutLayout > OrderSummary > CouponForm`.
   - Shows `hook 1` (`isSubmitting`) is stuck at `true`.
3. **The AI generates the exact fix in `CouponForm.tsx`:**
   ```typescript
   // In CouponForm.tsx error branch:
   const errorData = await response.json();
   setErrorMessage(errorData.error || "Invalid coupon code");
   setIsSubmitting(false);
   ```

---

## 🔑 Available Test Codes

| Coupon Code | API Response | Intended Behavior |
| :--- | :--- | :--- |
| `EXPIRED20` | **HTTP 422** | Triggers the case-study bug (button freezes). |
| `SAVE10` | **HTTP 200** | Applies valid 10% discount ($6.80 off, new total $61.20). |
| Any other code | **HTTP 404** | Returns "Coupon not found" error. |

---

## 🛠️ Also Great For Testing Other DOMRay Tools

* **`domray_get_storage_state`**:
  Inspect `storage_type: "session"` to see simulated SSO keys (`auth_token`, `user_email`, `cart_id`) with edge-side secret masking in action!
* **`domray_get_console_logs`**:
  Query console logs to see the `[warn] Coupon validation failed` warning.
* **`domray_get_scoped_dom`**:
  Inspect `selector: "#coupon-form"` to see semantic token pruning in action.
