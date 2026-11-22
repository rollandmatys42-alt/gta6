import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { completeSocialOAuth } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/social/callback/instagram")({
  ssr: false,
  head: () => ({ meta: [{ title: "Instagram account connection — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: SocialCallbackPage,
});

function SocialCallbackPage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const providerError = params.get("error_description") || params.get("error");
    const code = params.get("code");
    const state = params.get("state");
    if (providerError) { setError(providerError); setBusy(false); return; }
    if (!isAuthenticated) { setError("Your VICEHUB session has expired. Sign in again, then reconnect your account."); setBusy(false); return; }
    if (!code || !state) { setError("The provider did not return a valid authorisation code."); setBusy(false); return; }
    completeSocialOAuth({ data: { provider: "Instagram", code, state } })
      .then(result => setNotice("Instagram account connected: " + result.accountName))
      .catch(err => setError(err?.message || "Could not connect the Instagram account."))
      .finally(() => setBusy(false));
  }, [isAuthenticated]);
  return <SiteFrame eyebrow="VICEHUB / SOCIAL ACCOUNT CONNECTION">
    <section className="platform-form social-callback-panel">
      <div className="eyebrow">SECURE ACCOUNT AUTHORISATION</div>
      <h1>Instagram CONNECTION</h1>
      {busy && <p>Completing secure authorisation…</p>}
      {notice && <div className="platform-success" role="status">{notice}</div>}
      {error && <div className="platform-alert" role="alert">{error}</div>}
      <button className="primary-btn" onClick={() => window.location.assign("/social")}>RETURN TO SOCIAL DESK ↗</button>
      {!isAuthenticated && <button className="outline-btn" onClick={navigateToLogin}>SIGN IN</button>}
    </section>
  </SiteFrame>;
}
