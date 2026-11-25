import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMyAccount, refreshMySubscription, listPublishedVideosPage, getNewsFeed, createStripePortalSession, getMyNotifications, markNotificationRead, getFreeSamplePack } from "@/lib/server-fns";
import { getMyAffiliateDashboard, startAffiliatePayoutOnboarding, requestAffiliatePayout } from "@/lib/affiliate-fns";
import { downloadCleanVideo } from "@/lib/video-download";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/lib/AuthContext";
import "@/styles/client-dashboard.css";
import "@/styles/vicehub-growth.css";
import "@/styles/vicehub-2026-redesign.css";

export const Route = createFileRoute("/_authed/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Member Dashboard — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: DashboardPage,
});

const localeMap = { en: "en-GB", fr: "fr-FR", es: "es-ES", pt: "pt-PT", it: "it-IT", de: "de-DE" };
const dateLabel = (value, locale) => value ? new Date(value).toLocaleDateString(localeMap[locale] || "en-GB", { day: "numeric", month: "short" }) : "LATEST";
const videoThumbnail = video => video?.thumbnail_url || video?.thumbnailUrl || video?.poster_url || video?.posterUrl || video?.cover_image_url || video?.coverImageUrl || video?.image_url || video?.preview_image_url || video?.previewImageUrl || "https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=1920";

