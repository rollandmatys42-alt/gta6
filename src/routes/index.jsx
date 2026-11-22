import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { useAuth } from "@/lib/AuthContext";
import { listPublishedVideos, getVideoPreviewUrl, requestVideoDownload, getNewsFeed, getPublicPlans, createStripeCheckoutSession } from "@/lib/server-fns";
import { ladderSchedule, formatMoney } from "@/lib/loyalty";

const TITLE = "VICEHUB — GTA VI Fan Drops: vertical videos to download & post";
const DESC = "Download ready-to-post GTA VI vertical videos (TikTok, Reels, Shorts) and publish them on your own channels. New drops every week.";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE }, { name: "description", content: DESC }, { name: "theme-color", content: "#0a0612" },
      { property: "og:title", content: TITLE }, { property: "og:description", content: DESC }, { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }, { rel: "icon", href: "/icons/vicehub.svg", type: "image/svg+xml" }],
  }),
  component: HomePage,
});

const FILTERS = ["All", "Shorts", "Edit packs", "Trailers", "Memes"];
const FAQ = [
  ["What do I get?", "Every week we publish vertical (9:16) GTA VI videos made for TikTok, Instagram Reels and YouTube Shorts. Subscribers download them in one tap and post them on their own accounts."],
  ["How does the price work?", "Loyalty pays: $49.99/month for your first 3 months, $39.99 for the next 3, $29.99 for the next 3, then $9.99/month for as long as you stay. Prices drop automatically."],
  ["What if I cancel?", "You can cancel any time. If you subscribe again later, your price starts again from the first step."],
  ["Can I post the videos everywhere?", "Yes, on your own TikTok, Instagram, YouTube or Facebook accounts. Redistribution or resale of the files is not allowed. See the Terms."],
  ["Is this made by Rockstar?", "No. VICEHUB is an independent fan community and is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive."],
];

