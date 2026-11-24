import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getNewsFeed, createContentReport } from "@/lib/server-fns";
import { useLocale, translate } from "@/lib/i18n";
import { useAuth } from "@/lib/AuthContext";
import "@/styles/newsroom.css";

const NEWS_ART = [
  "https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=3840",
  "https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=3840",
  "https://www.rockstargames.com/VI/_next/static/media/Lucia_Caminos_12.0saq9ns-~xj03.jpg?akim=1&imdensity=1&imwidth=3840",
  "https://www.rockstargames.com/VI/_next/static/media/VINTAGE_VICE_CITY_PACK_01.05zaof7o1uz.3.jpg?akim=1&imdensity=1&imwidth=3840",
  "https://www.rockstargames.com/VI/_next/static/media/ULTIMATE_EDITION_GROTTI_CHEETAH_01.0a.wy3s_ogjey.jpg?akim=1&imdensity=1&imwidth=3840",
];
const stamp = value => value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "VICEHUB NEWS DESK";
const confidenceLabel = value => ({ official: "OFFICIAL", confirmed: "CONFIRMED", reported: "REPORTED", rumour: "RUMOUR", theory: "THEORY", community: "COMMUNITY" }[value] || String(value || "NEWS").toUpperCase());

export const Route = createFileRoute("/news")({
  head: () => ({ meta: [
    { title: "GTA VI Newsroom — VICEHUB" },
    { name: "description", content: "The VICEHUB GTA VI dispatch: official updates, sourced reporting and clearly labelled community coverage." },
    { property: "og:title", content: "GTA VI Newsroom — VICEHUB" },
    { property: "og:description", content: "Official updates, sourced reporting and the latest from Leonida." },
  ] }),
  component: NewsPage,
});

