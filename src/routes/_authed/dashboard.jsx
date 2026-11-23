import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMyAccount, getMyMessages, getMyNotifications, getMySocialPosts, getMyStudioDrafts, getMyCreatorProfile, refreshMySubscription, createStripePortalSession } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";
import { useLocale, setSiteLocale, translate } from "@/lib/i18n";
import { getMyLadderQuote as getMyPlanQuote } from "@/lib/loyalty-fns";
import { formatMoney } from "@/lib/loyalty";
import "@/styles/client-dashboard.css";

export const Route = createFileRoute("/_authed/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Creator Dashboard — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: DashboardPage,
});

const navItems = [
  { href: "/dashboard", icon: "⌂", label: "Overview", key: "overview" },
  { href: "/library", icon: "▤", label: "Video library", key: "library" },
  { href: "/social", icon: "↗", label: "Social planner", key: "social" },
  { href: "/studio", icon: "✦", label: "Creator studio", key: "studio" },
  { href: "/messages", icon: "✉", label: "Messages", key: "messages" },
  { href: "/notifications", icon: "◉", label: "Notifications", key: "notifications" },
  { href: "/creators", icon: "◎", label: "My creator profile", key: "profile" },
  { href: "/news", icon: "▧", label: "GTA VI news", key: "news" },
];

