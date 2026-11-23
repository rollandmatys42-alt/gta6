import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import Carousel from "@/components/Carousel";
import { useAuth } from "@/lib/AuthContext";
import { listPublishedVideos, getVideoPreviewUrl, requestVideoDownload, getNewsFeed, getPublicPlans, getCreatorDirectory, getShopProducts, createStripeCheckoutSession, getPublicCommunityReviews, submitCommunityReview } from "@/lib/server-fns";
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
  ["How does the price work?", "Each membership tier and currency has its own loyalty price schedule. Your exact monthly price and upcoming reductions are shown in your account and before checkout. Prices reduce while you remain subscribed."],
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
  const [reviews, setReviews] = useState([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  useEffect(() => {
    listPublishedVideos().then(r => setVideos(Array.isArray(r) ? r : [])).catch(() => setVideos([])).finally(() => setLoadingVideos(false));
    getNewsFeed({ data: { locale: "en", limit: 8 } }).then(r => setNews(Array.isArray(r) ? r : [])).catch(() => setNews([]));
    getPublicPlans({ data: { currency: "USD" } }).then(r => setPlans(Array.isArray(r) ? r : [])).catch(() => setPlans([]));
    getCreatorDirectory({ data: {} }).then(r => setCreators(Array.isArray(r) ? r : [])).catch(() => setCreators([]));
    getShopProducts().then(r => setProducts(Array.isArray(r) ? r : [])).catch(() => setProducts([]));
    getPublicCommunityReviews().then(r => setReviews(Array.isArray(r) ? r : [])).catch(() => setReviews([]));
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
  const gallery = [
    { title: "Jason & Lucia", label: "THE DUO", src: "https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=3840" },
    { title: "Vice City", label: "THE CITY", src: "https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=3840" },
    { title: "Lucia Caminos", label: "CHARACTERS", src: "https://www.rockstargames.com/VI/_next/static/media/Lucia_Caminos_12.0saq9ns-~xj03.jpg?akim=1&imdensity=1&imwidth=3840" },
    { title: "Neon nights", label: "NIGHTLIFE", src: "https://www.rockstargames.com/VI/_next/static/media/VINTAGE_VICE_CITY_PACK_01.05zaof7o1uz.3.jpg?akim=1&imdensity=1&imwidth=3840" },
    { title: "Leonida supercars", label: "VEHICLES", src: "https://www.rockstargames.com/VI/_next/static/media/ULTIMATE_EDITION_GROTTI_CHEETAH_01.0a.wy3s_ogjey.jpg?akim=1&imdensity=1&imwidth=3840" },
    { title: "Leonida stories", label: "OFFICIAL ART", src: "https://www.rockstargames.com/VI/_next/static/media/ULTIMATE_EDITION_02.0q-6.nrtf~jj0.jpg?akim=1&imdensity=1&imwidth=3840" },
  ];
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
        <p>Your independent home for GTA VI culture: cinematic video drops, official media, verified news and a community built for creators.</p>
        <div className="fh-hero-cta"><button type="button" className="fh-btn solid big" onClick={subscribe} disabled={busy}>{busy ? "Opening checkout…" : `Start at ${firstPrice}/month`}</button><a href="#drops" className="fh-btn ghost big">Watch the drops</a></div>
        <ul className="fh-stats">
          <li><b>{videos.length}</b><span>videos ready</span></li>
          <li><b>{creators.length}</b><span>creators</span></li>
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
        </button> : <div className="fh-phone empty"><img src="https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=3840" alt="Jason and Lucia in Vice City — official GTA VI artwork"/><span className="fh-reel-cap"><small>VICE CITY · LEONIDA</small><b>Enter the world of GTA VI</b></span></div>}
      </div>
    </section>

    <div className="fh-platforms">{["TikTok", "Instagram Reels", "YouTube Shorts", "Facebook Reels", "X"].map(p => <span key={p}>{p}</span>)}</div>

    <section className="fh-section fh-gallery-section">
      <header className="fh-section-head"><div><span className="fh-section-kicker">OFFICIAL ROCKSTAR MEDIA</span><h2>Welcome to Leonida</h2><p>Explore the characters, streets and atmosphere of GTA VI.</p></div><a className="fh-more" href="https://www.rockstargames.com/VI/media" target="_blank" rel="noreferrer">Official media gallery ↗</a></header>
      <div className="fh-gallery-grid">
        {gallery.map((item, i) => <a className={"fh-gallery-card gallery-" + i} href="https://www.rockstargames.com/VI/media" target="_blank" rel="noreferrer" key={item.title}>
          <img src={item.src} alt={item.title + " — official GTA VI artwork"} loading={i < 2 ? "eager" : "lazy"} />
          <span className="fh-gallery-label">{item.label}</span><b>{item.title}</b><i>↗</i>
        </a>)}
      </div>
      <p className="fh-gallery-credit">Official Grand Theft Auto VI promotional images © Rockstar Games. Images are displayed from Rockstar's media CDN and link to its official media page.</p>
    </section>

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
        {[["1", "Pick a drop", "Browse the weekly vertical videos and preview them."], ["2", "Download", "One tap, full quality. Members get clean files with no watermark."], ["3", "Post it", "Publish on your own TikTok, Instagram or YouTube and grow your page."], ["4", "Pay less over time", "Your price follows the loyalty schedule shown below."]].map(([n, t, d]) => <div className="fh-step" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}
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

    <section className="fh-section fh-reviews-section" id="community-reviews">
      <header className="fh-section-head"><div><span className="fh-section-kicker">COMMUNITY VOICES</span><h2>Creator reviews</h2><p>Feedback from people using VICEHUB. Reviews are moderated before publication.</p></div><span className="fh-review-count">{reviews.length} published</span></header>
      {reviews.length ? <Carousel label="Community reviews">
        {reviews.map(review => <article className="fh-review-card" role="listitem" key={review.id}>
          <div className="fh-review-stars" aria-label={review.rating + " out of 5 stars"}>{"★".repeat(review.rating)}{"☆".repeat(5-review.rating)}</div>
          <h3>{review.title}</h3><p>“{review.review_text}”</p>
          <div className="fh-review-author"><span>{(review.display_name || "Creator").slice(0,1).toUpperCase()}</span><div><b>{review.display_name || "VICEHUB creator"}</b><small>Verified VICEHUB account</small></div></div>
        </article>)}
      </Carousel> : <div className="fh-review-empty"><div className="fh-review-empty-stars">★★★★★</div><h3>The community writes this story.</h3><p>No published reviews yet. We will only display feedback submitted by real members and approved by our moderation team.</p></div>}
      <div className="fh-review-form-wrap">
        <div><span className="fh-section-kicker">HAVE YOUR SAY</span><h3>Share your experience</h3><p>Signed-in members can submit one review. It appears publicly only after moderation.</p></div>
        {isAuthenticated ? <form className="fh-review-form" onSubmit={async e => {
          e.preventDefault(); setReviewBusy(true); setReviewNotice("");
          try { const result = await submitCommunityReview({data:{rating:reviewRating,title:reviewTitle,reviewText}}); setReviewNotice(result?.message || "Review submitted for moderation."); setReviewTitle(""); setReviewText(""); }
          catch(err) { setReviewNotice(err?.message || "Your review could not be submitted."); }
          finally { setReviewBusy(false); }
        }}>
          <label>Rating<select value={reviewRating} onChange={e=>setReviewRating(Number(e.target.value))}><option value={5}>★★★★★ — Excellent</option><option value={4}>★★★★☆ — Very good</option><option value={3}>★★★☆☆ — Good</option><option value={2}>★★☆☆☆ — Fair</option><option value={1}>★☆☆☆☆ — Poor</option></select></label>
          <label>Review title<input required minLength={3} maxLength={90} value={reviewTitle} onChange={e=>setReviewTitle(e.target.value)} placeholder="What should other creators know?"/></label>
          <label>Your review<textarea required minLength={20} maxLength={800} rows={4} value={reviewText} onChange={e=>setReviewText(e.target.value)} placeholder="Describe your actual experience with VICEHUB…"/></label>
          <button className="fh-btn solid" disabled={reviewBusy}>{reviewBusy ? "Submitting…" : "Submit review"}</button>
          {reviewNotice && <p className="fh-review-notice" role="status">{reviewNotice}</p>}
        </form> : <button type="button" className="fh-btn solid" onClick={navigateToLogin}>Sign in to leave a review</button>}
      </div>
    </section>

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