function NewsPage() {
  const { isAuthenticated } = useAuth();
  const locale = useLocale(), tx = key => translate(locale, key);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getNewsFeed({ data: { locale, limit: 50 } })
      .then(rows => { if (active) setArticles(Array.isArray(rows) ? rows : []); })
      .catch(e => { if (active) setError(e.message || "News could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale]);

  const filtered = useMemo(() => articles.filter(a => {
    const matchesFilter = filter === "all" || a.confidence === filter || a.source_type === filter;
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || [a.title, a.summary, a.source_name, a.source_type].some(v => String(v || "").toLowerCase().includes(q));
    return matchesFilter && matchesSearch;
  }), [articles, filter, search]);
  const featured = filtered[0] || null;
  const rest = filtered.slice(1);

  const report = async () => {
    if (!selected || reportBusy) return;
    setReportBusy(true);
    try {
      await createContentReport({ data: { targetType: "news", targetId: selected.id, reason: "other", details: "User-submitted report from the news page." } });
      setError("Report submitted for moderation.");
    } catch (e) { setError(e.message || "Report could not be submitted."); }
    finally { setReportBusy(false); }
  };

  return <SiteFrame eyebrow="VICEHUB / THE LEONIDA DISPATCH" workspace={isAuthenticated} activeKey="news">
    <div className="nr-page">
      <section className="nr-hero">
        <img className="nr-hero-image" src={NEWS_ART[1]} alt="Vice City — official Grand Theft Auto VI artwork" />
        <div className="nr-hero-shade" />
        <div className="nr-hero-content">
          <div className="nr-kicker"><span className="nr-live-dot" /> VICEHUB NEWSROOM <i /> LEONIDA / FLORIDA</div>
          <p className="nr-overline">THE CITY NEVER STOPS TALKING</p>
          <h1>THE <em>LEONIDA</em><br/>DISPATCH<span>.</span></h1>
          <p className="nr-intro">The latest from the world of Grand Theft Auto VI. Official announcements, sourced reporting and community perspectives — clearly labelled, never dressed up as fact.</p>
          <a className="nr-hero-link" href="#latest">EXPLORE THE LATEST <span>↓</span></a>
        </div>
        <div className="nr-hero-index"><b>VI</b><span>VICE CITY<br/>NEWS NETWORK</span></div>
        <div className="nr-hero-bottom"><span>INDEPENDENT FAN COVERAGE</span><span>EST. VICEHUB · 2026</span></div>
      </section>

      <div className="nr-trust-strip">
        <div><b>01</b><span>EVERY STORY<br/><strong>HAS A SOURCE</strong></span></div>
        <div><b>02</b><span>CLAIMS ARE<br/><strong>LABELLED CLEARLY</strong></span></div>
        <div><b>03</b><span>RUMOURS STAY<br/><strong>RUMOURS</strong></span></div>
        <div className="nr-count"><strong>{articles.length.toString().padStart(2, "0")}</strong><span>STORIES<br/>PUBLISHED</span></div>
      </div>

      {selected ? <article className="nr-article-view">
        <button className="nr-back" type="button" onClick={() => setSelected(null)}>← BACK TO THE NEWSROOM</button>
        <div className="nr-article-cover"><img src={selected.image_url || NEWS_ART[Math.max(0, articles.indexOf(selected)) % NEWS_ART.length]} alt="" /><span>{confidenceLabel(selected.confidence)}</span></div>
        <div className="nr-article-meta"><span>{selected.source_name || "VICEHUB NEWS DESK"}</span><i />{stamp(selected.published_at)}</div>
        <h2>{selected.title}</h2>
        <p className="nr-article-summary">{selected.summary}</p>
        <div className="nr-article-body">{selected.body}</div>
        <div className="nr-source-panel"><div><small>ORIGINAL REPORTING</small><b>{selected.source_name || "Original source"}</b></div><a href={selected.source_url} target="_blank" rel="noreferrer">READ ORIGINAL ↗</a></div>
        <button className="nr-report" type="button" onClick={report} disabled={reportBusy}>{reportBusy ? "SENDING…" : "REPORT A PROBLEM WITH THIS STORY"}</button>
      </article> : <section className="nr-feed" id="latest">
        <div className="nr-feed-heading"><div><span className="nr-section-label">01 / THE NEWS WIRE</span><h2>Latest <em>stories</em></h2><p>What is happening across Leonida and the GTA VI universe.</p></div><span className="nr-edition">VICEHUB<br/>DAILY EDITION</span></div>
        <div className="nr-controls">
          <label className="nr-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search headlines, sources…" aria-label="Search news" /></label>
          <div className="nr-filters" aria-label="Filter stories">
            {[["all", "ALL STORIES"], ["official", "OFFICIAL"], ["confirmed", "CONFIRMED"], ["reported", "REPORTED"], ["rumour", "RUMOURS"], ["theory", "THEORIES"], ["community", "COMMUNITY"]].map(([value, label]) =>
              <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>
            )}
          </div>
        </div>
        {error && <div className="nr-alert" role="status">{error}</div>}
        {loading ? <div className="nr-empty"><span className="nr-empty-mark">VI</span><b>CONNECTING TO THE NEWS WIRE</b><p>Loading the latest sourced stories…</p></div>
          : filtered.length === 0 ? <div className="nr-empty"><span className="nr-empty-mark">VH</span><b>{articles.length ? "NO MATCHING STORIES" : "THE NEWSROOM IS ON STANDBY"}</b><p>{articles.length ? "Try another search or filter." : "No stories have been published yet. When a story is approved, it will appear here with its source and verification label."}</p>{(search || filter !== "all") && <button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>CLEAR FILTERS</button>}</div>
          : <div className="nr-story-layout">
            {featured && <button type="button" className="nr-featured" onClick={() => setSelected(featured)}>
              <div className="nr-featured-image"><img src={featured.image_url || NEWS_ART[0]} alt="" loading="lazy"/><span className="nr-featured-tag">EDITOR'S PICK / LATEST</span><span className={"nr-status " + (featured.confidence || "")}>{confidenceLabel(featured.confidence)}</span></div>
              <div className="nr-featured-copy"><div className="nr-card-meta"><span>{featured.source_name || "VICEHUB NEWS DESK"}</span><i />{stamp(featured.published_at)}</div><h3>{featured.title}</h3><p>{featured.summary}</p><span className="nr-read">READ THE STORY <b>↗</b></span></div>
            </button>}
            <div className="nr-story-grid">
              {rest.map((a, i) => <button type="button" className="nr-story-card" key={a.id} onClick={() => setSelected(a)}>
                <div className="nr-story-image"><img src={a.image_url || NEWS_ART[(i + 1) % NEWS_ART.length]} alt="" loading="lazy"/><span className={"nr-status " + (a.confidence || "")}>{confidenceLabel(a.confidence)}</span></div>
                <div className="nr-card-meta"><span>{a.source_name || "VICEHUB"}</span><i />{stamp(a.published_at)}</div>
                <h3>{a.title}</h3><p>{a.summary}</p><span className="nr-read">READ STORY <b>↗</b></span>
              </button>)}
            </div>
          </div>}
      </section>}

      <section className="nr-editorial-note"><div className="nr-note-mark">!</div><div><span>OUR EDITORIAL STANDARD</span><h3>Facts first. Hype second.</h3><p>VICEHUB is an independent fan publication. Official announcements, confirmed reporting, rumours, theories and opinions are kept distinct. We link to original sources and do not reproduce full third-party articles. VICEHUB is not affiliated with Rockstar Games or Take-Two Interactive.</p></div></section>
    </div>
  </SiteFrame>;
}
