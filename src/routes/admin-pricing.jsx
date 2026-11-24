import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import "@/styles/fan-admin.css";
import { requireSignedIn, AuthGateError } from "@/components/auth/AuthGate";
import { getAdminPlans, saveAdminPlan, syncAdminPlanToStripe } from "@/lib/server-fns";

export const Route = createFileRoute("/admin-pricing")({
  ssr: false, beforeLoad: requireSignedIn, errorComponent: AuthGateError,
  head: () => ({ meta: [{ title: "Creator Membership pricing — VICEHUB admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AdminPricing,
});

function AdminPricing() {
  const { user } = Route.useRouteContext();
  const [plans, setPlans] = useState([]);
  const [msg, setMsg] = useState("");
  const load = () => getAdminPlans().then(r => setPlans(Array.isArray(r) ? r.filter(p => p.tier_code === "pro") : [])).catch(e => setMsg(e.message || "Could not load plans."));
  useEffect(() => { if (user?.role === "admin") load(); }, [user?.id]);
  if (user?.role !== "admin") return <SiteFrame eyebrow="VICEHUB / RESTRICTED"><h1>ACCESS DENIED.</h1></SiteFrame>;
  return <SiteFrame eyebrow="ADMIN / CREATOR MEMBERSHIP"><div className="vh-admin-pricing">
    <h1>One Creator Membership</h1>
    <p>VICEHUB now uses one paid membership. Set the local monthly price and download allowance for GBP, EUR and USD. The old degressive ladder is no longer used for new subscriptions. Existing subscriptions are not silently repriced.</p>
    {msg && <div className="fan-notice" role="status">{msg}</div>}
    <div className="fan-grid">{plans.map(p => <SinglePlan key={p.id} plan={p} onSaved={() => { setMsg("Saved."); load(); }} onError={setMsg} />)}</div>
  </div></SiteFrame>;
}

function SinglePlan({ plan, onSaved, onError }) {
  const [price, setPrice] = useState((Number(plan.monthly_price_cents || 0) / 100).toFixed(2));
  const [downloads, setDownloads] = useState(Number(plan.monthly_download_limit || 50));
  const [clean, setClean] = useState(!!plan.clean_downloads);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const cents = Math.round(Number(price) * 100);
    if (!Number.isInteger(cents) || cents < 1 || !Number.isInteger(downloads) || downloads < 1) return onError("Enter a positive monthly price and download allowance.");
    setBusy(true);
    try {
      await saveAdminPlan({ data: { id: plan.id, tierCode: "pro", displayName: "Creator Membership", monthlyPriceCents: cents, currency: plan.currency, monthlyDownloadLimit: downloads, cleanDownloads: clean, marketplaceEnabled: false, status: "active", loyaltyMonthlyDiscountPercent: 0, loyaltyMaxDiscountPercent: 0, loyaltyFloorPriceCents: 0, sortOrder: 1 } });
      onSaved();
    } catch (e) { onError(e.message || "Save failed."); }
    finally { setBusy(false); }
  };
  const sync = async () => { setBusy(true); try { const result = await syncAdminPlanToStripe({ data: { id: plan.id } }); onError(result.alreadySynced ? "Stripe price is already linked. Save a changed price first to create a new one." : "Stripe monthly price created and linked."); } catch(e) { onError(e.message || "Stripe sync failed."); } finally { setBusy(false); } };
  return <div className="fan-card vh-single-plan">
    <h3>Creator Membership · {plan.currency}</h3>
    <label>Monthly price ({plan.currency})<input type="number" min="0.01" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} /></label>
    <label>Monthly downloads<input type="number" min="1" max="1000" value={downloads} onChange={e=>setDownloads(Math.max(1, Number(e.target.value)||1))} /></label>
    <label className="vh-check"><input type="checkbox" checked={clean} onChange={e=>setClean(e.target.checked)} /> Clean downloads without VICEHUB watermark</label>
    <p className="vh-plan-status">Status: {plan.status} · Stripe price: {plan.stripe_price_id ? "linked" : "not linked"}</p>
    <div className="fan-actions"><button className="fan-btn" type="button" disabled={busy} onClick={save}>{busy?"Saving…":"Save membership"}</button><button className="fan-btn ghost" type="button" disabled={busy || !plan.monthly_price_cents} onClick={sync}>Sync Stripe price</button></div>
  </div>;
}