const money = (cents, currency) => formatMoney(Number(cents || 0), currency || "USD");
const localeTags = { en: "en-GB", fr: "fr-FR", es: "es-ES", pt: "pt-PT", it: "it-IT", de: "de-DE" };
const dateTime = (value, locale) => value ? new Date(value).toLocaleString(localeTags[locale] || "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
const dateOnly = (value, locale) => value ? new Date(value).toLocaleDateString(localeTags[locale] || "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { logout } = useAuth();
  const locale = useLocale();
  const tx = key => translate(locale, key);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    await refreshMySubscription().catch(() => null);
    const jobs = await Promise.allSettled([
      getMyAccount(),
      getMyMessages(),
      getMyNotifications(),
      getMySocialPosts(),
      getMyStudioDrafts(),
      getMyCreatorProfile(),
    ]);
    const value = (i, fallback) => jobs[i].status === "fulfilled" ? jobs[i].value : fallback;
    if (jobs[0].status === "rejected") setError(jobs[0].reason?.message || "Your account could not be loaded.");
    setData({
      account: value(0, null),
      messages: value(1, { inbox: [], sent: [] }),
      notifications: value(2, []),
      posts: value(3, []),
      drafts: value(4, []),
      profile: value(5, null),
      secondaryErrors: jobs.slice(1).filter(x => x.status === "rejected").length,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const account = data?.account;
  useEffect(() => {
    if (!account?.currency || !["starter", "pro", "premium"].includes(account?.tier)) {
      setQuote(null);
      return;
    }
    let active = true;
    setQuoteLoading(true);
    getMyPlanQuote({ data: { tierCode: account.tier, currency: account.currency } })
      .then(result => { if (active) setQuote(result); })
      .catch(() => { if (active) setQuote(null); })
      .finally(() => { if (active) setQuoteLoading(false); });
    return () => { active = false; };
  }, [account?.currency, account?.tier]);

  const posts = data?.posts || [];
  const drafts = data?.drafts || [];
  const history = account?.history || [];
  const upcoming = useMemo(() => posts
    .filter(p => p.scheduled_at && new Date(p.scheduled_at) >= new Date())
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 4), [posts]);
  const used = Number(account?.downloadsUsed || 0);
  const limit = Number(account?.downloadsLimit || 0);
  const remaining = Number(account?.downloadsRemaining || 0);
  const percent = limit ? Math.min(100, used / limit * 100) : 0;
  const unreadMessages = data?.messages?.inbox?.filter(m => m.status !== "seen").length || 0;
  const unreadAlerts = data?.notifications?.filter(n => !n.read_at).length || 0;
  const firstName = (user?.full_name || user?.email || "Creator").split(" ")[0];
  const planName = account?.planName || (account?.tier === "free" ? "Free member" : "Membership");
  const profile = data?.profile;
  const profileFields = [!!profile?.display_name, !!profile?.bio, !!(profile?.skills || []).length, !!(profile?.social_links && Object.keys(profile.social_links).length)];
  const profilePercent = Math.round(profileFields.filter(Boolean).length / profileFields.length * 100);

  const manageBilling = async () => {
    setBillingBusy(true);
    setError("");
    try {
      const result = await createStripePortalSession();
      window.location.assign(result.url);
    } catch (err) {
      setError(err?.message || "Billing portal could not be opened.");
      setBillingBusy(false);
    }
  };

  return <div className="cd-app-shell">
    <div className="cd-layout">
      <aside className="cd-sidebar">
        <a className="cd-side-brand" href="/dashboard"><span className="cd-brand-mark">V</span><div><b>VICEHUB</b><small>CREATOR HQ / LEONIDA</small></div></a>
        <div className="cd-side-user">
          <div className="cd-avatar">{firstName.slice(0, 1).toUpperCase()}</div>
          <div><b>{firstName}</b><small>{(account?.tier || "free").toUpperCase()} ACCOUNT</small></div>
          <span className="cd-online-dot" />
        </div>
        <div className="cd-nav-caption">{tx("dashboard.workspace")}</div>
        <nav className="cd-side-nav" aria-label="Creator workspace navigation">
          {navItems.map(item => <a key={item.href} href={item.href} className={item.href === "/dashboard" ? "active" : ""} aria-current={item.href === "/dashboard" ? "page" : undefined}>
            <span className="cd-nav-icon">{item.icon}</span><span>{tx("dashboard.nav." + (item.key || item.href.slice(1)))}</span>
            {item.key === "messages" && unreadMessages > 0 && <i>{unreadMessages}</i>}
            {item.key === "notifications" && unreadAlerts > 0 && <i>{unreadAlerts}</i>}
          </a>)}
        </nav>
        <div className="cd-sidebar-bottom">
          <div className="cd-side-plan"><span>{tx("dashboard.membership")}</span><b>{planName}</b><small>{account?.subscriptionStatus || "Account active"}</small><a href="/#plans">View membership ↗</a></div>
          <button type="button" onClick={logout} className="cd-logout">↪ <span>{tx("dashboard.signout")}</span></button>
        </div>
      </aside>

      <main className="cd-main">
        <header className="cd-topbar">
          <div><span className="cd-overline">{new Intl.DateTimeFormat(localeTags[locale] || "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toUpperCase()} · VICE CITY, LEONIDA</span><h1>{tx("dashboard.title")}<span>.</span></h1><p>{tx("dashboard.intro")}</p></div>
          <div className="cd-top-actions"><label className="cd-language-control"><span className="sr-only">Language</span><select aria-label="Language" value={locale} onChange={event => setSiteLocale(event.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option><option value="pt">PT</option><option value="it">IT</option><option value="de">DE</option></select></label><a href="/library" className="cd-primary-action">{tx("dashboard.browse")} <span>↗</span></a><button type="button" className="cd-refresh" onClick={load} disabled={loading}>{loading ? tx("dashboard.sync") : "↻ " + tx("dashboard.refresh")}</button></div>
        </header>

        {error && <div className="cd-alert" role="alert">{error}</div>}
        {loading && !data && <div className="cd-loading"><span className="cd-spinner" /> {tx("dashboard.loading")}</div>}
        {data && <>
          {data.secondaryErrors > 0 && <div className="cd-note">{data.secondaryErrors} secondary section(s) could not be refreshed. Your account information is still available.</div>}

          <section className="cd-welcome">
            <div className="cd-welcome-image" />
            <div className="cd-welcome-content">
              <span className="cd-eyebrow"><i /> {tx("dashboard.welcome")}</span><span className="cd-location-chip">VICE CITY <b>·</b> LEONIDA, USA</span>
              <h2>{tx("dashboard.welcomeTitle")}<br /><em>{firstName}.</em></h2>
              <p>{tx("dashboard.welcomeCopy")}</p>
              <div className="cd-welcome-actions"><a href="/library">{tx("dashboard.explore")}</a><a href="/social">{tx("dashboard.planner")}</a></div>
            </div>
            <div className="cd-welcome-stamp"><b>VICE</b><span>CITY</span><small>LEONIDA · USA</small></div>
          </section>

          <section className="cd-metrics" aria-label={tx("dashboard.overview")}>
            <a href="/library" className="cd-metric cd-metric-downloads">
              <span className="cd-metric-icon">⇩</span><small>{tx("dashboard.downloads")}</small>
              <strong>{remaining}<i> / {limit || "—"}</i></strong>
              <span className="cd-progress"><i style={{ width: percent + "%" }} /></span>
              <em>{used} used this month</em>
            </a>
            <a href="/social" className="cd-metric"><span className="cd-metric-icon">↗</span><small>{tx("dashboard.publications")}</small><strong>{posts.length.toString().padStart(2, "0")}</strong><em>Drafts, scheduled and published</em></a>
            <a href="/studio" className="cd-metric"><span className="cd-metric-icon">✦</span><small>STUDIO DRAFTS</small><strong>{drafts.length.toString().padStart(2, "0")}</strong><em>Saved creative work</em></a>
            <a href="/messages" className="cd-metric"><span className="cd-metric-icon">✉</span><small>{tx("dashboard.unread")}</small><strong>{(unreadMessages + unreadAlerts).toString().padStart(2, "0")}</strong><em>{unreadMessages} messages · {unreadAlerts} alerts</em></a>
          </section>

          <section className="cd-section">
            <div className="cd-section-heading"><div><span className="cd-eyebrow">{tx("dashboard.account")}</span><h2>{tx("dashboard.membershipDownloads")}</h2></div><span className="cd-live-pill">● ACCOUNT STATUS: {account?.subscriptionStatus || "ACTIVE"}</span></div>
            <div className="cd-membership-grid">
              <article className="cd-panel cd-plan-panel">
                <div className="cd-panel-top"><span>{tx("dashboard.currentPlan")}</span><b>{(account?.tier || "free").toUpperCase()}</b></div>
                <h3>{planName}</h3>
                <p>{account?.tier === "free" ? "Your free access includes five downloads per UTC calendar month." : "Your monthly allowance and download rights are controlled by your active membership."}</p>
                <div className="cd-plan-stats"><div><b>{remaining}</b><small>Downloads left</small></div><div><b>{limit}</b><small>Monthly allowance</small></div><div><b>{used}</b><small>Already used</small></div></div>
                <div className="cd-progress cd-progress-large"><i style={{ width: percent + "%" }} /></div>
                <div className="cd-panel-actions">
                  <a href="/#plans" className="cd-secondary-action">View loyalty memberships</a>
                  {account?.hasBillingCustomer && <button type="button" className="cd-text-action" onClick={manageBilling} disabled={billingBusy}>{billingBusy ? "OPENING…" : "Manage / cancel billing ↗"}</button>}
                </div>
                {!account?.hasBillingCustomer && <small className="cd-muted">Billing management will appear here when a billing customer is linked to your account.</small>}
              </article>

              <article className="cd-panel cd-loyalty-panel">
                <div className="cd-panel-top"><span>{tx("dashboard.loyalty")}</span><b>{tx("dashboard.stay")}</b></div>
                {quote ? <>
                  <h3>Your price goes down as you stay.</h3>
                  <p>{quote.streakMonths > 0 ? "You have completed " + quote.streakMonths + " paid month(s). Your next charge is " + money(quote.currentPriceCents, quote.currency) + "." : "Your first loyalty step starts at " + money(quote.currentPriceCents, quote.currency) + " per month."}</p>
                  <div className="cd-loyalty-steps">{(quote.schedule || []).map(step => {
                    const current = quote.nextChargeMonth >= step.fromMonth && (step.toMonth === null || quote.nextChargeMonth <= step.toMonth);
                    return <div className={current ? "cd-loyalty-step current" : "cd-loyalty-step"} key={step.fromMonth}>
                      <span>{step.toMonth ? "MONTHS " + step.fromMonth + "–" + step.toMonth : "MONTH " + step.fromMonth + "+"}</span><b>{money(step.priceCents, quote.currency)}<small>/mo</small></b>
                    </div>;
                  })}</div>
                  <small className="cd-muted">Your loyalty progress is retained while your subscription remains active. Cancelling and subscribing again restarts the schedule at step one.</small>
                </> : quoteLoading ? <div className="cd-quote-loading">Loading your loyalty schedule…</div> : <><h3>Loyalty pricing</h3><p>Your membership's loyalty schedule will appear here when your paid plan is active.</p><a href="/#plans" className="cd-secondary-action">Explore memberships ↗</a></>}
              </article>
            </div>
          </section>

          <section className="cd-section">
            <div className="cd-section-heading"><div><span className="cd-eyebrow">{tx("dashboard.quick")}</span><h2>{tx("dashboard.tools")}</h2></div><span className="cd-muted">{tx("dashboard.choose")}</span></div>
            <div className="cd-tool-grid">
              <a href="/library" className="cd-tool-card cd-tool-library"><span className="cd-tool-number">01</span><div className="cd-tool-icon">▤</div><h3>Video library</h3><p>Discover vertical videos, preview your next drop and download within your allowance.</p><b>OPEN LIBRARY ↗</b></a>
              <a href="/social" className="cd-tool-card cd-tool-social"><span className="cd-tool-number">02</span><div className="cd-tool-icon">↗</div><h3>Social planner</h3><p>Connect your own accounts, prepare captions and manage scheduled publications.</p><b>OPEN PLANNER ↗</b></a>
              <a href="/studio" className="cd-tool-card cd-tool-studio"><span className="cd-tool-number">03</span><div className="cd-tool-icon">✦</div><h3>Creator studio</h3><p>Generate and organise creative drafts before publishing your content.</p><b>OPEN STUDIO ↗</b></a>
              <a href="/creators" className="cd-tool-card"><span className="cd-tool-number">04</span><div className="cd-tool-icon">◎</div><h3>Creator profile</h3><p>Update your public identity, bio, skills and social links.</p><b>EDIT PROFILE ↗</b></a>
              <a href="/messages" className="cd-tool-card"><span className="cd-tool-number">05</span><div className="cd-tool-icon">✉</div><h3>Messages</h3><p>Keep up with your private conversations and account messages.</p><b>OPEN INBOX ↗</b>{unreadMessages > 0 && <i className="cd-tool-badge">{unreadMessages} NEW</i>}</a>
              <a href="/notifications" className="cd-tool-card"><span className="cd-tool-number">06</span><div className="cd-tool-icon">◉</div><h3>Notifications</h3><p>See important updates and activity connected to your account.</p><b>VIEW ALERTS ↗</b>{unreadAlerts > 0 && <i className="cd-tool-badge">{unreadAlerts} NEW</i>}</a>
            </div>
          </section>

          <section className="cd-section cd-activity-grid">
            <article className="cd-panel">
              <div className="cd-section-heading compact"><div><span className="cd-eyebrow">{tx("dashboard.publishing")}</span><h2>{tx("dashboard.coming")}</h2></div><a href="/social">OPEN PLANNER ↗</a></div>
              {upcoming.length ? <div className="cd-list">{upcoming.map(post => <div className="cd-list-row" key={post.id}><span className="cd-list-icon">↗</span><div><b>{post.platform}</b><small>{(post.caption || "Scheduled publication").slice(0, 105)}</small></div><time>{dateTime(post.scheduled_at, locale)}</time></div>)}</div> : <div className="cd-empty"><span>◷</span><b>No scheduled posts</b><p>Your scheduled publications will appear here.</p><a href="/social">Plan your next post ↗</a></div>}
            </article>
            <article className="cd-panel">
              <div className="cd-section-heading compact"><div><span className="cd-eyebrow">{tx("dashboard.creative")}</span><h2>{tx("dashboard.studioProfile")}</h2></div><a href="/studio">OPEN STUDIO ↗</a></div>
              <div className="cd-summary-line"><span>Saved studio drafts</span><b>{drafts.length}</b></div>
              <div className="cd-summary-line"><span>Profile completion</span><b>{profilePercent}%</b></div>
              <div className="cd-progress"><i style={{ width: profilePercent + "%" }} /></div>
              <div className="cd-profile-summary"><div className="cd-avatar large">{(profile?.display_name || firstName).slice(0, 1).toUpperCase()}</div><div><b>{profile?.display_name || "Your creator profile"}</b><small>{profile?.bio || "Add a short bio to introduce yourself to the VICEHUB community."}</small></div></div>
              <a href="/creators" className="cd-secondary-action">Manage your creator profile ↗</a>
            </article>
          </section>

          <section className="cd-section">
            <div className="cd-section-heading"><div><span className="cd-eyebrow">{tx("dashboard.history")}</span><h2>{tx("dashboard.recent")}</h2></div><a href="/library">BROWSE MORE VIDEOS ↗</a></div>
            {history.length ? <div className="cd-history">
              {history.slice(0, 5).map(item => <div className="cd-history-row" key={item.id}>
                <span className="cd-history-icon">⇩</span><div><b>{item.video_title || "Video download"}</b><small>{item.watermark_applied ? "Watermarked file" : "Clean file"} · {item.status || "Processed"}</small></div><time>{dateOnly(item.created_date, locale)}</time>
              </div>)}
            </div> : <div className="cd-empty cd-history-empty"><span>▤</span><b>Your download history is ready</b><p>Every successful download will be recorded here. Your files are downloaded to your device, not stored in this dashboard.</p><a href="/library">Explore the video library ↗</a></div>}
          </section>

          {user?.role === "admin" && <section className="cd-admin-strip"><div><span className="cd-eyebrow">ADMINISTRATOR</span><b>Platform management</b><small>Manage members, videos, subscriptions and platform settings.</small></div><a href="/admin">OPEN ADMIN CONTROL ROOM ↗</a></section>}
        </>}
        <footer className="cd-footer">VICEHUB IS AN INDEPENDENT GTA VI FAN PLATFORM · YOUR ACCOUNT DATA IS PRIVATE · YOUR CHANNELS, YOUR CONTENT.</footer>
      </main>
    </div>
  </div>;
}
