import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getMyAccount } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/_authed/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "My account — VICEHUB" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { logout } = useAuth();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getMyAccount()
      .then((data) => { if (active) setAccount(data); })
      .catch((err) => { if (active) setError(err?.message || "Could not load your account."); });
    return () => { active = false; };
  }, []);
  const percent = account?.downloadsLimit ? Math.min(100, (account.downloadsUsed / account.downloadsLimit) * 100) : 0;
  return (
    <main className="account-page">
      <header className="account-header">
        <button className="brand" onClick={() => window.location.assign("/")}><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>CREATOR NETWORK</small></span></button>
        <div className="account-header-actions"><span>{user?.full_name || user?.email || "Creator"}</span><button className="outline-btn" onClick={logout}>Sign out</button></div>
      </header>
      <section className="account-content">
        <div className="eyebrow">CREATOR ACCOUNT</div>
        <h1>YOUR WORKSPACE.</h1>
        <p className="account-intro">Manage your membership and track your monthly video downloads.</p>
        {error && <div className="account-error" role="alert">{error}</div>}
        {!account && !error && <div className="account-loading">Loading your account…</div>}
        {account && <>
          <div className="account-summary-grid">
            <article className="account-panel membership-panel">
              <div className="eyebrow">CURRENT MEMBERSHIP</div>
              <div className="account-tier">{account.planName}</div>
              <p>{account.subscriptionStatus === "active" ? "Subscription active" : "Free membership"}</p>
              <div className="account-meta">Billing currency: {account.currency}</div>
            </article>
            <article className="account-panel quota-panel">
              <div className="eyebrow">MONTHLY DOWNLOADS</div>
              <div className="quota-number">{account.downloadsUsed}<span> / {account.downloadsLimit}</span></div>
              <div className="quota-track"><i style={{ width: percent + "%" }} /></div>
              <p>{account.downloadsRemaining} downloads remaining this month</p>
              {account.tier === "free" && <small>Free membership includes five downloads per UTC calendar month.</small>}
            </article>
          </div>
          <section className="account-panel history-panel">
            <div className="section-head"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>DOWNLOAD HISTORY</h2></div><button className="outline-btn" onClick={() => window.location.assign("/")}>Browse videos ↗</button></div>
            {account.history?.length ? <div className="history-list">{account.history.map((item) => <div className="history-row" key={item.id}><div><b>Video download</b><small>Video reference: {item.video_id}</small></div><span>{item.watermark_applied ? "Watermarked" : "Clean"} · {item.status}</span><time>{new Date(item.created_date).toLocaleDateString("en-GB")}</time></div>)}</div> : <div className="account-empty">No downloads yet. Your completed downloads will appear here.</div>}
          </section>
        </>}
      </section>
    </main>
  );
}
