import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { requireSignedIn, AuthGateError } from "@/components/auth/AuthGate";
import { getAdminLadderPlans, saveAdminPlanLadder } from "@/lib/loyalty-fns";
import { DEFAULT_LADDER_CENTS, DEFAULT_STEP_MONTHS, getLadder, getStepMonths } from "@/lib/loyalty";

export const Route = createFileRoute("/admin-pricing")({
  ssr: false, beforeLoad: requireSignedIn, errorComponent: AuthGateError,
  head: () => ({ meta: [{ title: "Pricing ladder — VICEHUB admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AdminPricing,
});

function AdminPricing() {
  const { user } = Route.useRouteContext();
  const [plans, setPlans] = useState([]);
  const [msg, setMsg] = useState("");
  const load = () => getAdminLadderPlans().then(r => setPlans(Array.isArray(r) ? r : [])).catch(e => setMsg(e.message || "Could not load plans."));
  useEffect(() => { if (user?.role === "admin") load(); }, [user?.id]);
  if (user?.role !== "admin") return <SiteFrame eyebrow="VICEHUB / RESTRICTED"><h1>ACCESS DENIED.</h1></SiteFrame>;
  return <SiteFrame eyebrow="ADMIN / DEGRESSIVE PRICING">
    <h1>Pricing ladder</h1>
    <p>Default: $49.99 for months 1–3, $39.99 for 4–6, $29.99 for 7–9, then $9.99 forever. A cancellation followed by a new subscription restarts at step 1.</p>
    {msg && <div className="fan-notice" role="status">{msg}</div>}
    <div className="fan-grid">{plans.map(p => <PlanLadder key={p.id} plan={p} onSaved={() => { setMsg("Saved."); load(); }} onError={setMsg} />)}</div>
  </SiteFrame>;
}

function PlanLadder({ plan, onSaved, onError }) {
  const [ladder, setLadder] = useState(getLadder(plan));
  const [step, setStep] = useState(getStepMonths(plan));
  const save = () => saveAdminPlanLadder({ data: { id: plan.id, priceLadderCents: ladder, ladderStepMonths: step } }).then(onSaved).catch(e => onError(e.message || "Save failed."));
  return <div className="fan-card">
    <h3>{plan.display_name} · {plan.currency}</h3>
    <label>Months per step<input type="number" min="1" max="12" value={step} onChange={e => setStep(Math.max(1, Number(e.target.value) || DEFAULT_STEP_MONTHS))} /></label>
    <div className="ladder-grid">{ladder.map((c, i) => <label key={i}>{i === ladder.length - 1 ? `Month ${i * step + 1}+` : `Months ${i * step + 1}–${(i + 1) * step}`}
      <input type="number" min="0.01" step="0.01" value={(c / 100).toFixed(2)} onChange={e => setLadder(ladder.map((x, j) => j === i ? Math.max(1, Math.round(Number(e.target.value) * 100)) : x))} /></label>)}</div>
    <button className="fan-btn" onClick={save}>Save</button>{" "}
    <button className="fan-btn ghost" onClick={() => setLadder(DEFAULT_LADDER_CENTS)}>Reset to default</button>
  </div>;
}
