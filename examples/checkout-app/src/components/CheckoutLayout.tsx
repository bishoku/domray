import { useState } from "react";
import { OrderSummary } from "./OrderSummary";
import { WalkthroughGuide } from "./WalkthroughGuide";

export function CheckoutLayout() {
  const [discountPercent, setDiscountPercent] = useState(0);

  return (
    <div className="container">
      {/* Top Navigation Bar */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #7aa2f7, #bb9af7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: "18px",
              color: "#0f111a",
            }}
          >
            ◉
          </div>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.02em" }}>DevSaaS Pro</h1>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Enterprise Developer Platform</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="badge badge-staging">● Staging v2.4-rc</span>
          <span className="badge badge-sso">🔒 SSO 2FA Active</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "4px 10px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "20px",
              fontSize: "12px",
            }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                background: "#7aa2f7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                fontWeight: 700,
                color: "#0f111a",
              }}
            >
              SD
            </div>
            <span style={{ color: "var(--text-secondary)" }}>sarah.dev@company.internal</span>
          </div>
        </div>
      </header>

      {/* Guide Banner for testing with DOMRay */}
      <WalkthroughGuide />

      {/* Checkout Content Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: "32px",
          alignItems: "start",
        }}
      >
        {/* Left Column: Billing & Shipping */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Billing Contact */}
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "12px",
              padding: "20px",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "14px" }}>Billing Information</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                  First Name
                </label>
                <input type="text" className="input" defaultValue="Sarah" />
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                  Last Name
                </label>
                <input type="text" className="input" defaultValue="Developer" />
              </div>
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                Company Email
              </label>
              <input type="email" className="input" defaultValue="sarah.dev@company.internal" disabled />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                Company VAT / Tax ID
              </label>
              <input type="text" className="input" placeholder="US123456789 (Optional)" />
            </div>
          </div>

          {/* Payment Method */}
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "12px",
              padding: "20px",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "14px" }}>Payment Method</h3>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px",
                background: "var(--bg-surface-elevated)",
                border: "1px solid var(--accent-primary)",
                borderRadius: "8px",
                marginBottom: "12px",
              }}
            >
              <input type="radio" id="pay-card" name="payment" defaultChecked />
              <label htmlFor="pay-card" style={{ flex: 1, cursor: "pointer", fontWeight: 600, fontSize: "13px" }}>
                Corporate Credit Card (•••• 4242)
              </label>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Exp 12/28</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                opacity: 0.6,
              }}
            >
              <input type="radio" id="pay-invoice" name="payment" disabled />
              <label htmlFor="pay-invoice" style={{ flex: 1, fontSize: "13px" }}>
                Enterprise Net-30 Invoicing (Requires $10k+ contract)
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Order Summary & Coupon Form */}
        <div>
          <OrderSummary discountPercent={discountPercent} onApplyDiscount={setDiscountPercent} />
        </div>
      </div>
    </div>
  );
}
