import { useEffect } from "react";
import { CheckoutLayout } from "./components/CheckoutLayout";

export function App() {
  useEffect(() => {
    // Simulate authenticated SSO / session storage state
    // This allows testing `domray_get_storage_state` where `auth_token` gets masked!
    sessionStorage.setItem("auth_token", "stag_sso_99a82f_secret_session_token");
    sessionStorage.setItem("user_email", "sarah.dev@company.internal");
    sessionStorage.setItem("user_role", "admin");
    sessionStorage.setItem("cart_id", "cart_88319");
    sessionStorage.setItem("environment", "staging-us-east-1");

    // Also set a simulated session cookie
    document.cookie = "company_session_id=sess_2026_988a71b; path=/; SameSite=Lax";
  }, []);

  return <CheckoutLayout />;
}

export default App;
