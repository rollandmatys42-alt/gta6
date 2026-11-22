import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { confirmStripeCheckoutSession } from "@/lib/server-fns";

export const Route = createFileRoute("/subscription/success")({
  ssr: false,
  head: () => ({ meta: [{ title: "Membership confirmed — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: SubscriptionSuccessPage,
});

function SubscriptionSuccessPage() {
  const [status, setStatus] = useState("confirming");
  const [membership, setMembership] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) { setStatus("error"); setError("The Stripe checkout reference is missing."); return; }
    confirmStripeCheckoutSession({ data: { sessionId } })
      .then(result => { if (active) { setMembership(result); setStatus("confirmed"); } })
      .catch(err => { if (active) { setError(err?.message || "We could not confirm the Stripe payment."); setStatus("error"); } });
    return () => { active = false; };
  }, []);

  return <SiteFrame eyebrow="VICEHUB / MEMBERSHIP">
    <section className="subscription-confirmation">
      {status === "confirming" && <><div className="eyebrow">SECURE BILLING</div><h1>CONFIRMING<br/><em>YOUR MEMBERSHIP.</em></h1><p>Checking the payment directly with Stripe. Do not close this page.</p></>}
      {status === "confirmed" && <><div className="eyebrow">PAYMENT CONFIRMED</div><h1>YOU'RE<br/><em>IN THE HUB.</em></h1><p>Your {membership?.tierCode?.toUpperCase()} membership is active. Your download allowance and account access will now follow this plan.</p><div className="subscription-confirmation-meta"><b>{membership?.currency} {(membership?.priceCents/100).toFixed(2)} / month</b><span>STATUS: {membership?.status?.toUpperCase()}</span></div><a className="primary-btn" href="/dashboard">OPEN MY CREATOR DASHBOARD ↗</a></>}
      {status === "error" && <><div className="eyebrow">PAYMENT VERIFICATION</div><h1>WE COULD NOT<br/><em>CONFIRM YET.</em></h1><p>{error}</p><p>If your card was charged, do not pay again. Contact support with your checkout reference so the payment can be reconciled.</p><a className="outline-btn" href="/dashboard">RETURN TO MY ACCOUNT ↗</a></>}
    </section>
  </SiteFrame>;
}
