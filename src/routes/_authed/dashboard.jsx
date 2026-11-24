import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMyAccount, refreshMySubscription, listPublishedVideosPage, requestVideoDownload, getNewsFeed, createStripePortalSession } from "@/lib/server-fns";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/lib/AuthContext";
import "@/styles/client-dashboard.css";

export const Route = createFileRoute("/_authed/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Member Dashboard — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: DashboardPage,
});

const localeMap = { en: "en-GB", fr: "fr-FR", es: "es-ES", pt: "pt-PT", it: "it-IT", de: "de-DE" };
const dateLabel = (value, locale) => value ? new Date(value).toLocaleDateString(localeMap[locale] || "en-GB", { day: "numeric", month: "short" }) : "LATEST";

function DashboardPage() {
  const { logout } = useAuth();
  const locale = useLocale();
  const [account, setAccount] = useState(null);
  const [videos, setVideos] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyVideo, setBusyVideo] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      await refreshMySubscription().catch(() => null);
      const [accountResult, videoResult, newsResult] = await Promise.allSettled([
        getMyAccount(),
        listPublishedVideosPage({ data: { offset: 0, limit: 6 } }),
        (async () => { const localized = await getNewsFeed({ data: { locale, limit: 4 } }); return Array.isArray(localized) && localized.length ? localized : locale === "en" ? [] : getNewsFeed({ data: { locale: "en", limit: 4 } }); })(),
      ]);
      if (accountResult.status === "fulfilled") setAccount(accountResult.value);
      else setError(accountResult.reason?.message || "Account information could not be loaded.");
      if (videoResult.status === "fulfilled") setVideos(videoResult.value?.videos || []);
      else setVideos([]);
      if (newsResult.status === "fulfilled") setNews(Array.isArray(newsResult.value) ? newsResult.value : []);
      else setNews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [locale]);

  const firstName = "CREATOR";
  const used = Number(account?.downloadsUsed || 0);
  const limit = Number(account?.downloadsLimit || 0);
  const remaining = Number(account?.downloadsRemaining || 0);
  const percent = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
  const planName = account?.planName || (account?.tier === "free" ? "Free member" : "Membership");
  const newest = useMemo(() => [...videos].sort((a,b) => new Date(b.published_at || 0) - new Date(a.published_at || 0)), [videos]);

  const manageBilling = async () => {
    setBillingBusy(true);
    setError("");
    try { const result = await createStripePortalSession(); window.location.assign(result.url); }
    catch (err) { setError(err?.message || "Billing portal could not be opened."); setBillingBusy(false); }
  };

  const download = async video => {
    setBusyVideo(video.id);
    setNotice("");
    setError("");
    try {
      const result = await requestVideoDownload({ data: { videoId: video.id } });
      window.location.assign(result.downloadUrl);
    } catch (err) {
      setError(err?.message || "This download could not be authorised.");
    } finally {
      setBusyVideo("");
    }
  };

  return <SiteFrame eyebrow="VICEHUB / MEMBER HQ" workspace activeKey="overview">
    <div className="member-home">
      <section className="member-hero">
        <div className="member-hero-copy">
          <span className="member-kicker"><i/> YOUR VICEHUB MEMBERSHIP</span>
          <p className="member-date">{new Intl.DateTimeFormat(localeMap[locale] || "en-GB", { weekday:"long", day:"numeric", month:"long" }).format(new Date()).toUpperCase()} · LEONIDA, FL</p>
          <h1>WELCOME BACK,<br/><em>{firstName.toUpperCase()}.</em></h1>
          <p className="member-hero-intro">Your next GTA VI drop is waiting. Find fresh videos, download your favourites and catch up on what is happening in Leonida.</p>
          <div className="member-hero-actions"><Link to="/library">EXPLORE VIDEO LIBRARY <b>↗</b></Link><Link to="/news">LATEST GTA VI NEWS <b>↗</b></Link></div>
        </div>
        <div className="member-hero-art"><span>VICE CITY</span><b>VI</b><small>THE MEMBER DISTRICT</small></div>
      </section>

      {error && <div className="member-alert" role="alert">{error}</div>}

      <section className="member-overview">
        <article className="member-plan-card">
          <div className="member-card-top"><span>YOUR MEMBERSHIP</span><b className={account?.subscriptionStatus === "active" ? "member-status active" : "member-status"}>{String(account?.subscriptionStatus || "ACCOUNT").toUpperCase()}</b></div>
          <h2>{planName}</h2>
          <p>{account?.tier === "free" ? "Your free access includes a limited monthly download allowance." : "Your downloads are included with your current membership."}</p>
          <div className="member-download-numbers"><strong>{remaining}<small>LEFT</small></strong><span><b>{used}</b> used of {limit || "—"} this month</span></div>
          <div className="member-progress"><i style={{width: percent + "%"}}/></div>
          <div className="member-plan-actions"><Link to="/library">DOWNLOAD VIDEOS ↗</Link>{account?.hasBillingCustomer ? <button type="button" onClick={manageBilling} disabled={billingBusy}>{billingBusy ? "OPENING BILLING…" : "MANAGE / CANCEL PLAN ↗"}</button> : <Link to="/#plans">VIEW MEMBERSHIPS ↗</Link>}</div>
        </article>
        <div className="member-shortcuts">
          <Link to="/library"><span>01</span><b>VIDEO LIBRARY</b><small>Browse and download new drops</small><i>↗</i></Link>
          <Link to="/news"><span>02</span><b>GTA VI NEWS</b><small>Fresh updates from Leonida</small><i>↗</i></Link>
          <Link to="/creators"><span>03</span><b>CREATOR PROFILE</b><small>Manage your public profile</small><i>↗</i></Link>
        </div>
      </section>

      <section className="member-section">
        <header className="member-section-head"><div><span className="member-section-kicker">THE DROP ZONE / JUST RELEASED</span><h2>NEW VIDEOS <em>TO DOWNLOAD.</em></h2><p>Only published, rights-verified videos appear here.</p></div><Link to="/library">VIEW ALL VIDEOS ↗</Link></header>
        {loading && !videos.length ? <div className="member-empty">LOADING THE LATEST DROPS…</div> : newest.length ? <div className="member-video-grid">
          {newest.slice(0,6).map((video,index)=><article className="member-video-card" key={video.id}>
            <Link to="/library" className="member-video-image">{video.thumbnail_url ? <img src={video.thumbnail_url} alt="" loading="lazy"/> : <span>VICEHUB<br/>DROP</span>}<i>{String(index+1).padStart(2,"0")}</i><small>{video.category || "GTA VI VIDEO"}</small></Link>
            <div className="member-video-info"><h3>{video.title}</h3><p>{video.creator_name || "VICEHUB"} · {dateLabel(video.published_at,locale)}</p><button type="button" onClick={()=>download(video)} disabled={busyVideo===video.id}>{busyVideo===video.id ? "PREPARING…" : "↓ DOWNLOAD"}</button></div>
          </article>)}
        </div> : <div className="member-empty"><b>NO NEW VIDEO DROPS YET</b><p>When our team publishes a verified video, it will appear here automatically.</p><Link to="/library">OPEN THE VIDEO LIBRARY ↗</Link></div>}
      </section>

      <section className="member-section member-news-section">
        <header className="member-section-head"><div><span className="member-section-kicker">THE LEONIDA DISPATCH</span><h2>WHAT'S <em>HAPPENING.</em></h2><p>Recent GTA VI stories, with their sources clearly identified.</p></div><Link to="/news">ALL NEWS ↗</Link></header>
        {news.length ? <div className="member-news-grid">{news.slice(0,3).map((item,index)=><Link to="/news" className="member-news-card" key={item.id || index}><span>{String(item.confidence || item.source_type || "NEWS").toUpperCase()}</span><h3>{item.title}</h3><p>{item.summary}</p><small>{item.source_name || "VICEHUB NEWS"} · {dateLabel(item.published_at,locale)}</small><b>READ STORY ↗</b></Link>)}</div> : <div className="member-empty compact">{loading ? "LOADING THE LATEST NEWS…" : "NEW GTA VI NEWS WILL APPEAR HERE."}</div>}
      </section>
      <footer className="member-footer"><span>VICEHUB / MEMBER HQ</span><span>INDEPENDENT FAN PLATFORM · NOT AFFILIATED WITH ROCKSTAR GAMES</span><button type="button" onClick={logout}>SIGN OUT ↗</button></footer>
    </div>
  </SiteFrame>;
}
