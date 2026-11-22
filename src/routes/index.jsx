import { useEffect, useMemo, useState } from "react";
import { listPublishedVideos, requestVideoDownload, getNewsFeed } from "@/lib/server-fns";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GTA6 Creator Hub — The creator network" },
      { name: "description", content: "A creator-first hub for GTA VI video inspiration, community, news and creator tools." },
      { name: "theme-color", content: "#09090d" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }, { rel: "icon", href: "/icons/vicehub.svg", type: "image/svg+xml" }],
  }),
  component: HomePage,
});

const copy = {
  en: { explore: "Explore", library: "Video library", news: "GTA VI news", creators: "Creators", studio: "AI studio", social: "Social", marketplace: "Marketplace", shop: "Shop", pricing: "Plans", signIn: "Sign in", join: "Join the hub", eyebrow: "THE CREATOR NETWORK", hero: "Make Vice City", hero2: "your playground.", intro: "Discover creator-ready GTA VI footage, build better short-form content and grow with a community made for creators.", browse: "Explore the library", learn: "Explore the platform", featured: "Featured footage", featuredSub: "Curated clips and scenes for your next edit.", latest: "The latest from Vice City", latestSub: "News desk — source-labelled updates, not rumours presented as facts.", tools: "Everything creators need", toolsSub: "One focused workspace for discovery, production and growth.", plans: "Simple plans. More creative freedom.", plansSub: "Start free. Upgrade when your workflow needs more.", free: "Free", starter: "Starter", pro: "Pro", premium: "Premium", month: "/ month", freeDesc: "Try the library and find your workflow.", starterDesc: "More room for regular creators.", proDesc: "For creators publishing consistently.", premiumDesc: "For creators ready to sell and grow.", startFree: "Start for free", choose: "Choose plan", note: "Independent fan platform. Not affiliated with Rockstar Games or Take-Two Interactive.", demo: "Preview environment — sample cards are illustrative; no videos are currently available to download.", search: "Search videos, topics or creators…", all: "All", cinematic: "Cinematics", gameplay: "Gameplay", edits: "Edit packs", open: "Open section", soon: "Coming soon", monthly: "5 downloads / month", noCharge: "No payment details required" },
  fr: { explore: "Explorer", library: "Bibliothèque vidéo", news: "Actualités GTA VI", creators: "Créateurs", studio: "Studio IA", marketplace: "Marketplace", pricing: "Offres", signIn: "Connexion", join: "Rejoindre le hub", eyebrow: "LE RÉSEAU DES CRÉATEURS", hero: "Faites de Vice City", hero2: "votre terrain de jeu.", intro: "Découvrez des vidéos GTA VI pensées pour les créateurs, préparez vos formats courts et développez votre audience.", browse: "Explorer la bibliothèque", learn: "Découvrir la plateforme", featured: "Vidéos à la une", featuredSub: "Des séquences sélectionnées pour vos prochains montages.", latest: "Les dernières nouvelles de Vice City", latestSub: "Actualités avec sources identifiées, sans présenter les rumeurs comme des faits.", tools: "Tout ce qu’il faut aux créateurs", toolsSub: "Un espace dédié à la découverte, la création et la croissance.", plans: "Des offres simples. Plus de liberté.", plansSub: "Commencez gratuitement. Évoluez selon vos besoins.", free: "Gratuit", starter: "Starter", pro: "Pro", premium: "Premium", month: "/ mois", freeDesc: "Découvrez la bibliothèque et votre méthode de travail.", starterDesc: "Plus de liberté pour les créateurs réguliers.", proDesc: "Pour publier régulièrement.", premiumDesc: "Pour vendre et développer votre activité.", startFree: "Commencer gratuitement", choose: "Choisir l’offre", note: "Plateforme de fans indépendante. Non affiliée à Rockstar Games ou Take-Two Interactive.", demo: "Le catalogue charge les vidéos publiées. Les téléchargements sont autorisés côté serveur et nécessitent un stockage privé configuré.", search: "Rechercher vidéos, sujets ou créateurs…", all: "Tout", cinematic: "Cinématique", gameplay: "Gameplay", edits: "Packs de montage", open: "Ouvrir la rubrique", soon: "Bientôt disponible", monthly: "5 téléchargements / mois", noCharge: "Aucune carte bancaire requise" },
  es: { explore: "Explorar", library: "Biblioteca de vídeo", news: "Noticias GTA VI", creators: "Creadores", studio: "Estudio IA", marketplace: "Marketplace", pricing: "Planes", signIn: "Iniciar sesión", join: "Unirse al hub", eyebrow: "LA RED DE CREADORES", hero: "Haz de Vice City", hero2: "tu patio de recreo.", intro: "Descubre vídeos de GTA VI para creadores, prepara contenido corto y crece con una comunidad dedicada.", browse: "Explorar biblioteca", learn: "Explorar plataforma", featured: "Vídeos destacados", featuredSub: "Clips seleccionados para tu próxima edición.", latest: "Lo último de Vice City", latestSub: "Noticias con fuentes identificadas; los rumores no son hechos.", tools: "Todo lo que necesitan los creadores", toolsSub: "Un espacio para descubrir, crear y crecer.", plans: "Planes sencillos. Más libertad.", plansSub: "Empieza gratis y mejora cuando lo necesites.", free: "Gratis", starter: "Starter", pro: "Pro", premium: "Premium", month: "/ mes", freeDesc: "Prueba la biblioteca y encuentra tu flujo de trabajo.", starterDesc: "Más espacio para creadores habituales.", proDesc: "Para creadores constantes.", premiumDesc: "Para vender y crecer.", startFree: "Empezar gratis", choose: "Elegir plan", note: "Plataforma independiente de fans. No afiliada a Rockstar Games ni Take-Two Interactive.", demo: "El catálogo carga vídeos publicados. Las descargas se autorizan en el servidor y requieren almacenamiento privado configurado.", search: "Buscar vídeos, temas o creadores…", all: "Todo", cinematic: "Cinemáticas", gameplay: "Jugabilidad", edits: "Packs de edición", open: "Abrir sección", soon: "Próximamente", monthly: "5 descargas / mes", noCharge: "Sin datos de pago" },
};

