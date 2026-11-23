import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import Carousel from "@/components/Carousel";
import { useAuth } from "@/lib/AuthContext";
import { listPublishedVideos, getVideoPreviewUrl, requestVideoDownload, getNewsFeed, getPublicPlans, getCreatorDirectory, getShopProducts, createStripeCheckoutSession } from "@/lib/server-fns";
import { ladderSchedule, formatMoney } from "@/lib/loyalty";

const TITLE = "VICEHUB — GTA VI fan drops: vertical videos to download & post";
const DESC = "Download ready-to-post GTA VI vertical videos for TikTok, Reels and Shorts, read the latest GTA VI news and grow your fan page. New drops every week.";
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

const FAQ = [
  ["What do I get?", "Every week we publish vertical (9:16) GTA VI videos made for TikTok, Instagram Reels and YouTube Shorts. Subscribers download them in one tap and post them on their own accounts."],
  ["How does the price work?", "Loyalty pays: $49.99/month for your first 3 months, $39.99 for the next 3, $29.99 for the next 3, then $9.99/month for as long as you stay. Prices drop automatically."],
  ["What if I cancel?", "You can cancel any time from your account. If you subscribe again later, your price starts again from the first step."],
  ["Can I post the videos on my own pages?", "Yes — on your own TikTok, Instagram, YouTube or Facebook accounts. Reselling or redistributing the files is not allowed. See the Terms."],
  ["Where do the news come from?", "Every story is labelled (official, confirmed, reported, rumour) and links to its original source. We never present rumours as facts."],
  ["Is this made by Rockstar?", "No. VICEHUB is an independent fan community and is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive."],
];
const fmtDuration = s => { const n = Number(s) || 0; return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : ""; };
const timeAgo = d => { if (!d) return ""; const days = Math.floor((Date.now() - new Date(d)) / 864e5); return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 30 ? `${days}d ago` : new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };

