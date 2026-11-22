import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMyAccount, getMyMessages, getMyNotifications, getMySocialPosts, getMyStudioDrafts, getMyCreatorProfile } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/_authed/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Creator Dashboard — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: DashboardPage,
});

const modules = [
  ["/", "01", "VIDEO LIBRARY", "Discover, filter and download creator-ready clips."],
  ["/social", "02", "SOCIAL PUBLISHING", "Prepare content for TikTok, Instagram, YouTube and X."],
  ["/studio", "03", "CREATOR STUDIO", "Build hooks, captions, scripts and metadata."],
  ["/creators", "04", "CREATOR PROFILE", "Manage your identity, bio and public links."],
  ["/messages", "05", "MESSAGES", "Manage private creator conversations."],
  ["/notifications", "06", "NOTIFICATIONS", "Review account and content updates."],
  ["/shop", "07", "VICE SUPPLY", "Browse creator tools and platform merchandise."],
];

function Metric({ label, value, note, href }) {
  return <a className="account-metric" href={href}><span>{label}</span><strong>{value}</strong><small>{note}</small></a>;
}

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { logout } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
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

  return <SiteFrame eyebrow="VICEHUB / CREATOR CONTROL ROOM">
    <section className="account-dashboard-hero">
      <div><div className="eyebrow">YOUR CREATOR OPERATING SYSTEM</div>
        <h1>WELCOME BACK,<br/><em>{(user?.full_name || user?.email || "CREATOR").split(" ")[0].toUpperCase()}.</em></h1>
        <p>Your footage, download allowance, creator tools and social publishing workspace — in one control room.</p>
      </div>
      <div className="account-dashboard-hero-actions">
        <span className="account-status-pill">{account?.tier === "free" ? "FREE MEMBERSHIP" : (account?.planName || "MEMBERSHIP").toUpperCase()}</span>
        <button className="outline-btn" onClick={load} disabled={loading}>{loading ? "REFRESHING…" : "REFRESH DATA ↻"}</button>
        <button className="text-btn" onClick={logout}>SIGN OUT ↗</button>
      </div>
    </section>
    {error && <div className="platform-alert" role="alert">{error}</div>}
    {loading && !data && <div className="platform-empty">Loading your creator workspace…</div>}
    {data && <>
      {data.secondaryErrors > 0 && <div className="platform-note">{data.secondaryErrors} secondary section(s) could not be refreshed. Your account and download data remain available.</div>}
      <section className="account-metrics-grid">
        <Metric label="DOWNLOADS THIS MONTH" value={`${used} / ${limit}`} note={`${account?.downloadsRemaining ?? 0} remaining · UTC month`} href="/" />
        <Metric label="UNREAD MESSAGES" value={unreadMessages} note="Private creator inbox" href="/messages" />
        <Metric label="UNREAD ALERTS" value={unreadAlerts} note="Account and content updates" href="/notifications" />
        <Metric label="SAVED SOCIAL POSTS" value={data.posts.length} note="Drafts and publishing queue" href="/social" />
      </section>
      <div className="account-dashboard-columns">
        <section className="account-panel account-plan-panel">
          <div className="section-head"><div><div className="eyebrow">MEMBERSHIP & DOWNLOADS</div><h2>{account?.planName || "FREE PLAN"}</h2></div><span className="source-pill">{account?.subscriptionStatus || "inactive"}</span></div>
          <div className="quota-track"><i style={{ width: percent + "%" }} /></div>
          <div className="account-plan-foot"><span>{used} downloads used</span><b>{account?.downloadsRemaining ?? 0} left</b></div>
          <p className="account-muted">{account?.tier === "free" ? "Your free membership currently includes five downloads per UTC calendar month. Paid memberships will appear here once billing is activated." : "Your allowance is controlled by your active membership."}</p>
          <a className="outline-btn account-wide-link" href="/">OPEN VIDEO LIBRARY ↗</a>
        </section>
        <section className="account-panel account-profile-panel">
          <div className="eyebrow">CREATOR IDENTITY</div><h2>{data.profile?.display_name || "YOUR CREATOR PROFILE"}</h2>
          <p className="account-muted">{data.profile?.bio || "Add a bio, skills and social links so your creator identity is ready to share."}</p>
          <div className="account-profile-meta"><span>{data.profile ? "Profile saved" : "Profile not created"}</span><span>{data.profile?.skills?.length || 0} skills</span></div>
          <a className="outline-btn account-wide-link" href="/creators">MANAGE CREATOR PROFILE ↗</a>
        </section>
      </div>
      <section className="account-panel account-modules-panel">
        <div className="section-head"><div><div className="eyebrow">YOUR VICEHUB</div><h2>CREATOR WORKSPACES</h2></div><span className="source-pill">7 MODULES</span></div>
        <div className="account-module-grid">{modules.map(([href,code,title,description]) => <a className="account-module-card" href={href} key={href}>
          <span>{code}</span><b>{title}</b><small>{description}</small><i>OPEN MODULE ↗</i>
        </a>)}</div>
      </section>
      <div className="account-dashboard-columns">
        <section className="account-panel">
          <div className="section-head"><div><div className="eyebrow">SOCIAL PUBLISHING</div><h2>YOUR NEXT POSTS</h2></div><a className="text-btn" href="/social">OPEN SOCIAL DESK ↗</a></div>
          {upcoming.length ? upcoming.map(p => <div className="account-feed-row" key={p.id}><div><b>{p.platform}</b><small>{p.caption?.slice(0,100)}</small></div><time>{new Date(p.scheduled_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</time></div>) : <div className="account-empty">No posts planned. Prepare your next publication in Social Desk.</div>}
          <p className="account-muted">Direct publishing will become available after each social platform approves VICEHUB and you connect your account.</p>
        </section>
        <section className="account-panel">
          <div className="section-head"><div><div className="eyebrow">CREATOR STUDIO</div><h2>YOUR SAVED DRAFTS</h2></div><a className="text-btn" href="/studio">OPEN STUDIO ↗</a></div>
          <div className="account-feed-row"><div><b>{data.drafts.length} saved drafts</b><small>Hooks, captions, scripts and content ideas</small></div><span>DRAFTS</span></div>
          <div className="account-feed-row"><div><b>{data.profile?.social_links ? Object.keys(data.profile.social_links).length : 0} social links</b><small>Shown on your public creator profile</small></div><span>PROFILE</span></div>
        </section>
      </div>
      <section className="account-panel history-panel">
        <div className="section-head"><div><div className="eyebrow">YOUR DOWNLOADS</div><h2>DOWNLOAD HISTORY</h2></div><a className="text-btn" href="/">BROWSE VIDEOS ↗</a></div>
        {account?.history?.length ? <div className="history-list">{account.history.map(item => <div className="history-row" key={item.id}><div><b>{item.video_title || "Video download"}</b><small>Reference: {item.video_id}</small></div><span>{item.watermark_applied ? "Watermarked copy" : "Clean copy"} · {item.status}</span><time>{new Date(item.created_date).toLocaleDateString("en-GB")}</time></div>)}</div> : <div className="account-empty">Your downloaded videos will appear here, with the watermark and date recorded.</div>}
      </section>
      {user?.role === "admin" && <div className="admin-shortcut"><div><b>ADMIN CONTROL ROOM</b><small>Manage video ingestion, rights review, subscriptions, users and platform settings.</small></div><div className="admin-shortcut-actions"><button className="primary-btn" onClick={() => window.location.assign("/admin")}>OPEN ADMIN ↗</button><button className="outline-btn" onClick={() => window.location.assign("/admin/videos")}>MANAGE VIDEOS</button></div></div>}
    </>}
  </SiteFrame>;
}
