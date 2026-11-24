import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { createStripePortalSession, getMyAccount, refreshMySubscription } from "@/lib/server-fns";

export const Route = createFileRoute("/_authed/subscription")({
  ssr: false,
  head: () => ({ meta: [{ title: "My Subscription — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: MySubscriptionPage,
});

function MySubscriptionPage() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      await refreshMySubscription().catch(() => null);
      setAccount(await getMyAccount());
    } catch (e) {
      setError(e?.message || "Your subscription details could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const manage = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await createStripePortalSession();
      if (!result?.url) throw new Error("The billing portal did not return a valid link.");
      window.location.assign(result.url);
    } catch (e) {
      setError(e?.message || "The billing portal could not be opened.");
      setBusy(false);
    }
  };

  const active = account?.subscriptionStatus === "active";
  const plan = account?.planName || (account?.tier === "free" ? "Free membership" : "Membership");
  return <SiteFrame eyebrow="VICEHUB / MY SUBSCRIPTION" workspace activeKey="subscription">
    <div className="vh-subscription-page">
      <section className="vh-subscription-hero">
        <div><span className="vh-subscription-kicker">VICEHUB MEMBER SERVICES / ACCOUNT VI</span>
          <h1>MY <em>SUBSCRIPTION.</em></h1>
          <p>Review your current membership, download allowance and billing controls.</p>
        </div>
        <div className="vh-subscription-emblem vh-subscription-art"><img src="https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=1920" alt="Vice City — official GTA VI artwork" /><span>VICE CITY / VI</span></div>
      </section>
      {error && <div className="member-alert" role="alert">{error}</div>}
      {loading ? <div className="vh-subscription-panel">LOADING YOUR MEMBERSHIP…</div> : <div className="vh-subscription-grid">
        <section className="vh-subscription-panel vh-subscription-main">
          <span className="vh-subscription-kicker">CURRENT MEMBERSHIP</span>
          <div className="vh-subscription-plan-row"><h2>{plan}</h2><span className={active ? "vh-subscription-status active" : "vh-subscription-status"}>{String(account?.subscriptionStatus || "FREE").replaceAll("_"," ").toUpperCase()}</span></div>
          <p>{account?.tier === "free" ? "You are currently using the free membership. Upgrade to unlock a larger monthly download allowance and member benefits." : "Your membership and included downloads are shown below."}</p>
          <div className="vh-subscription-metrics">
            <div><small>DOWNLOADS USED</small><b>{Number(account?.downloadsUsed || 0)}</b></div>
            <div><small>DOWNLOADS REMAINING</small><b>{Number(account?.downloadsRemaining || 0)}</b></div>
            <div><small>MONTHLY ALLOWANCE</small><b>{Number(account?.downloadsLimit || 0) || "—"}</b></div>
          </div>
          <div className="vh-subscription-actions">
            {account?.hasBillingCustomer ? <button type="button" disabled={busy} onClick={manage}>{busy ? "OPENING SECURE BILLING…" : "MANAGE SUBSCRIPTION ↗"}</button> : <Link to="/#plans">COMPARE MEMBERSHIPS ↗</Link>}
            <Link to="/dashboard">BACK TO DASHBOARD ↗</Link>
          </div>
        </section>
        <aside className="vh-subscription-panel vh-subscription-help">
          <span className="vh-subscription-kicker">BILLING CONTROL</span>
          <h3>YOUR ACCOUNT. YOUR CONTROL.</h3>
          <p>Payment methods, invoices, plan changes and cancellation are handled through the secure billing portal when a Stripe customer record is linked to your account.</p>
          <p className="vh-subscription-footnote">If you cannot open billing, contact VICEHUB support before creating a second subscription.</p>
          <Link to="/contact">CONTACT SUPPORT ↗</Link>
        </aside>
      </div>}
    </div>
  </SiteFrame>;
}