const sections = [
  { id: "library", icon: "▧", title: "Video library", desc: "Curated clips, cinematic scenes and creator-ready footage." },
  { id: "studio", icon: "✳", title: "AI creator studio", desc: "Hooks, captions, titles and hashtag ideas for each platform." },
  { id: "news", icon: "◉", title: "GTA VI news desk", desc: "Official updates, press coverage and clearly labelled community reports." },
  { id: "marketplace", icon: "◇", title: "Creator marketplace", desc: "Sell original edits, packs and licensed creator content." },
];


function HomePage() {
  const { isAuthenticated, navigateToLogin, logout } = useAuth();
  const [language, setLanguage] = useState("en");
  const [currency, setCurrency] = useState("USD");
  const [active, setActive] = useState("explore");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [liveVideos, setLiveVideos] = useState([]);
  const [liveNews, setLiveNews] = useState([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [downloadMessage, setDownloadMessage] = useState("");
  const t = copy[language];
  useEffect(() => { getNewsFeed({ data: { locale: language, limit: 3 } }).then((rows) => setLiveNews(Array.isArray(rows) ? rows : [])).catch(() => setLiveNews([])); }, [language]);

  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);

  useEffect(() => {
    let active = true;
    listPublishedVideos()
      .then((rows) => { if (active) setLiveVideos(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (active) setLiveVideos([]); })
      .finally(() => { if (active) setIsLoadingVideos(false); });
    return () => { active = false; };
  }, []);
  const filtered = useMemo(() => liveVideos.filter((v) =>
    (category === "All" || v.category === category) &&
    ((v.title || "").toLowerCase().includes(search.toLowerCase()) || (v.category || "").toLowerCase().includes(search.toLowerCase()))
  ), [liveVideos, category, search]);
  const downloadVideo = async (video) => {
    try {
      setDownloadMessage("Checking your account and monthly download allowance…");
      const result = await requestVideoDownload({ data: { videoId: video.id } });
      setDownloadMessage("");
      window.location.assign(result.downloadUrl);
    } catch (error) {
      setDownloadMessage(error?.message || "Download could not be authorised.");
    }
  };
  const navigate = (id) => {
    const routes = { news: "/news", creators: "/community", studio: "/studio", marketplace: "/marketplace", shop: "/shop", social: "/social", pricing: "/#plans" };
    if (routes[id]) { window.location.assign(routes[id]); return; }
    setActive(id); setNotice("");
    if (id === "library") document.getElementById("library")?.scrollIntoView({ behavior: "smooth" });
  };
  
  return (
    <div className="hub-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("explore")} aria-label="GTA6 Creator Hub home"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>CREATOR NETWORK</small></span></button>
        <nav className="main-nav" aria-label="Main navigation">
          {["explore", "library", "news", "creators", "studio", "social", "marketplace", "shop", "pricing"].map((id) => <button key={id} className={active === id ? "nav-link active" : "nav-link"} onClick={() => navigate(id)}>{t[id] || id}</button>)}
        </nav>
        <div className="top-actions">
          <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option></select>
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select>
          <button className="sign-in" onClick={() => isAuthenticated ? logout() : navigateToLogin()}>{isAuthenticated ? "Sign out" : t.signIn}</button>
          <button className="join-btn" onClick={() => isAuthenticated ? window.location.assign("/dashboard") : navigateToLogin()}>{isAuthenticated ? "My account" : t.join}<span>↗</span></button>
        </div>
      </header>

      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="live-dot" /> {t.eyebrow}</div>
            <h1>{t.hero}<br /><em>{t.hero2}</em></h1>
            <p>{t.intro}</p>
            <div className="hero-actions"><button className="primary-btn" onClick={() => navigate("library")}>{t.browse}<span>↗</span></button><button className="text-btn" onClick={() => navigate("studio")}>{t.learn} <span>→</span></button></div>
            <div className="hero-proof"><span><b>01</b> DISCOVER</span><i /> <span><b>02</b> CREATE</span><i /> <span><b>03</b> GROW</span></div>
          </div>
          <div className="hero-art" aria-label="Vice City inspired abstract neon skyline illustration">
            <div className="sun-disc" /><div className="palm palm-one">♧</div><div className="palm palm-two">♧</div><div className="skyline"><i /><i /><i /><i /><i /><i /><i /></div><div className="road-lines" /><div className="hero-art-label"><span>V/06</span><b>THE CITY IS YOUR CANVAS</b><small>CREATOR EDITION · 2026</small></div>
          </div>
          <div className="hero-bottom"><span>BUILT FOR THE NEXT GENERATION OF GTA VI CREATORS</span><span>01 / 04 <b>—</b> VICE CITY</span></div>
        </section>

        <section className="section library-section" id="library">
          <div className="section-head"><div><div className="eyebrow">01 / CONTENT LIBRARY</div><h2>{t.featured}</h2><p>{t.featuredSub}</p></div><button className="outline-btn" onClick={() => navigate("library")}>{t.open} <span>↗</span></button></div>
          <div className="demo-note"><span>i</span>{t.demo}</div>
          <div className="library-tools"><div className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} /></div><div className="filters">{["All", "Cinematics", "Gameplay", "Edit packs"].map((c) => <button key={c} className={category === c ? "filter active" : "filter"} onClick={() => setCategory(c)}>{c === "All" ? t.all : c === "Cinematics" ? t.cinematic : c === "Gameplay" ? t.gameplay : t.edits}</button>)}</div></div>
          <div className="video-grid">{filtered.map((v, i) => <article className="video-card" key={v.id}><div className={`video-art ${["sunset","neon","coast","pink"][i % 4]}`}>{v.thumbnail_url && <img className="video-thumb" src={v.thumbnail_url} alt="" loading="lazy" />}<span className="video-tag">{(v.category || "VIDEO").toUpperCase()}</span><span className="play-mark">▶</span><span className="video-length">{v.duration_seconds ? Math.floor(v.duration_seconds / 60) + ":" + String(v.duration_seconds % 60).padStart(2, "0") : "VIDEO"}</span><div className="art-caption">VICE CITY<br /><b>CREATOR SERIES</b></div></div><div className="video-meta"><div><h3>{v.title}</h3><p>{v.category || "GTA VI"} <span>·</span> {v.creator_name || "Creator Hub"}</p></div><button aria-label={`Download ${v.title}`} onClick={() => downloadVideo(v)}>↓</button></div></article>)}{!isLoadingVideos && filtered.length === 0 && <div className="empty-library">{language === "fr" ? "Aucune vidéo publiée pour le moment. Le catalogue sera alimenté après validation des droits et des fichiers." : language === "es" ? "Todavía no hay vídeos publicados. El catálogo se completará cuando se verifiquen los derechos y los archivos." : "No videos published yet. The library will populate after rights and video files are verified."}</div>}{isLoadingVideos && <div className="empty-library">Loading the live catalogue…</div>}</div>{downloadMessage && <div className="demo-note" role="status">{downloadMessage}</div>}
        </section>

        <section className="news-section">
          <div className="section-head"><div><div className="eyebrow">02 / THE NEWSROOM</div><h2>{t.latest}</h2><p>{t.latestSub}</p></div><button className="outline-btn" onClick={() => navigate("news")}>{t.open} <span>↗</span></button></div>
          <div className="news-grid">{liveNews.map((story, i) => <article className="news-card" key={story.id} onClick={() => window.location.assign("/news")}><div className="news-index">0{i + 1}<span> / {story.confidence?.toUpperCase()}</span></div><div className="story-type">{story.source_name}</div><h3>{story.title}</h3><p>{story.summary}</p><div className="story-source"><span>↗</span>{story.source_type}</div></article>)}{!liveNews.length && <div className="empty-library">The newsroom is ready. Published stories will appear here after editorial review.</div>}</div>
        </section>

        <section className="features-section"><div className="section-head"><div><div className="eyebrow">03 / CREATOR WORKSPACE</div><h2>{t.tools}</h2><p>{t.toolsSub}</p></div></div><div className="feature-grid">{sections.map((item, i) => <button className="feature-card" key={item.id} onClick={() => navigate(item.id)}><div className="feature-top"><span className="feature-icon">{item.icon}</span><span>0{i + 1} / 04</span></div><h3>{item.title}</h3><p>{item.desc}</p><span className="feature-link">{t.open} ↗</span></button>)}</div></section>

        <section id="plans" className="pricing-section"><div className="pricing-intro"><div className="eyebrow">04 / MEMBERSHIP</div><h2>{t.plans}</h2><p>{t.plansSub}</p><div className="currency-note">DISPLAY CURRENCY <b>{currency}</b><small>Illustrative converted display. Final billing currency and prices are set at checkout.</small></div></div><div className="plans-grid">
          {[{name:t.free,price:0,desc:t.freeDesc,features:[t.monthly,"Curated library access","Community browsing"],cta:t.startFree},{name:t.starter,price:null,desc:t.starterDesc,features:["Expanded monthly downloads","Clean downloads where licensed","Creator tools"],cta:t.choose},{name:t.pro,price:null,desc:t.proDesc,features:["Higher download allowance","AI content workspace","Priority library access"],cta:t.choose},{name:t.premium,price:null,desc:t.premiumDesc,features:["Marketplace seller access","Creator subscriptions","Sales and audience insights"],cta:t.choose}].map((plan,i)=><article className={i===2?"plan-card highlighted":"plan-card"} key={plan.name}><div className="plan-name">{plan.name}{i===2&&<span>POPULAR</span>}</div><div className="plan-price">{plan.price===0?"FREE":"Set at launch"}<small>{plan.price===0?"":t.month}</small></div><p>{plan.desc}</p><ul>{plan.features.map(f=><li key={f}><span>✓</span>{f}</li>)}</ul><button className={i===2?"primary-btn full":"outline-btn full"} onClick={() => setNotice("Subscription checkout is not connected yet. Prices and loyalty discounts will be configured before sales open.")}>{plan.cta} <span>↗</span></button></article>)}
        </div><p className="loyalty-note"><span>✳</span> Loyalty pricing is planned: the monthly price decreases for each uninterrupted paid month. A voluntary cancellation resets the introductory price on a later return. Exact reductions and minimum price will be configurable by the administrator.</p></section>
      </main>

      <footer className="footer"><div className="footer-brand"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span></span></div><p>{t.note}</p><div className="footer-links"><button onClick={() => window.location.assign("/terms")}>Terms</button><button onClick={() => window.location.assign("/privacy")}>Privacy</button><button onClick={() => window.location.assign("/copyright")}>Copyright</button></div><small>© 2026 VICEHUB. INDEPENDENT CREATOR PLATFORM.</small></footer>
    </div>
  );
}
