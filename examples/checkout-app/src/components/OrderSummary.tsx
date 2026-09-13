import { CouponForm } from "./CouponForm";

interface OrderSummaryProps {
  discountPercent: number;
  onApplyDiscount: (percent: number) => void;
}

export function OrderSummary({ discountPercent, onApplyDiscount }: OrderSummaryProps) {
  const baseSubtotal = 68.0;
  const discountAmount = (baseSubtotal * discountPercent) / 100;
  const finalTotal = Math.max(0, baseSubtotal - discountAmount);

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px", color: "var(--text-primary)" }}>
        Order Summary
      </h3>

      {/* Cart Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>AI Coding Assistant Pro</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Monthly seat license (Team tier)</div>
          </div>
          <div style={{ fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>$49.00</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Dedicated GPU Inference</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>High-throughput priority queue</div>
          </div>
          <div style={{ fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>$19.00</div>
        </div>
      </div>

      {/* Coupon Form Component */}
      <CouponForm onApplyDiscount={onApplyDiscount} />

      {/* Calculation breakdown */}
      <div
        style={{
          marginTop: "16px",
          paddingTop: "16px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          fontSize: "13px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
          <span>Subtotal</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>${baseSubtotal.toFixed(2)}</span>
        </div>

        {discountPercent > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--accent-success)" }}>
            <span>Discount ({discountPercent}%)</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>-${discountAmount.toFixed(2)}</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
          <span>Estimated Tax</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>$0.00</span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "8px",
            paddingTop: "12px",
            borderTop: "1px dashed var(--border-subtle)",
            fontSize: "16px",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          <span>Total</span>
          <span style={{ color: "var(--accent-primary)", fontFamily: "var(--font-mono)", fontSize: "18px" }}>
            ${finalTotal.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Checkout Button */}
      <button
        id="checkout-submit-btn"
        className="btn btn-primary"
        style={{ width: "100%", marginTop: "20px", padding: "12px" }}
        onClick={() => alert("Order placed successfully! (Demo environment)")}
      >
        <span>Complete Checkout</span>
        <span>→</span>
      </button>
    </div>
  );
}
