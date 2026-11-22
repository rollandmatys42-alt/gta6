import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMyAccount, getMyMessages, getMyNotifications, getMySocialPosts, getMyStudioDrafts, getMyCreatorProfile, refreshMySubscription, createStripePortalSession } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";
import {useLocale,translate} from "@/lib/i18n";

export const Route = createFileRoute("/_authed/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Creator Dashboard — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: DashboardPage,
});

const modules = [
  ["/", "01", "dashboard.module.video", "dashboard.module.videoDesc"],
  ["/social", "02", "dashboard.module.social", "dashboard.module.socialDesc"],
  ["/studio", "03", "dashboard.module.studio", "dashboard.module.studioDesc"],
  ["/creators", "04", "dashboard.module.profile", "dashboard.module.profileDesc"],
  ["/messages", "05", "dashboard.module.messages", "dashboard.module.messagesDesc"],
  ["/notifications", "06", "dashboard.module.notifications", "dashboard.module.notificationsDesc"],
  ["/shop", "07", "dashboard.module.shop", "dashboard.module.shopDesc"],
];

function Metric({ label, value, note, href }) {
  return <a className="account-metric" href={href}><span>{label}</span><strong>{value}</strong><small>{note}</small></a>;
}

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { logout } = useAuth();
  const locale=useLocale(),tx=key=>translate(locale,key);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    await refreshMySubscription().catch(() => null);
    const jobs = await Promise.allSettled([getMyAccount(), getMyMessages(), getMyNotifications(), getMySocialPosts(), getMyStudioDrafts(), getMyCreatorProfile()]);
    const val = (i, fallback) => jobs[i].status === "fulfilled" ? jobs[i].value : fallback;
    if (jobs[0].status === "rejected") setError(jobs[0].reason?.message || "Your account data could not be loaded.");
    setData({
      account: val(0, null), messages: val(1, { inbox: [], sent: [] }), notifications: val(2, []),
      posts: val(3, []), drafts: val(4, []), profile: val(5, null),
      secondaryErrors: jobs.slice(1).filter(x => x.status === "rejected").length,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  const upcoming = useMemo(() => (data?.posts || []).filter(p => p.scheduled_at && new Date(p.scheduled_at) >= new Date())
    .sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).slice(0,4), [data]);
  const account = data?.account;
  const used = Number(account?.downloadsUsed || 0), limit = Number(account?.downloadsLimit || 0);
  const percent = limit ? Math.min(100, used / limit * 100) : 0;
  const unreadMessages = data?.messages?.inbox?.filter(m => m.status !== "seen").length || 0;
  const unreadAlerts = data?.notifications?.filter(n => !n.read_at).length || 0;
  const manageBilling = async () => {
    setBillingBusy(true); setError("");
    try { const result = await createStripePortalSession(); window.location.assign(result.url); }
    catch (err) { setError(err?.message || "Billing portal could not be opened."); setBillingBusy(false); }
  };

  return <SiteFrame eyebrow="VICEHUB / CREATOR CONTROL ROOM">
    <section className="vice-dashboard-hero">
      <div className="vice-dashboard-sky"><span className="vice-dashboard-sun" /><span className="vice-dashboard-tower tower-a" /><span className="vice-dashboard-tower tower-b" /><span className="vice-dashboard-tower tower-c" /><span className="vice-dashboard-palm">✦</span><span className="vice-dashboard-road" /></div>
      <div className="vice-dashboard-copy">
        <div className="eyebrow"><i className="live-dot" /> VICE CITY / LEONIDA · CREATOR HQ</div>
        <div className="vice-dashboard-kicker">{tx("dashboard.heroKicker")}</div>
        <h1>{tx("dashboard.title")}<br/><em>{(user?.full_name || user?.email || "CREATOR").split(" ")[0].toUpperCase()}.</em></h1>
        <p>{tx("dashboard.desc")}</p>
        <div className="vice-dashboard-actions"><a className="primary-btn" href="/">{tx("dashboard.explore")} <span>↗</span></a><a className="outline-btn" href="/social">{tx("dashboard.socialDesk")}</a></div>
      </div>
      <div className="vice-dashboard-side">
        <div className="vice-dashboard-membership"><span>{tx("dashboard.access")}</span><b>{account?.tier === "free" ? "FREE MEMBER" : (account?.planName || "MEMBERSHIP").toUpperCase()}</b><small>{account?.subscriptionStatus || "ACCOUNT ACTIVE"}</small></div>
        <div className="vice-dashboard-download-count"><strong>{account?.downloadsRemaining ?? 0}</strong><span>{tx("dashboard.downloads")}<br/>{tx("dashboard.thisMonth")}</span></div>
        <button className="vice-dashboard-refresh" onClick={load} disabled={loading}>{loading ? tx("dashboard.sync") : "↻ " + tx("dashboard.sync")}</button>
        <button className="vice-dashboard-signout" onClick={logout}>{tx("dashboard.signout")} ↗</button>
      </div>
      <div className="vice-dashboard-coordinate">VICEHUB // PERSONAL CREATOR NETWORK <span>26°07' N · 80°08' W</span></div>
    </section>
    {error && <div className="platform-alert" role="alert">{error}</div>}
    {loading && !data && <div className="platform-empty">Loading your creator workspace…</div>}
    {data && <>
      {data.secondaryErrors > 0 && <div className="platform-note">{data.secondaryErrors} secondary section(s) could not be refreshed. Your account and download data remain available.</div>}
      <section className="vice-dashboard-stats">
        <a className="vice-stat-card stat-downloads" href="/"><span>01 / {tx("dashboard.allowance")}</span><strong>{used}<i> / {limit}</i></strong><small>{account?.downloadsRemaining ?? 0} {tx("dashboard.allowanceNote")}</small><div className="vice-stat-track"><i style={{width:percent+"%"}} /></div></a>
        <a className="vice-stat-card" href="/social"><span>02 / {tx("dashboard.socialStat")}</span><strong>{data.posts.length.toString().padStart(2,"0")}</strong><small>{tx("dashboard.socialStatNote")}</small><b className="vice-stat-arrow">↗</b></a>
        <a className="vice-stat-card" href="/studio"><span>03 / {tx("dashboard.studioStat")}</span><strong>{data.drafts.length.toString().padStart(2,"0")}</strong><small>{tx("dashboard.studioStatNote")}</small><b className="vice-stat-arrow">↗</b></a>
        <a className="vice-stat-card" href="/messages"><span>04 / {tx("dashboard.inboxStat")}</span><strong>{(unreadMessages+unreadAlerts).toString().padStart(2,"0")}</strong><small>{unreadMessages} {tx("dashboard.messages")} · {unreadAlerts} {tx("dashboard.alerts")}</small><b className="vice-stat-arrow">↗</b></a>
      </section>
      <div className="account-dashboard-columns">
        <section className="account-panel account-plan-panel">
          <div className="section-head"><div><div className="eyebrow">{tx("dashboard.membership")}</div><h2>{account?.planName || "FREE PLAN"}</h2></div><span className="source-pill">{account?.subscriptionStatus || "inactive"}</span></div>
          <div className="quota-track"><i style={{ width: percent + "%" }} /></div>
          <div className="account-plan-foot"><span>{used} {tx("dashboard.used")}</span><b>{account?.downloadsRemaining ?? 0} {tx("dashboard.left")}</b></div>
          <p className="account-muted">{account?.tier === "free" ? "Your free membership currently includes five downloads per UTC calendar month. Paid memberships will appear here once billing is activated." : "Your allowance is controlled by your active membership."}</p>
          <a className="outline-btn account-wide-link" href="/">{tx("dashboard.library")} ↗</a>
          {account?.hasBillingCustomer && <button className="primary-btn account-wide-link" type="button" disabled={billingBusy} onClick={manageBilling}>{billingBusy?"OPENING BILLING…":"MANAGE MEMBERSHIP / CANCEL ↗"}</button>}
          {!account?.hasBillingCustomer && <p className="account-muted">Billing is not yet linked to this account. Paid memberships will become available when the platform opens subscriptions.</p>}
        </section>
        <section className="account-panel account-profile-panel">
          <div className="eyebrow">{tx("dashboard.profile")}</div><h2>{data.profile?.display_name || tx("dashboard.profile")}</h2>
          <p className="account-muted">{data.profile?.bio || tx("dashboard.profileEmpty")}</p>
          <div className="account-profile-meta"><span>{data.profile ? "Profile saved" : "Profile not created"}</span><span>{data.profile?.skills?.length || 0} skills</span></div>
          <a className="outline-btn account-wide-link" href="/creators">{tx("dashboard.manageProfile")} ↗</a>
        </section>
      </div>
      <section className="account-panel account-modules-panel">
        <div className="section-head"><div><div className="eyebrow">{tx("dashboard.kicker")}</div><h2>{tx("dashboard.workspaces")}</h2></div><span className="source-pill">CONTROL ROOM</span></div>
        <div className="account-module-grid">{modules.map(([href,code,title,description]) => <a className="account-module-card" href={href} key={href}>
          <span>{code}</span><b>{tx(title)}</b><small>{tx(description)}</small><i>{tx("dashboard.openModule")} ↗</i>
        </a>)}</div>
      </section>
      <div className="account-dashboard-columns">
        <section className="account-panel">
          <div className="section-head"><div><div className="eyebrow">SOCIAL PUBLISHING</div><h2>{tx("dashboard.nextPosts")}</h2></div><a className="text-btn" href="/social">{tx("dashboard.socialDesk")} ↗</a></div>
          {upcoming.length ? upcoming.map(p => <div className="account-feed-row" key={p.id}><div><b>{p.platform}</b><small>{p.caption?.slice(0,100)}</small></div><time>{new Date(p.scheduled_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</time></div>) : <div className="account-empty">{tx("dashboard.noPosts")}</div>}
          <p className="account-muted">{tx("dashboard.directNote")}</p>
        </section>
        <section className="account-panel">
          <div className="section-head"><div><div className="eyebrow">CREATOR STUDIO</div><h2>{tx("dashboard.savedDrafts")}</h2></div><a className="text-btn" href="/studio">OPEN STUDIO ↗</a></div>
          <div className="account-feed-row"><div><b>{data.drafts.length} saved drafts</b><small>{tx("dashboard.draftNote")}</small></div><span>DRAFTS</span></div>
          <div className="account-feed-row"><div><b>{data.profile?.social_links ? Object.keys(data.profile.social_links).length : 0} {tx("dashboard.socialLinks")}</b><small>{tx("dashboard.socialLinksNote")}</small></div><span>PROFILE</span></div>
        </section>
      </div>
      <section className="account-panel history-panel">
        <div className="section-head"><div><div className="eyebrow">{tx("dashboard.history")}</div><h2>{tx("dashboard.history")}</h2></div><a className="text-btn" href="/">{tx("dashboard.browse")} ↗</a></div>
        {account?.history?.length ? <div className="history-list">{account.history.map(item => <div className="history-row" key={item.id}><div><b>{item.video_title || "Video download"}</b><small>Reference: {item.video_id}</small></div><span>{item.watermark_applied ? tx("dashboard.watermarked") : tx("dashboard.clean")} · {item.status}</span><time>{new Date(item.created_date).toLocaleDateString("en-GB")}</time></div>)}</div> : <div className="account-empty">{tx("dashboard.noDownloads")}</div>}
      </section>
      {user?.role === "admin" && <div className="admin-shortcut"><div><b>{tx("dashboard.admin")}</b><small>Manage video ingestion, rights review, subscriptions, users and platform settings.</small></div><div className="admin-shortcut-actions"><button className="primary-btn" onClick={() => window.location.assign("/admin")}>{tx("dashboard.openAdmin")} ↗</button><button className="outline-btn" onClick={() => window.location.assign("/admin/videos")}>MANAGE VIDEOS</button></div></div>}
    </>}
  </SiteFrame>;
}
