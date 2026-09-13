import { useState, type FormEvent } from "react";

interface CouponFormProps {
  onApplyDiscount: (percent: number) => void;
}

export function CouponForm({ onApplyDiscount }: CouponFormProps) {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim();
    if (!cleanCode) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/cart/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode }),
      });

      if (response.ok) {
        const data = await response.json();
        setAppliedDiscount(data.discount);
        onApplyDiscount(data.discount);
        setIsSubmitting(false);
      } else {
        // =========================================================================
        // 🐛 REAL-WORLD CASE STUDY BUG (from Medium Article)
        // =========================================================================
        // When the coupon API returns an error (such as 422 Unprocessable Entity
        // for expired coupons like 'EXPIRED20'):
        //
        // 1. The developer forgot to set `isSubmitting(false)`.
        // 2. The developer forgot to set `setErrorMessage(...)`.
        //
        // Result:
        // - The button becomes permanently disabled displaying "Applying..."
        // - No error message is shown to the user.
        // - No uncaught JavaScript exception is thrown in the console.
        // - The user is completely frozen in the checkout flow!
        // =========================================================================
        console.warn(
          `[DOMRay Example] Coupon validation failed: HTTP ${response.status} for code "${cleanCode}"`,
        );

        // ❌ MISSING CODE THAT FIXES THE BUG:
        // const errorData = await response.json();
        // setErrorMessage(errorData.error || "Invalid coupon code");
        // setIsSubmitting(false);
      }
    } catch (err) {
      console.error("[DOMRay Example] Unexpected network error:", err);
      // Even if network drops, this catch block is not reached for 422 HTTP responses!
      setIsSubmitting(false);
      setErrorMessage("Network error. Please try again.");
    }
  };

  const handleReset = () => {
    setCode("");
    setIsSubmitting(false);
    setAppliedDiscount(null);
    setErrorMessage(null);
    onApplyDiscount(0);
  };

  return (
    <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <label htmlFor="coupon-code" style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
          Promo / Coupon Code
        </label>
        {(appliedDiscount !== null || isSubmitting || errorMessage) && (
          <button
            type="button"
            onClick={handleReset}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent-primary)",
              fontSize: "11px",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Reset
          </button>
        )}
      </div>

      <form id="coupon-form" onSubmit={handleSubmit} style={{ display: "flex", gap: "8px" }}>
        <input
          id="coupon-code"
          type="text"
          className="input"
          placeholder="Try 'EXPIRED20' (bug) or 'SAVE10'"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={isSubmitting || appliedDiscount !== null}
          style={{ textTransform: "uppercase", fontFamily: "var(--font-mono)", fontSize: "12px" }}
        />
        <button
          id="apply-coupon"
          type="submit"
          className="btn btn-primary"
          disabled={isSubmitting || appliedDiscount !== null || !code.trim()}
          style={{ minWidth: "110px" }}
        >
          {isSubmitting ? (
            <>
              <div className="spinner" />
              <span>Applying…</span>
            </>
          ) : appliedDiscount !== null ? (
            <span>Applied ✓</span>
          ) : (
            <span>Apply</span>
          )}
        </button>
      </form>

      {/* Success Notification */}
      {appliedDiscount !== null && (
        <div
          id="coupon-success-banner"
          style={{
            marginTop: "10px",
            padding: "8px 12px",
            background: "rgba(158, 206, 106, 0.12)",
            border: "1px solid rgba(158, 206, 106, 0.3)",
            borderRadius: "6px",
            color: "var(--accent-success)",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>🎉</span>
          <span>
            <strong>{appliedDiscount}% discount</strong> applied to your order!
          </span>
        </div>
      )}

      {/* Error Notification (Will NOT show when bug is active) */}
      {errorMessage && (
        <div
          id="coupon-error-banner"
          style={{
            marginTop: "10px",
            padding: "8px 12px",
            background: "rgba(247, 118, 142, 0.12)",
            border: "1px solid rgba(247, 118, 142, 0.3)",
            borderRadius: "6px",
            color: "var(--accent-danger)",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>⚠️</span>
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