function VideoCard({ video, onOpen, rank }) {
  return <button type="button" role="listitem" className="fh-reel" onClick={() => onOpen(video)} aria-label={`Preview ${video.title}`}>
    {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" loading="lazy" /> : <span className="fh-reel-fallback">VICE<br />HUB</span>}
    {rank ? <span className="fh-rank">{rank}</span> : null}
    <span className="fh-reel-badge">{video.category || "Drop"}</span>
    {fmtDuration(video.duration_seconds) && <span className="fh-reel-time">{fmtDuration(video.duration_seconds)}</span>}
    <span className="fh-reel-play" aria-hidden="true">▶</span>
    <span className="fh-reel-cap"><b>{video.title}</b><small>{video.creator_name || "VICEHUB"} · {timeAgo(video.published_at)}</small></span>
  </button>;
}

function Row({ title, sub, to, children, auto }) {
  return <section className="fh-section">
    <header className="fh-section-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{to && <Link to={to} className="fh-more">See all →</Link>}</header>
    <Carousel label={title} auto={auto}>{children}</Carousel>
  </section>;
}

function HomePage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [news, setNews] = useState([]);
  const [plans, setPlans] = useState([]);
  const [creators, setCreators] = useState([]);
  const [products, setProducts] = useState([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [faq, setFaq] = useState(0);

  useEffect(() => {
    listPublishedVideos().then(r => setVideos(Array.isArray(r) ? r : [])).catch(() => setVideos([])).finally(() => setLoadingVideos(false));
    getNewsFeed({ data: { locale: "en", limit: 8 } }).then(r => setNews(Array.isArray(r) ? r : [])).catch(() => setNews([]));
    getPublicPlans({ data: { currency: "USD" } }).then(r => setPlans(Array.isArray(r) ? r : [])).catch(() => setPlans([]));
    getCreatorDirectory({ data: {} }).then(r => setCreators(Array.isArray(r) ? r : [])).catch(() => setCreators([]));
    getShopProducts().then(r => setProducts(Array.isArray(r) ? r : [])).catch(() => setProducts([]));
  }, []);
  useEffect(() => {
    if (!preview) return;
    const onKey = e => { if (e.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const featured = useMemo(() => videos.find(v => v.is_featured) || videos[0] || null, [videos]);
  const byCat = useMemo(() => cats => videos.filter(v => cats.includes(v.category)), [videos]);
  const shorts = byCat(["Shorts"]), packs = byCat(["Edit packs"]), cinematics = byCat(["Cinematics", "Gameplay", "Characters", "Vehicles", "Locations", "Missions"]);
  const plan = plans[0];
  const steps = ladderSchedule(plan || {});
  const firstPrice = formatMoney(steps[0].priceCents);

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
    setBusy(true);
    try { const r = await createStripeCheckoutSession({ data: { tierCode: plan.tier_code, currency: "USD" } }); window.location.assign(r.url); }
    catch (e) { setNotice(e?.message || "Checkout could not be opened."); setBusy(false); }
  };

  return <SiteFrame eyebrow="WELCOME TO VICE CITY">
    {news.length > 0 && <div className="fh-ticker" aria-label="Latest news"><span className="fh-ticker-tag">LIVE</span><div className="fh-ticker-track">{[...news, ...news].map((n, i) => <Link key={i} to="/news">{n.title}</Link>)}</div></div>}

    <section className="fh-hero">
      <div className="fh-hero-copy">
        <div className="fh-kicker">WELCOME TO VICE CITY</div>
        <h1>Post GTA VI videos.<br /><em>Grow your page.</em></h1>
        <p>The weekly drop for GTA VI fans: ready-to-post vertical videos for TikTok, Instagram Reels and YouTube Shorts, the latest news, and tools to publish like a pro.</p>
        <div className="fh-hero-cta"><button type="button" className="fh-btn solid big" onClick={subscribe} disabled={busy}>{busy ? "Opening checkout…" : `Start at ${firstPrice}/month`}</button><a href="#drops" className="fh-btn ghost big">Watch the drops</a></div>
        <ul className="fh-stats">
          <li><b>{videos.length || "—"}</b><span>videos ready</span></li>
          <li><b>{creators.length || "—"}</b><span>creators</span></li>
          <li><b>9:16</b><span>made for socials</span></li>
          <li><b>Weekly</b><span>new drops</span></li>
        </ul>
        {notice && <div className="fan-notice" role="status">{notice}</div>}
      </div>
      <div className="fh-hero-phone">
        {featured ? <button type="button" className="fh-phone" onClick={() => openPreview(featured)} aria-label={`Preview ${featured.title}`}>
          {featured.thumbnail_url ? <img src={featured.thumbnail_url} alt="" /> : <span className="fh-reel-fallback big">VICE<br />HUB</span>}
          <span className="fh-reel-play big" aria-hidden="true">▶</span>
          <span className="fh-reel-cap"><small>FEATURED DROP</small><b>{featured.title}</b></span>
        </button> : <div className="fh-phone empty"><span className="fh-reel-fallback big">VICE<br />HUB</span><span className="fh-reel-cap"><small>COMING SOON</small><b>First drops land this week</b></span></div>}
      </div>
    </section>

    <div className="fh-platforms">{["TikTok", "Instagram Reels", "YouTube Shorts", "Facebook Reels", "X"].map(p => <span key={p}>{p}</span>)}</div>

    <div id="drops" />
    <Row title="Latest drops" sub="Fresh vertical videos, ready to download and post" to="/library" auto={6000}>
      {loadingVideos ? [0, 1, 2, 3, 4].map(i => <div role="listitem" className="fh-reel skeleton" key={i} />)
        : videos.length ? videos.slice(0, 14).map(v => <VideoCard key={v.id} video={v} onOpen={openPreview} />)
        : <div role="listitem" className="fh-empty-card">New drops land here soon. Subscribe to be first in line.</div>}
    </Row>
    {videos.length > 4 && <Row title="Trending now" sub="The most recent featured picks" to="/library">{videos.slice(0, 10).map((v, i) => <VideoCard key={v.id} video={v} onOpen={openPreview} rank={i + 1} />)}</Row>}
    {shorts.length > 0 && <Row title="Shorts & reels" sub="Quick hits for TikTok and Reels" to="/library">{shorts.map(v => <VideoCard key={v.id} video={v} onOpen={openPreview} />)}</Row>}
    {packs.length > 0 && <Row title="Edit packs" sub="Footage packs for your own edits" to="/library">{packs.map(v => <VideoCard key={v.id} video={v} onOpen={openPreview} />)}</Row>}
    {cinematics.length > 0 && <Row title="Cinematics & gameplay" sub="Characters, vehicles, locations, missions" to="/library">{cinematics.map(v => <VideoCard key={v.id} video={v} onOpen={openPreview} />)}</Row>}

    <section className="fh-section">
      <header className="fh-section-head"><div><h2>How it works</h2><p>Easy as a heist</p></div></header>
      <div className="fh-steps">
        {[["1", "Pick a drop", "Browse the weekly vertical videos and preview them."], ["2", "Download", "One tap, full quality. Members get clean files with no watermark."], ["3", "Post it", "Publish on your own TikTok, Instagram or YouTube and grow your page."], ["4", "Pay less over time", "Your price drops every 3 months, down to $9.99."]].map(([n, t, d]) => <div className="fh-step" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}
      </div>
    </section>

    <section className="fh-section">
      <header className="fh-section-head"><div><h2>Latest GTA VI news</h2><p>Every story labelled and sourced</p></div><Link to="/news" className="fh-more">All news →</Link></header>
      {news.length === 0 ? <div className="fh-empty-card">News is being curated — check back shortly.</div> :
        <div className="fh-news">{news.slice(0, 6).map((n, i) => <Link to="/news" key={n.id} className={"fh-news-card" + (i === 0 ? " lead" : "")}><span className={"source-pill " + n.confidence}>{n.confidence}</span><h3>{n.title}</h3><p>{n.summary}</p><small>{n.source_name}</small></Link>)}</div>}
    </section>

    {creators.length > 0 && <Row title="Creators" sub="Fans building the GTA VI community" to="/creators">
      {creators.slice(0, 12).map(c => <Link role="listitem" to="/creators" className="fh-creator" key={c.id}>{c.avatar_url ? <img src={c.avatar_url} alt="" loading="lazy" /> : <span className="fh-avatar">{(c.display_name || "?").slice(0, 1).toUpperCase()}</span>}<b>{c.display_name}</b><small>{c.location_label || (c.skills || []).slice(0, 2).join(" · ")}</small></Link>)}
    </Row>}

    <section className="fh-section" id="plans">
      <div className="ladder-wrap fh-plan">
        <div className="eyebrow">LOYALTY PRICING</div>
        <h2>The longer you stay, the less you pay</h2>
        <div className="ladder">{steps.map((s, i) => <div className={"ladder-step" + (i === 0 ? " now" : "")} key={s.fromMonth}><small>{s.toMonth ? `Months ${s.fromMonth}–${s.toMonth}` : `Month ${s.fromMonth}+`}</small><b>{formatMoney(s.priceCents)}</b><small>/month</small></div>)}</div>
        <ul className="fh-features">
          <li>{plan?.monthly_download_limit ? `${plan.monthly_download_limit} downloads every month` : "Monthly downloads included"}</li>
          <li>{plan?.clean_downloads === false ? "Watermarked previews" : "Clean files, no watermark"}</li>
          <li>Post on your own TikTok, Instagram & YouTube</li>
          <li>AI caption studio & social planner</li>
          <li>Cancel any time — pricing restarts at step 1 if you return</li>
        </ul>
        <button type="button" className="fh-btn solid big" onClick={subscribe} disabled={busy}>{busy ? "Opening checkout…" : `Start at ${firstPrice}/month`}</button>
      </div>
    </section>

    {products.length > 0 && <Row title="Shop" sub="Creator tools and digital products" to="/shop">
      {products.slice(0, 10).map(p => <Link role="listitem" to="/shop" className="fh-product" key={p.id}>{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="fh-reel-fallback">VICE<br />SUPPLY</span>}<b>{p.title}</b><small>{new Intl.NumberFormat("en", { style: "currency", currency: p.currency || "USD" }).format((p.price_cents || 0) / 100)}</small></Link>)}
    </Row>}

    <section className="fh-section fh-faq">
      <header className="fh-section-head"><div><h2>Questions</h2></div></header>
      {FAQ.map(([q, a], i) => <div className={"fh-faq-item" + (faq === i ? " open" : "")} key={q}><button type="button" aria-expanded={faq === i} onClick={() => setFaq(faq === i ? -1 : i)}>{q}<span>{faq === i ? "–" : "+"}</span></button>{faq === i && <p>{a}</p>}</div>)}
    </section>

    <section className="fh-final"><h2>Ready for day one?</h2><p>Join the fans posting GTA VI content every week.</p><button type="button" className="fh-btn solid big" onClick={subscribe} disabled={busy}>Claim your spot</button></section>
    <p className="fan-disclaimer">VICEHUB is an independent fan community. Not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive.</p>

    {preview && <div className="fh-modal" role="dialog" aria-modal="true" aria-label={preview.video.title} onClick={() => setPreview(null)}>
      <div className="fh-modal-card" onClick={e => e.stopPropagation()}>
        <button type="button" className="fh-modal-x" aria-label="Close" onClick={() => setPreview(null)}>×</button>
        <div className="fh-modal-video">{preview.url ? <video src={preview.url} controls autoPlay playsInline /> : <p>{preview.msg}</p>}</div>
        <div className="fh-modal-info"><span className="source-pill">{preview.video.category || "Drop"}</span><h3>{preview.video.title}</h3><p>{preview.video.description}</p>
          <div className="fh-tags">{(preview.video.tags || []).slice(0, 6).map(t => <span key={t}>#{t}</span>)}</div>
          <button type="button" className="fh-btn solid big" onClick={() => download(preview.video)}>{isAuthenticated ? "Download" : "Sign in to download"}</button>
          {notice && <div className="fan-notice">{notice}</div>}</div>
      </div>
    </div>}
  </SiteFrame>;
}