function HomePage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [videos, setVideos] = useState([]);
  const [news, setNews] = useState([]);
  const [plans, setPlans] = useState([]);
  const [filter, setFilter] = useState("All");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    listPublishedVideos().then(r => setVideos(Array.isArray(r) ? r : [])).catch(() => setVideos([]));
    getNewsFeed({ data: { locale: "en", limit: 3 } }).then(r => setNews(Array.isArray(r) ? r : [])).catch(() => setNews([]));
    getPublicPlans({ data: { currency: "USD" } }).then(r => setPlans(Array.isArray(r) ? r : [])).catch(() => setPlans([]));
  }, []);

  const shown = useMemo(() => videos.filter(v => filter === "All" || v.category === filter), [videos, filter]);
  const plan = plans[0];
  const steps = ladderSchedule(plan || {});

  const openPreview = async video => {
    setPreview({ video, url: "", msg: "Loading preview…" });
    try { const r = await getVideoPreviewUrl({ data: { videoId: video.id } }); setPreview({ video, url: r.previewUrl, msg: "" }); }
    catch (e) { setPreview({ video, url: "", msg: e?.message || "Preview unavailable." }); }
  };
  const download = async video => {
    if (!isAuthenticated) { navigateToLogin(); return; }
    setNotice("Checking your plan…");
    try { const r = await requestVideoDownload({ data: { videoId: video.id } }); window.location.assign(r.downloadUrl); setNotice(`Download started — ${r.downloadsRemaining} left this month.`); }
    catch (e) { setNotice(e?.message || "Download unavailable."); }
  };
  const subscribe = async () => {
    if (!isAuthenticated) { navigateToLogin(); return; }
    if (!plan) { setNotice("Membership opens soon."); return; }
    setBusy("checkout");
    try { const r = await createStripeCheckoutSession({ data: { tierCode: plan.tier_code, currency: "USD" } }); window.location.assign(r.url); }
    catch (e) { setNotice(e?.message || "Checkout could not be opened."); setBusy(""); }
  };

  return <SiteFrame eyebrow="WELCOME TO VICE CITY">
    <section className="fan-hero">
      <div className="kicker">WELCOME TO VICE CITY</div>
      <h1>GTA VI</h1>
      <p>For the real fans. Download fresh vertical videos every week and post them on your own TikTok, Reels and Shorts.</p>
      <button className="fan-btn" onClick={subscribe} disabled={busy === "checkout"}>Claim your spot</button>{" "}
      <a className="fan-btn ghost" href="#drops">Browse drops</a>
      <div className="fan-chips">{["Instant download", "9:16 ready to post", "New drops weekly", "Secure checkout"].map(x => <span className="fan-chip" key={x}>{x}</span>)}</div>
    </section>
    {notice && <div className="fan-notice" role="status">{notice}</div>}

    <section className="fan-section" id="drops">
      <header><h2>Latest drops</h2><span>Vertical · TikTok · Reels · Shorts</span></header>
      <div className="fan-chips" style={{ justifyContent: "flex-start" }}>{FILTERS.map(f => <button key={f} className={"fan-chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>{f}</button>)}</div>
      {shown.length === 0 ? <p className="fan-card">New drops land here soon. Subscribe to be first in line.</p>
        : <div className="reel-strip">{shown.map(v => <button key={v.id} className="reel" onClick={() => openPreview(v)}>
          {v.thumbnail_url ? <img src={v.thumbnail_url} alt={v.title} loading="lazy" /> : null}
          <span className="badge">{v.category || "Drop"}</span><span className="cap">{v.title}</span></button>)}</div>}
    </section>

    {preview && <div className="fan-card" style={{ maxWidth: 420, margin: "0 auto 40px" }}>
      <h3>{preview.video.title}</h3>
      {preview.url ? <video src={preview.url} controls playsInline style={{ width: "100%", borderRadius: 14 }} /> : <p>{preview.msg}</p>}
      <p>{preview.video.description}</p>
      <button className="fan-btn" onClick={() => download(preview.video)}>Download</button>{" "}
      <button className="fan-btn ghost" onClick={() => setPreview(null)}>Close</button>
    </div>}

    <section className="fan-section">
      <header><h2>Easy as a heist</h2><span>Three steps</span></header>
      <div className="fan-grid steps">
        <div className="fan-card"><h3>Pick a drop</h3><p>Browse the weekly vertical videos.</p></div>
        <div className="fan-card"><h3>Download</h3><p>One tap, full quality, no watermark for members.</p></div>
        <div className="fan-card"><h3>Post it</h3><p>Publish on your own TikTok, Instagram or YouTube and grow your page.</p></div>
      </div>
    </section>

    <section className="fan-section" id="plans">
      <div className="ladder-wrap">
        <div className="eyebrow">LOYALTY PRICING</div>
        <h2 style={{ fontSize: 48, margin: 0 }}>The longer you stay, the less you pay</h2>
        <div className="ladder">{steps.map((s, i) => <div className={"ladder-step" + (i === 0 ? " now" : "")} key={s.fromMonth}>
          <small>{s.toMonth ? `Months ${s.fromMonth}–${s.toMonth}` : `Month ${s.fromMonth}+`}</small><b>{formatMoney(s.priceCents)}</b><small>/month</small></div>)}</div>
        <p style={{ color: "var(--vc-muted)" }}>Cancel any time. If you come back later, pricing restarts at the first step.</p>
        <button className="fan-btn" onClick={subscribe} disabled={busy === "checkout"}>{busy ? "Opening checkout…" : `Start at ${formatMoney(steps[0].priceCents)}/month`}</button>
      </div>
    </section>

    {news.length > 0 && <section className="fan-section">
      <header><h2>GTA VI news</h2><Link to="/news">All news →</Link></header>
      <div className="fan-grid">{news.map(n => <article className="fan-card" key={n.id}><h3>{n.title}</h3><p>{n.summary}</p></article>)}</div>
    </section>}

    <section className="fan-section fan-faq"><header><h2>FAQ</h2></header>{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
    <p className="fan-disclaimer">VICEHUB is an independent fan community. Not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive.</p>
  </SiteFrame>;
}
