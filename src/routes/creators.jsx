import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getCreatorDirectory, getMyCreatorProfile, saveMyCreatorProfile, sendDirectMessage } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";
import { useLocale, translate } from "@/lib/i18n";
import "@/styles/creators-directory.css";

const CREATOR_ART = [
  "https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=3840",
  "https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=3840",
  "https://www.rockstargames.com/VI/_next/static/media/Lucia_Caminos_12.0saq9ns-~xj03.jpg?akim=1&imdensity=1&imwidth=3840",
];
const initials = name => String(name || "V").trim().split(/\s+/).slice(0, 2).map(x => x[0] || "").join("").toUpperCase();

export const Route = createFileRoute("/creators")({
  head: () => ({ meta: [
    { title: "Creators — VICEHUB" },
    { name: "description", content: "Meet GTA VI video creators, editors and community talent in the VICEHUB creator network." },
    { property: "og:title", content: "Creators — VICEHUB" },
    { property: "og:description", content: "Discover the people creating the next wave of GTA VI content." },
  ] }),
  component: CreatorsPage,
});

function CreatorsPage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const locale = useLocale(), tx = key => translate(locale, key);
  const [creators, setCreators] = useState([]);
  const [profile, setProfile] = useState({ displayName: "", bio: "", avatarUrl: "", bannerUrl: "", websiteUrl: "", locationLabel: "", skills: [] });
  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState("ALL");
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const rows = await getCreatorDirectory({ data: { query } }); setCreators(Array.isArray(rows) ? rows : []); }
    catch (e) { setError(e.message || "Creator directory could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [query]);
  useEffect(() => {
    if (isAuthenticated) getMyCreatorProfile().then(p => {
      if (p) setProfile({ id: p.id, displayName: p.display_name || "", bio: p.bio || "", avatarUrl: p.avatar_url || "", bannerUrl: p.banner_url || "", websiteUrl: p.website_url || "", locationLabel: p.location_label || "", skills: p.skills || [] });
    }).catch(() => {});
  }, [isAuthenticated]);

  const skillOptions = useMemo(() => ["ALL", ...new Set(creators.flatMap(c => c.skills || []).filter(Boolean))], [creators]);
  const visibleCreators = useMemo(() => creators.filter(c => skill === "ALL" || (c.skills || []).includes(skill)), [creators, skill]);

  const save = async e => {
    e.preventDefault();
    if (!isAuthenticated) { navigateToLogin(); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const r = await saveMyCreatorProfile({ data: { ...profile, skills: profile.skills || [] } });
      setNotice(r.status === "published" ? "Your creator profile is live." : "Your profile has been submitted for review.");
      setEditing(false);
      await load();
    } catch (e) { setError(e.message || "Profile could not be saved."); }
    finally { setSaving(false); }
  };
  const send = async e => {
    e.preventDefault();
    if (!isAuthenticated) { navigateToLogin(); return; }
    if (!selected) return;
    try {
      await sendDirectMessage({ data: { recipientId: selected.user_id, body: message } });
      setNotice("Private message sent."); setMessage(""); setSelected(null);
    } catch (e) { setError(e.message || "Message could not be sent."); }
  };

  return <SiteFrame eyebrow="VICEHUB / CREATOR NETWORK" workspace={isAuthenticated} activeKey="profile">
    <div className="cr-page">
      <section className="cr-hero">
        <img src={CREATOR_ART[0]} alt="Jason and Lucia in Leonida — Grand Theft Auto VI artwork" />
        <div className="cr-hero-overlay" />
        <div className="cr-hero-copy">
          <div className="cr-kicker"><span /> THE PEOPLE BEHIND THE CONTENT <i /> VICEHUB NETWORK</div>
          <p className="cr-overline">CREATORS / EDITORS / COMMUNITY</p>
          <h1>MAKE YOUR<br/><em>MARK</em> IN<br/>LEONIDA<span>.</span></h1>
          <p className="cr-lead">Meet the creators shaping the GTA VI community. Find collaborators, showcase your work and connect with the people building what comes next.</p>
          <button className="cr-primary" type="button" onClick={() => isAuthenticated ? setEditing(v => !v) : navigateToLogin()}>{isAuthenticated ? "BUILD YOUR CREATOR PROFILE" : "JOIN THE CREATOR NETWORK"} <b>↗</b></button>
        </div>
        <div className="cr-hero-side"><b>VI</b><span>ONE WORLD.<br/>MANY STORIES.</span></div>
        <div className="cr-hero-footer"><span>INDEPENDENT CREATOR COMMUNITY</span><span>VICEHUB · LEONIDA</span></div>
      </section>

      <section className="cr-manifesto">
        <div><b>01</b><span>SHOWCASE<br/><strong>YOUR WORK</strong></span></div>
        <div><b>02</b><span>FIND YOUR<br/><strong>COLLABORATORS</strong></span></div>
        <div><b>03</b><span>GROW YOUR<br/><strong>COMMUNITY</strong></span></div>
        <div className="cr-member-count"><strong>{creators.length.toString().padStart(2, "0")}</strong><span>FEATURED<br/>CREATORS</span></div>
      </section>

      {notice && <div className="cr-notice" role="status">{notice}</div>}
      {error && <div className="cr-error" role="alert">{error}</div>}

      {editing && <section className="cr-profile-panel" id="creator-profile-form">
        <div className="cr-panel-heading"><div><span className="cr-section-kicker">YOUR SPACE / YOUR STORY</span><h2>Build your <em>profile</em></h2><p>Tell the community what you create and how to reach you. New profiles are reviewed before appearing publicly.</p></div><button type="button" onClick={() => setEditing(false)} aria-label="Close profile editor">×</button></div>
        <form onSubmit={save} className="cr-form">
          <label>DISPLAY NAME<input required minLength={2} maxLength={80} value={profile.displayName} onChange={e => setProfile({ ...profile, displayName: e.target.value })} placeholder="Your creator name"/></label>
          <label>YOUR BIO<textarea rows={4} maxLength={2000} value={profile.bio} onChange={e => setProfile({ ...profile, bio: e.target.value })} placeholder="What do you make? What makes your content different?"/></label>
          <div className="cr-form-grid">
            <label>LOCATION<input maxLength={100} value={profile.locationLabel} onChange={e => setProfile({ ...profile, locationLabel: e.target.value })} placeholder="City / Country"/></label>
            <label>WEBSITE OR PORTFOLIO<input type="url" value={profile.websiteUrl} onChange={e => setProfile({ ...profile, websiteUrl: e.target.value })} placeholder="https://"/></label>
            <label>PROFILE IMAGE URL<input type="url" value={profile.avatarUrl} onChange={e => setProfile({ ...profile, avatarUrl: e.target.value })} placeholder="https://"/></label>
            <label>BANNER IMAGE URL<input type="url" value={profile.bannerUrl} onChange={e => setProfile({ ...profile, bannerUrl: e.target.value })} placeholder="https://"/></label>
          </div>
          <label>YOUR SKILLS <small>Separate each skill with a comma</small><input value={(profile.skills || []).join(", ")} onChange={e => setProfile({ ...profile, skills: e.target.value.split(",").map(x => x.trim()).filter(Boolean).slice(0, 20) })} placeholder="Video editing, TikTok, cinematics…"/></label>
          <div className="cr-form-actions"><button className="cr-primary" disabled={saving}>{saving ? "SAVING…" : "SUBMIT PROFILE"} <b>↗</b></button><span>Profiles are public only after approval.</span></div>
        </form>
      </section>}

      {selected && <section className="cr-message-panel">
        <div className="cr-panel-heading"><div><span className="cr-section-kicker">DIRECT CONNECTION</span><h2>Message <em>{selected.display_name}</em></h2><p>Start a conversation with this creator.</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close message form">×</button></div>
        <form onSubmit={send}><textarea required minLength={1} maxLength={5000} rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="Introduce yourself and explain what you want to collaborate on…"/><button className="cr-primary">SEND MESSAGE <b>↗</b></button></form>
      </section>}

      <section className="cr-directory" id="directory">
        <div className="cr-directory-heading"><div><span className="cr-section-kicker">01 / THE NETWORK</span><h2>Meet the <em>creators</em></h2><p>Discover talent across the GTA VI creator community.</p></div><div className="cr-directory-index"><b>VH / 001</b><span>CREATOR DIRECTORY</span></div></div>
        <div className="cr-toolbar">
          <label className="cr-search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search creators, names or skills…" aria-label="Search creators"/></label>
          <div className="cr-skills" aria-label="Filter by skill">{skillOptions.map(x => <button type="button" key={x} className={skill === x ? "active" : ""} onClick={() => setSkill(x)}>{x === "ALL" ? "ALL CREATORS" : x}</button>)}</div>
        </div>
        {loading ? <div className="cr-empty"><b>LOADING THE NETWORK</b><p>Finding creators across Leonida…</p></div>
          : visibleCreators.length ? <div className="cr-grid">{visibleCreators.map((c, i) => <article className="cr-card" key={c.id}>
            <div className="cr-card-cover"><img src={c.banner_url || CREATOR_ART[i % CREATOR_ART.length]} alt="" loading="lazy"/><span className="cr-card-number">CREATOR / {(i + 1).toString().padStart(2, "0")}</span></div>
            <div className="cr-card-body"><div className="cr-avatar">{c.avatar_url ? <img src={c.avatar_url} alt={c.display_name}/> : <span>{initials(c.display_name)}</span>}</div>
              <div className="cr-card-location">{c.location_label || "VICEHUB CREATOR"}</div><h3>{c.display_name}</h3><p className="cr-card-bio">{c.bio || "GTA VI creator and community member."}</p>
              <div className="cr-card-skills">{(c.skills || []).slice(0, 5).map(x => <span key={x}>{x}</span>)}</div>
              <div className="cr-card-actions"><button type="button" onClick={() => setSelected(c)}>MESSAGE CREATOR <b>↗</b></button>{c.website_url && <a href={c.website_url} target="_blank" rel="noreferrer">PORTFOLIO ↗</a>}</div>
            </div>
          </article>)}</div>
          : <div className="cr-empty"><span>VI</span><b>{creators.length ? "NO MATCHING CREATORS" : "THE NETWORK IS JUST GETTING STARTED"}</b><p>{creators.length ? "Try a different name or skill." : "No public creator profiles have been approved yet. Create yours and become one of the first faces of the VICEHUB network."}</p><button type="button" onClick={() => isAuthenticated ? setEditing(true) : navigateToLogin()}>{isAuthenticated ? "CREATE YOUR PROFILE ↗" : "JOIN THE NETWORK ↗"}</button></div>}
      </section>

      <section className="cr-bottom-cta"><img src={CREATOR_ART[2]} alt="" loading="lazy"/><div><span className="cr-section-kicker">YOUR NEXT CHAPTER STARTS HERE</span><h2>DON'T JUST WATCH<br/>THE STORY. <em>CREATE IT.</em></h2><p>Build your presence in the VICEHUB creator network.</p><button className="cr-primary" type="button" onClick={() => isAuthenticated ? setEditing(true) : navigateToLogin()}>{isAuthenticated ? "EDIT YOUR PROFILE" : "BECOME A CREATOR"} <b>↗</b></button></div></section>
    </div>
  </SiteFrame>;
}