function DashboardPage() {
  const { logout } = useAuth();
  const locale = useLocale();
  const [account, setAccount] = useState(null);
  const [videos, setVideos] = useState([]);
  const [news, setNews] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyVideo, setBusyVideo] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [referral, setReferral] = useState(null);
  const [samplePack, setSamplePack] = useState(null);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralNotice, setReferralNotice] = useState("");
  const [payoutCurrency, setPayoutCurrency] = useState("GBP");
  const [payoutCountry, setPayoutCountry] = useState("GB");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      await refreshMySubscription().catch(() => null);
      const [accountResult, videoResult, newsResult, notificationResult, sampleResult] = await Promise.allSettled([
        getMyAccount(),
        listPublishedVideosPage({ data: { offset: 0, limit: 6 } }),
        (async () => { const localized = await getNewsFeed({ data: { locale, limit: 4 } }); return Array.isArray(localized) && localized.length ? localized : locale === "en" ? [] : getNewsFeed({ data: { locale: "en", limit: 4 } }); })(),
        getMyNotifications(),
        getFreeSamplePack(),
      ]);
      if (accountResult.status === "fulfilled") setAccount(accountResult.value);
      else setError(accountResult.reason?.message || "Account information could not be loaded.");
      if (videoResult.status === "fulfilled") setVideos(videoResult.value?.videos || []);
      else setVideos([]);
      if (newsResult.status === "fulfilled") setNews(Array.isArray(newsResult.value) ? newsResult.value : []);
      else setNews([]);
      if (notificationResult.status === "fulfilled") setNotifications(Array.isArray(notificationResult.value) ? notificationResult.value.slice(0, 6) : []);
      else setNotifications([]);
      if (sampleResult.status === "fulfilled") setSamplePack(sampleResult.value);
      else setSamplePack(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [locale]);
  useEffect(() => { getMyAffiliateDashboard().then(setReferral).catch(err => setReferralNotice(err?.message || "Affiliate dashboard is unavailable.")); }, []);

  const firstName = "CREATOR";
  const used = Number(account?.downloadsUsed || 0);
  const limit = Number(account?.downloadsLimit || 0);
  const remaining = Number(account?.downloadsRemaining || 0);
  const percent = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
  const planName = account?.planName || (account?.tier === "free" ? "Free member" : "Membership");
  const newest = useMemo(() => [...videos].sort((a,b) => new Date(b.published_at || 0) - new Date(a.published_at || 0)), [videos]);

  const openNotification = async item => {
    if (!item.read_at) { try { await markNotificationRead({ data: { notificationId: item.id } }); setNotifications(current => current.map(n => n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)); } catch {} }
    if (item.target_url) window.location.assign(item.target_url);
  };

  const manageBilling = async () => {
    setBillingBusy(true);
    setError("");
    try { const result = await createStripePortalSession(); window.location.assign(result.url); }
    catch (err) { setError(err?.message || "Billing portal could not be opened."); setBillingBusy(false); }
  };

  const download = async video => {
    setBusyVideo(video.id);
    setError("");
    try {
      await downloadCleanVideo({
        videoId: video.id,
        title: video.title,
        onProgress: () => {},
      });
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
        <div className="member-hero-art vh-member-image"><img src="https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=1920" alt="Jason and Lucia in Leonida — official GTA VI artwork" /><span>VICE CITY</span><b>VI</b><small>THE MEMBER DISTRICT</small></div>
      </section>

      {error && <div className="member-alert" role="alert">{error}</div>}

      <section className="member-notification-hq">
        <div className="member-notification-heading"><div><span className="member-section-kicker">VICEHUB / LIVE DISPATCH</span><h2>MISSION <em>UPDATES.</em></h2><p>Your account activity, messages and important alerts.</p></div><span className="member-alert-count">{notifications.filter(n => !n.read_at).length} NEW</span></div>
        <div className="member-notification-layout"><div className="member-notification-list">{notifications.length ? notifications.map(item => <button type="button" className={"member-notification-item" + (!item.read_at ? " unread" : "")} key={item.id} onClick={() => openNotification(item)}><span className="member-notification-glyph" aria-hidden="true">✦</span><span className="member-notification-copy"><b>{item.title}</b><small>{item.body}</small><time>{dateLabel(item.created_date, locale)}</time></span><i>↗</i></button>) : <div className="member-notification-empty">NO NEW DISPATCHES. IMPORTANT ACCOUNT UPDATES WILL APPEAR HERE.</div>}</div><Link to="/messages" className="member-message-shortcut"><span className="member-message-glyph">✉</span><b>PRIVATE MESSAGES</b><small>Open your creator inbox</small><i>OPEN INBOX ↗</i></Link></div>
      </section>
      <section className="member-free-sample">
        <div className="member-free-sample-head"><div><span className="member-section-kicker">VICEHUB / FIRST DROP</span><h2>YOUR 3 FREE <em>VIDEO TRIAL.</em></h2><p>Every new member receives the same three selected videos. Each can be downloaded once, with the VICEHUB watermark. The pack is fixed for every account and does not refresh monthly.</p></div><span className="member-free-sample-count">{samplePack?.downloadsRemaining ?? 3}<small>/ 3 LEFT</small></span></div>
        {samplePack?.packReady ? <div className="member-free-sample-grid">{samplePack.videos.map(video=><article className="member-free-sample-item" key={video.id}><div className="member-free-sample-image"><img src={videoThumbnail(video)} alt={video.title ? `${video.title} thumbnail` : "GTA VI video thumbnail"} loading="lazy" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src="https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=1920";}}/></div><div><small>{video.category} · {(video.language||"en").toUpperCase()}</small><b>{video.title}</b><p>{video.description}</p><button type="button" disabled={busyVideo===video.id||(samplePack.downloadedVideoIds||[]).includes(video.id)} onClick={()=>download(video)}>{busyVideo===video.id?"PREPARING…":(samplePack.downloadedVideoIds||[]).includes(video.id)?"ALREADY DOWNLOADED":"DOWNLOAD FREE VIDEO ↓"}</button></div></article>)}</div> : <div className="member-free-sample-empty">The free sample pack will appear here as soon as the three rights-cleared videos have been selected and published. The pack is identical for every new member.</div>}
      </section>
      <section className="member-referral-card member-affiliate-card">
        <div className="member-referral-head"><div><span className="member-section-kicker">VICEHUB / AFFILIATE REWARDS</span><h2>INVITE CREATORS. <em>EARN CASH.</em></h2><p>Give a new member 5% off their first payment. Earn 20% of that first eligible payment after a 30-day validation period. No commission on renewals.</p></div><span className="member-referral-mark">20%</span></div>
        {referral ? <>
          <div className="member-referral-grid">
            <div className="member-referral-link"><small>YOUR PERSONAL REFERRAL LINK</small><code>{typeof window !== "undefined" ? window.location.origin : "https://gta6-creator-hub-c26cc578.base44.app"}/?ref={referral.code}</code><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.origin+"/?ref="+referral.code);setReferralNotice("Referral link copied.");}catch{setReferralNotice("Copy failed. Select and copy the link manually.");}}}>COPY LINK ↗</button><p>Affiliate disclosure: you may receive a cash commission if someone subscribes through this link. <Link to="/referral-terms">Programme terms ↗</Link></p></div>
            <div className="member-referral-stat"><small>PAID REFERRALS</small><b>{referral.referralCount}</b></div>
          </div>
          <div className="member-affiliate-balances">{["GBP","EUR","USD"].map(cur=>{const b=referral.balances?.[cur]||{};return <article key={cur}><b>{cur}</b><div><small>Pending validation</small><strong>{new Intl.NumberFormat("en-GB",{style:"currency",currency:cur}).format((b.pendingCents||0)/100)}</strong></div><div><small>Available to withdraw</small><strong>{new Intl.NumberFormat("en-GB",{style:"currency",currency:cur}).format((b.availableCents||0)/100)}</strong></div><div><small>Reserved for payout</small><strong>{new Intl.NumberFormat("en-GB",{style:"currency",currency:cur}).format((b.reservedCents||0)/100)}</strong></div><div><small>Paid out</small><strong>{new Intl.NumberFormat("en-GB",{style:"currency",currency:cur}).format((b.paidCents||0)/100)}</strong></div></article>})}</div>
          <div className="member-affiliate-payout">
            <div><span className="member-section-kicker">CASH PAYOUTS / STRIPE CONNECT</span><h3>YOUR PAYOUT ACCOUNT</h3><p>{referral.connect?.payoutsEnabled ? "Your Stripe payout account is enabled." : "Connect a bank account securely through Stripe. VICEHUB does not store your bank details."}</p><small>Connection status: {String(referral.connect?.status||"not_started").replaceAll("_"," ")}{referral.connect?.defaultCurrency ? " · Settlement currency: "+referral.connect.defaultCurrency : ""}</small></div>
            <div className="member-affiliate-controls">
              {!referral.connect?.payoutsEnabled && <><label>Country of your bank account<select value={payoutCountry} onChange={e=>setPayoutCountry(e.target.value)}><option value="GB">United Kingdom</option><option value="FR">France</option><option value="IE">Ireland</option><option value="DE">Germany</option><option value="ES">Spain</option><option value="IT">Italy</option><option value="NL">Netherlands</option><option value="BE">Belgium</option><option value="LU">Luxembourg</option><option value="US">United States</option><option value="CA">Canada</option></select></label><button type="button" disabled={referralBusy} onClick={async()=>{setReferralBusy(true);setReferralNotice("");try{const x=await startAffiliatePayoutOnboarding({data:{country:payoutCountry}});window.location.assign(x.url);}catch(e){setReferralNotice(e?.message||"Stripe onboarding could not be started.");setReferralBusy(false);}}}>{referralBusy?"OPENING STRIPE…":"CONNECT PAYOUT ACCOUNT ↗"}</button></>}
              <label>Payout currency<select value={payoutCurrency} onChange={e=>setPayoutCurrency(e.target.value)}><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="USD">USD</option></select></label>
              <button type="button" disabled={referralBusy||!referral.connect?.payoutsEnabled||(referral.balances?.[payoutCurrency]?.availableCents||0)<(referral.minimumPayoutCents?.[payoutCurrency]||2500)} onClick={async()=>{setReferralBusy(true);setReferralNotice("");try{await requestAffiliatePayout({data:{currency:payoutCurrency}});setReferral(await getMyAffiliateDashboard());setReferralNotice("Payout request submitted. It is now awaiting VICEHUB review.");}catch(e){setReferralNotice(e?.message||"Payout request could not be submitted.");}finally{setReferralBusy(false);}}}>REQUEST PAYOUT — {payoutCurrency}</button>
              <small>Minimum payout: {new Intl.NumberFormat("en-GB",{style:"currency",currency:payoutCurrency}).format((referral.minimumPayoutCents?.[payoutCurrency]||2500)/100)}. Requests must use the connected account settlement currency and are reviewed by VICEHUB.</small>
            </div>
          </div>
          <div className="member-affiliate-history"><h3>PAYOUT HISTORY</h3>{(referral.requests||[]).length ? referral.requests.map(p=><article key={p.id}><span>{new Date(p.created_date).toLocaleDateString("en-GB")}</span><b>{new Intl.NumberFormat("en-GB",{style:"currency",currency:p.currency}).format(p.amount_cents/100)}</b><small>{p.status.replaceAll("_"," ")}</small></article>) : <p>No payout requests yet.</p>}</div>
        </> : <p className="member-referral-loading">Preparing your affiliate account…</p>}
        {referralNotice && <p className="member-referral-notice" role="status">{referralNotice}</p>}
        <p className="member-affiliate-legal-note">Commissions are calculated on the first eligible subscription payment excluding separately stated tax, held for 30 days and paid only after approval. Stripe identity checks and payout timing apply. Tax reporting remains your responsibility.</p>
      </section>
      <section className="member-social-connect">
        <div className="member-social-head"><div><span className="member-section-kicker">VICEHUB / ACCOUNT LINKS</span><h2>CONNECT YOUR <em>CHANNELS.</em></h2><p>Securely authorise your own social accounts. VICEHUB never asks for your passwords.</p></div><Link to="/social">OPEN SOCIAL CONTROL ROOM ↗</Link></div>
        <div className="member-social-grid">{[["Instagram","IG"],["TikTok","TK"],["YouTube","YT"],["Facebook","f"],["X","X"],["LinkedIn","in"]].map(([name,mark]) => <Link key={name} to={"/social?connect=" + encodeURIComponent(name)} className="member-social-connect-card"><span>{mark}</span><b>{name}</b><small>CONNECT ACCOUNT</small><i>↗</i></Link>)}</div>
      </section>
      <section className="member-overview">
        <article className="member-plan-card">
          <div className="member-card-top"><span>YOUR MEMBERSHIP</span><b className={account?.subscriptionStatus === "active" ? "member-status active" : "member-status"}>{String(account?.subscriptionStatus || "ACCOUNT").toUpperCase()}</b></div>
          <h2>{planName}</h2>
          <p>{account?.tier === "free" ? "Your free access includes a limited monthly download allowance." : "Your downloads are included with your current membership."}</p>
          <div className="member-download-numbers"><strong>{remaining}<small>LEFT</small></strong><span><b>{used}</b> used of {limit || "—"} this month</span></div>
          <div className="member-progress"><i style={{width: percent + "%"}}/></div>
          <div className="member-plan-actions"><Link to="/subscription">MY SUBSCRIPTION ↗</Link><Link to="/library">DOWNLOAD VIDEOS ↗</Link>{account?.hasBillingCustomer ? <button type="button" onClick={manageBilling} disabled={billingBusy}>{billingBusy ? "OPENING BILLING…" : "MANAGE / CANCEL PLAN ↗"}</button> : <Link to="/#plans">VIEW MEMBERSHIPS ↗</Link>}</div>
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
            <Link to="/library" className="member-video-image"><img src={videoThumbnail(video)} alt={video.title ? `${video.title} thumbnail` : "GTA VI video thumbnail"} loading="lazy" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src="https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=1920";}}/><i>{String(index+1).padStart(2,"0")}</i><small>{video.category || "GTA VI VIDEO"}</small></Link>
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
