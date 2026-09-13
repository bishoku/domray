import { useState } from "react";

export function WalkthroughGuide() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(122, 162, 247, 0.1), rgba(187, 154, 247, 0.08))",
        border: "1px solid rgba(122, 162, 247, 0.3)",
        borderRadius: "12px",
        padding: "16px 20px",
        marginBottom: "28px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>🔍</span>
          <div>
            <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent-primary)" }}>
              DOMRay Real-World Case Study: "The Frozen Button"
            </h2>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              A stateful checkout bug behind simulated SSO authentication — reproduced from the Medium article.
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "12px",
            cursor: "pointer",
            padding: "4px 8px",
          }}
        >
          {isOpen ? "Hide Guide ▲" : "Show Guide ▼"}
        </button>
      </div>

      {isOpen && (
        <div
          style={{
            marginTop: "14px",
            paddingTop: "14px",
            borderTop: "1px solid rgba(122, 162, 247, 0.15)",
            fontSize: "12.5px",
            color: "var(--text-primary)",
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--accent-warning)" }}>
            ⚡ How to Reproduce & Inspect with DOMRay:
          </div>

          <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li>
              <strong>Attach DOMRay:</strong> Open the DOMRay Chrome extension (or Side Panel) on this tab and click{" "}
              <code style={{ background: "var(--bg-surface)", padding: "1px 5px", borderRadius: "4px" }}>Attach</code>.
            </li>
            <li>
              <strong>Trigger the Bug:</strong> In the Order Summary box on the right, type{" "}
              <code style={{ background: "rgba(224, 175, 104, 0.2)", color: "var(--accent-warning)", padding: "1px 6px", borderRadius: "4px" }}>
                EXPIRED20
              </code>{" "}
              into the coupon field and click <strong>Apply</strong>.
            </li>
            <li>
              <strong>Observe the Silent Failure:</strong> Notice the button gets permanently disabled with{" "}
              <em>"Applying…"</em>, no error banner appears, and no uncaught JS error crashes the page.
            </li>
            <li>
              <strong>Ask Your AI Coding Assistant:</strong> In Cursor, Claude Code, or Antigravity, prompt:
              <blockquote
                style={{
                  margin: "8px 0",
                  padding: "8px 12px",
                  background: "var(--bg-app)",
                  borderLeft: "3px solid var(--accent-primary)",
                  borderRadius: "4px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11.5px",
                  color: "var(--accent-hover)",
                }}
              >
                "The apply coupon button is stuck in a disabled state on the active checkout page. Can you inspect the page with DOMRay tools and fix the bug in CouponForm.tsx?"
              </blockquote>
            </li>
            <li>
              <strong>See DOMRay in Action:</strong> The AI will invoke{" "}
              <code style={{ color: "var(--accent-primary)" }}>domray_get_flow_timeline</code> (sees the click &amp; HTTP 422) and{" "}
              <code style={{ color: "var(--accent-primary)" }}>domray_get_component_state</code> (sees{" "}
              <code>isSubmitting: true</code> not resetting in React Fiber), then fix the code immediately!
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
