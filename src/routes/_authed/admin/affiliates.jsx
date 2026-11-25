import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { AuthGateError, requireSignedIn } from "@/components/auth/AuthGate";
import { getAdminAffiliateData, processAffiliatePayout } from "@/lib/affiliate-fns";
import "@/styles/vicehub-admin-affiliates.css";

export const Route = createFileRoute("/_authed/admin/affiliates")({ ssr: false, beforeLoad: requireSignedIn, errorComponent: AuthGateError, head: () => ({ meta: [{ title: "Affiliate Control — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }), component: AdminAffiliates });
const money = (cents, currency) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(cents || 0) / 100);
const date = value => value ? new Date(value).toLocaleString("en-GB") : "—";
function AdminAffiliates() {
  const { user } = Route.useRouteContext();
  const [data, setData] = useState(null), [busy, setBusy] = useState(""), [note, setNote] = useState({}), [error, setError] = useState(""), [notice, setNotice] = useState(""), [filter, setFilter] = useState("all");
  const load = async () => { setError(""); try { setData(await getAdminAffiliateData()); } catch (e) { setError(e.message || "Could not load affiliate data."); } };
  useEffect(() => { if (user?.role === "admin") load(); }, [user?.id]);
  const run = async (id, action) => { setBusy(id); setError(""); setNotice(""); try { await processAffiliatePayout({ data: { payoutId: id, action, adminNote: note[id] || "" } }); setNotice(action === "send" ? "Stripe transfer created and recorded." : "Payout rejected; reserved commissions returned to the affiliate wallet."); await load(); } catch (e) { setError(e.message || "Payout operation failed."); } finally { setBusy(""); } };
  if (user?.role !== "admin") return <SiteFrame eyebrow="VICEHUB / RESTRICTED"><h1>ACCESS DENIED.</h1><p>Administrator permissions are required.</p></SiteFrame>;
  const payouts = data?.payouts || [], visiblePayouts = payouts.filter(p => filter === "all" || p.status === filter);
  const profiles = data?.profiles || [], credits = data?.credits || [];
  return <SiteFrame eyebrow="VICEHUB / AFFILIATE CONTROL"><main className="vhaff-shell">
    <header className="vhaff-hero"><div><span>REVENUE OPERATIONS / REFERRAL PROGRAMME</span><h1>AFFILIATE <em>CONTROL.</em></h1><p>Parrains, filleuls, commissions validées et demandes de versement. Les montants sont affichés séparément par devise.</p></div><Link to="/admin">← MAIN ADMIN</Link></header>
    {error && <div className="vhaff-alert error">{error}</div>}{notice && <div className="vhaff-alert">{notice}</div>}
    {!data ? <section className="vhaff-panel">Loading affiliate ledger…</section> : <>
      <section className="vhaff-kpis"><article><small>PARRAINS</small><b>{profiles.length}</b></article><article><small>FILLEULS CONVERTIS</small><b>{credits.filter(c=>c.status!=="reversed").length}</b></article><article><small>DEMANDES À TRAITER</small><b>{payouts.filter(p=>["requested","failed"].includes(p.status)).length}</b></article><article><small>VERSEMENTS ENVOYÉS</small><b>{payouts.filter(p=>p.status==="sent").length}</b></article></section>
      <section className="vhaff-balances">{["GBP","EUR","USD"].map(cur=>{const b=data.summary[cur]||{};return <article key={cur}><span>{cur} · COMMISSIONS</span><div><small>En validation</small><b>{money(b.pending,cur)}</b></div><div><small>Disponibles</small><b>{money(b.available,cur)}</b></div><div><small>Réservées</small><b>{money(b.reserved,cur)}</b></div><div><small>Déjà versées</small><b>{money(b.paid,cur)}</b></div></article>})}</section>
      <section className="vhaff-panel"><div className="vhaff-heading"><div><h2>DEMANDES DE PAIEMENT</h2><p>Envoyer crée un transfert Stripe vers le compte Express du parrain. Le versement bancaire final suit ensuite le calendrier Stripe du bénéficiaire.</p></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Toutes</option><option value="requested">En attente</option><option value="failed">Échec</option><option value="sent">Envoyées</option><option value="rejected">Refusées</option></select></div>
        {visiblePayouts.map(p=><article className="vhaff-payout" key={p.id}><div className="vhaff-payout-main"><b>{p.user?.name || p.user?.email || p.user_id}</b><small>{p.user?.email} · {date(p.created_date)} · {p.status}</small><strong>{money(p.amount_cents,p.currency)}</strong>{p.stripe_transfer_id&&<small>Stripe transfer: {p.stripe_transfer_id}</small>}</div><div className="vhaff-payout-actions">{["requested","failed"].includes(p.status)&&<><textarea rows="2" placeholder="Note administrative (facultative)" value={note[p.id]||""} onChange={e=>setNote({...note,[p.id]:e.target.value})}/><button disabled={!!busy} onClick={()=>run(p.id,"send")}>{busy===p.id?"TRAITEMENT…":"APPROUVER & ENVOYER"}</button><button className="danger" disabled={!!busy} onClick={()=>run(p.id,"reject")}>REFUSER</button></>}</div></article>)}
        {!visiblePayouts.length&&<p className="vhaff-empty">Aucune demande dans cette catégorie.</p>}
      </section>
      <section className="vhaff-panel"><div className="vhaff-heading"><div><h2>RÉSEAU DE PARRAINAGE</h2><p>Chaque commission correspond à un premier paiement éligible, sans commission récurrente.</p></div><span>{profiles.length} profils</span></div>
        <div className="vhaff-table-wrap"><table className="vhaff-table"><thead><tr><th>Parrain</th><th>Code</th><th>Compte Stripe</th><th>Filleul</th><th>Commission</th><th>Statut</th><th>Date</th></tr></thead><tbody>{credits.map(c=><tr key={c.id}><td>{c.referrer?.name||c.referrer?.email||c.referrer_user_id}<small>{c.referrer?.email}</small></td><td>{profiles.find(p=>p.user_id===c.referrer_user_id)?.referral_code||"—"}</td><td>{profiles.find(p=>p.user_id===c.referrer_user_id)?.stripe_connect_status||"not_started"}</td><td>{c.referred?.email||c.referred_user_id}</td><td>{money(c.amount_cents,c.currency)}</td><td><span className={"vhaff-status "+c.status}>{c.status}</span></td><td>{date(c.created_date)}</td></tr>)}</tbody></table></div>
        {!credits.length&&<p className="vhaff-empty">Aucune commission enregistrée à ce jour. Les profils de parrainage sont néanmoins conservés.</p>}
      </section>
      <section className="vhaff-panel"><h2>PROFILS PARRAINS</h2>{profiles.map(p=><article className="vhaff-profile" key={p.id}><div><b>{p.user?.name||p.user?.email||p.user_id}</b><small>{p.user?.email} · Code {p.referral_code}</small></div><span>{p.stripe_connect_status||"not_started"} · {p.payouts_enabled?"Payouts enabled":"Payouts disabled"}</span></article>)}</section>
      <p className="vhaff-footnote">Sécurité : les coordonnées bancaires ne sont pas stockées par VICEHUB. Stripe héberge la vérification d'identité et les coordonnées de versement. Un transfert envoyé à Stripe Connect n'est pas une preuve de crédit bancaire final.</p>
    </>}
  </main></SiteFrame>;
}
