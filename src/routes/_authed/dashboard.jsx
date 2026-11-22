import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMyAccount, getMyMessages, getMyNotifications, getMyListings, getMyMarketplaceInquiries, getMySocialPosts, getMyStudioDrafts, getMyCreatorProfile } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/_authed/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Creator Dashboard — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: DashboardPage,
});

const modules = [
  ["/", "01", "Video library", "Browse the curated GTA VI clip catalogue and download options."],
  ["/social", "02", "Social planner", "Prepare TikTok, Instagram, YouTube and X posts."],
  ["/studio", "03", "AI creator studio", "Draft hooks, captions, scripts, SEO and GEO content."],
  ["/marketplace", "04", "Creator marketplace", "Publish listings and manage buyer enquiries."],
  ["/creators", "05", "Creator directory", "Build your profile and connect with other creators."],
  ["/community", "06", "Community", "Join discussions and publish forum threads."],
  ["/messages", "07", "Private messages", "Manage your creator conversations."],
  ["/notifications", "08", "Notifications", "Review replies and account updates."],
  ["/shop", "09", "VICE supply", "Browse creator tools and platform merchandise."],
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
    const jobs = await Promise.allSettled([
      getMyAccount(), getMyMessages(), getMyNotifications(), getMyListings(),
      getMyMarketplaceInquiries(), getMySocialPosts(), getMyStudioDrafts(), getMyCreatorProfile(),
    ]);
    const val = (i, fallback) => jobs[i].status === "fulfilled" ? jobs[i].value : fallback;
    if (jobs[0].status === "rejected") setError(jobs[0].reason?.message || "Your account data could not be loaded.");
    setData({
      account: val(0, null), messages: val(1, { inbox: [], sent: [] }), notifications: val(2, []),
      listings: val(3, []), inquiries: val(4, { buyer: [], seller: [] }), posts: val(5, []),
      drafts: val(6, []), profile: val(7, null), secondaryErrors: jobs.slice(1).filter(x => x.status === "rejected").length,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  const upcoming = useMemo(() => (data?.posts || []).filter(p => p.scheduled_at && new Date(p.scheduled_at) >= new Date())
    .sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).slice(0,3), [data]);
  const account = data?.account;
  const used = Number(account?.downloadsUsed || 0), limit = Number(account?.downloadsLimit || 0);
  const percent = limit ? Math.min(100, used / limit * 100) : 0;
  const unreadMessages = data?.messages?.inbox?.filter(m => m.status !== "seen").length || 0;
  const unreadAlerts = data?.notifications?.filter(n => !n.read_at).length || 0;

  return <SiteFrame eyebrow="VICEHUB / CREATOR CONTROL ROOM">
    <section className="account-dashboard-hero">
      <div><div className="eyebrow">YOUR CREATOR OPERATING DESK</div>
        <h1>WELCOME BACK,<br/><em>{(user?.full_name || user?.email || "CREATOR").split(" ")[0].toUpperCase()}.</em></h1>
        <p>One place to manage your content, creator identity, downloads and community activity.</p>
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
      {data.secondaryErrors > 0 && <div className="platform-note">{data.secondaryErrors} secondary section(s) could not be refreshed. Your core account data is still available.</div>}
      <section className="account-metrics-grid">
        <Metric label="DOWNLOADS THIS MONTH" value={`${used} / ${limit}`} note={`${account?.downloadsRemaining ?? 0} remaining · UTC month`} href="/" />
        <Metric label="UNREAD MESSAGES" value={unreadMessages} note="Private creator inbox" href="/messages" />
        <Metric label="UNREAD ALERTS" value={unreadAlerts} note="Account and marketplace updates" href="/notifications" />
        <Metric label="YOUR LISTINGS" value={data.listings.length} note={`${data.inquiries?.seller?.length || 0} seller enquiries received`} href="/marketplace" />
      </section>
      <div className="account-dashboard-columns">
        <section className="account-panel account-plan-panel">
          <div className="section-head"><div><div className="eyebrow">MEMBERSHIP & USAGE</div><h2>{account?.planName || "FREE PLAN"}</h2></div><span className="source-pill">{account?.subscriptionStatus || "inactive"}</span></div>
          <div className="quota-track"><i style={{ width: percent + "%" }} /></div>
          <div className="account-plan-foot"><span>{used} downloads used</span><b>{account?.downloadsRemaining ?? 0} left</b></div>
          <p className="account-muted">{account?.tier === "free" ? "The free membership includes five downloads per UTC calendar month. Paid plans remain unavailable until pricing and billing are configured." : "Your download allowance is controlled by your active membership."}</p>
          <a className="outline-btn account-wide-link" href="/">OPEN VIDEO LIBRARY ↗</a>
        </section>
        <section className="account-panel">
          <div className="eyebrow">CREATOR IDENTITY</div><h2>{data.profile?.display_name || "SET UP YOUR PROFILE"}</h2>
          <p className="account-muted">{data.profile?.bio || "Add a public bio, skills and links so other creators can discover your work."}</p>
          <div className="account-profile-meta"><span>{data.profile ? "Profile saved" : "Profile not created"}</span><span>{data.profile?.skills?.length || 0} skills</span></div>
          <a className="outline-btn account-wide-link" href="/creators">MANAGE CREATOR PROFILE ↗</a>
        </section>
      </div>
      <section className="account-panel account-modules-panel">
        <div className="section-head"><div><div className="eyebrow">YOUR PLATFORM</div><h2>ALL CREATOR MODULES</h2></div><span className="source-pill">9 WORKSPACES</span></div>
        <div className="account-module-grid">{modules.map(([href,code,title,description]) => <a className="account-module-card" href={href} key={href}>
          <span>{code}</span><b>{title}</b><small>{description}</small><i>OPEN MODULE ↗</i>
        </a>)}</div>
      </section>
      <div className="account-dashboard-columns">
        <section className="account-panel">
          <div className="section-head"><div><div className="eyebrow">CONTENT CALENDAR</div><h2>NEXT PLANNED POSTS</h2></div><a className="text-btn" href="/social">OPEN PLANNER ↗</a></div>
          {upcoming.length ? upcoming.map(p => <div className="account-feed-row" key={p.id}><div><b>{p.platform}</b><small>{p.caption?.slice(0,100)}</small></div><time>{new Date(p.scheduled_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</time></div>) : <div className="account-empty">No upcoming reminders. Add a post in your Social Planner.</div>}
          <p className="account-muted">Planned dates are reminders only; posts are not automatically published to social networks.</p>
        </section>
        <section className="account-panel">
          <div className="section-head"><div><div className="eyebrow">MARKETPLACE DESK</div><h2>SELLER ACTIVITY</h2></div><a className="text-btn" href="/marketplace">OPEN MARKETPLACE ↗</a></div>
          <div className="account-feed-row"><div><b>{data.inquiries?.seller?.length || 0} incoming enquiries</b><small>Questions from potential buyers</small></div><span>INBOX</span></div>
          <div className="account-feed-row"><div><b>{data.inquiries?.buyer?.length || 0} enquiries sent</b><small>Replies from creators appear in Marketplace</small></div><span>BUYER</span></div>
          <div className="account-feed-row"><div><b>{data.listings.filter(x => x.status === "published").length} published listings</b><small>{data.listings.filter(x => x.status !== "published").length} drafts or under review</small></div><span>LISTINGS</span></div>
        </section>
      </div>
      <section className="account-panel history-panel">
        <div className="section-head"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>DOWNLOAD HISTORY</h2></div><a className="text-btn" href="/">BROWSE VIDEOS ↗</a></div>
        {account?.history?.length ? <div className="history-list">{account.history.map(item => <div className="history-row" key={item.id}><div><b>Video download</b><small>Reference: {item.video_id}</small></div><span>{item.watermark_applied ? "Watermarked" : "Clean"} · {item.status}</span><time>{new Date(item.created_date).toLocaleDateString("en-GB")}</time></div>)}</div> : <div className="account-empty">No downloads yet. Your completed downloads will appear here.</div>}
      </section>
      {user?.role === "admin" && <div className="admin-shortcut"><div><b>ADMIN CONTROL ROOM</b><small>Moderate content, manage users, plans, news, marketplace and platform settings.</small></div><div className="admin-shortcut-actions"><button className="primary-btn" onClick={() => window.location.assign("/admin")}>OPEN ADMIN ↗</button><button className="outline-btn" onClick={() => window.location.assign("/admin/videos")}>MANAGE VIDEOS</button></div></div>}
    </>}
  </SiteFrame>;
}
