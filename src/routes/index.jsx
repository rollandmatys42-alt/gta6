import { useEffect, useMemo, useState } from "react";
import { listPublishedVideos, requestVideoDownload, getNewsFeed, getPublicPlans } from "@/lib/server-fns";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GTA6 Creator Hub — The creator network" },
      { name: "description", content: "A creator-first hub for GTA VI video inspiration, community, news and creator tools." },
      { name: "theme-color", content: "#09090d" },
      { property: "og:title", content: "GTA6 Creator Hub — The creator network" },
      { property: "og:description", content: "A creator-first hub for GTA VI video inspiration, community, news and creator tools." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }, { rel: "icon", href: "/icons/vicehub.svg", type: "image/svg+xml" }, { rel: "canonical", href: "https://gta6-creator-hub-c26cc578.base44.app/" }],
  }),
  component: HomePage,
});

const copy = {
  en: { explore: "Explore", library: "Video library", news: "GTA VI news", creators: "Creators", studio: "AI studio", social: "Social", marketplace: "Marketplace", shop: "Shop", pricing: "Plans", signIn: "Sign in", join: "Join the hub", eyebrow: "THE CREATOR NETWORK", hero: "Make Vice City", hero2: "your playground.", intro: "Discover creator-ready GTA VI footage, build better short-form content and grow with a community made for creators.", browse: "Explore the library", learn: "Explore the platform", featured: "Featured footage", featuredSub: "Curated clips and scenes for your next edit.", latest: "The latest from Vice City", latestSub: "News desk — source-labelled updates, not rumours presented as facts.", tools: "Everything creators need", toolsSub: "One focused workspace for discovery, production and growth.", plans: "Simple plans. More creative freedom.", plansSub: "Start free. Upgrade when your workflow needs more.", free: "Free", starter: "Starter", pro: "Pro", premium: "Premium", month: "/ month", freeDesc: "Try the library and find your workflow.", starterDesc: "More room for regular creators.", proDesc: "For creators publishing consistently.", premiumDesc: "For creators ready to sell and grow.", startFree: "Start for free", choose: "Choose plan", note: "Independent fan platform. Not affiliated with Rockstar Games or Take-Two Interactive.", demo: "No licensed video content has been published yet. Only approved footage will appear here.", search: "Search videos, topics or creators…", all: "All", cinematic: "Cinematics", gameplay: "Gameplay", edits: "Edit packs", open: "Open section", soon: "Coming soon", monthly: "5 downloads / month", noCharge: "No payment details required" },
  fr: { explore: "Explorer", library: "Bibliothèque vidéo", news: "Actualités GTA VI", creators: "Créateurs", studio: "Studio IA", marketplace: "Marketplace", pricing: "Offres", signIn: "Connexion", join: "Rejoindre le hub", eyebrow: "LE RÉSEAU DES CRÉATEURS", hero: "Faites de Vice City", hero2: "votre terrain de jeu.", intro: "Découvrez des vidéos GTA VI pensées pour les créateurs, préparez vos formats courts et développez votre audience.", browse: "Explorer la bibliothèque", learn: "Découvrir la plateforme", featured: "Vidéos à la une", featuredSub: "Des séquences sélectionnées pour vos prochains montages.", latest: "Les dernières nouvelles de Vice City", latestSub: "Actualités avec sources identifiées, sans présenter les rumeurs comme des faits.", tools: "Tout ce qu’il faut aux créateurs", toolsSub: "Un espace dédié à la découverte, la création et la croissance.", plans: "Des offres simples. Plus de liberté.", plansSub: "Commencez gratuitement. Évoluez selon vos besoins.", free: "Gratuit", starter: "Starter", pro: "Pro", premium: "Premium", month: "/ mois", freeDesc: "Découvrez la bibliothèque et votre méthode de travail.", starterDesc: "Plus de liberté pour les créateurs réguliers.", proDesc: "Pour publier régulièrement.", premiumDesc: "Pour vendre et développer votre activité.", startFree: "Commencer gratuitement", choose: "Choisir l’offre", note: "Plateforme de fans indépendante. Non affiliée à Rockstar Games ou Take-Two Interactive.", demo: "Le catalogue charge les vidéos publiées. Les téléchargements sont autorisés côté serveur et nécessitent un stockage privé configuré.", search: "Rechercher vidéos, sujets ou créateurs…", all: "Tout", cinematic: "Cinématique", gameplay: "Gameplay", edits: "Packs de montage", open: "Ouvrir la rubrique", soon: "Bientôt disponible", monthly: "5 téléchargements / mois", noCharge: "Aucune carte bancaire requise" },
  es: { explore: "Explorar", library: "Biblioteca de vídeo", news: "Noticias GTA VI", creators: "Creadores", studio: "Estudio IA", social: "Redes sociales", shop: "Tienda", pricing: "Planes", signIn: "Iniciar sesión", join: "Unirse al hub", eyebrow: "LA RED DE CREADORES", hero: "Haz de Vice City", hero2: "tu patio de recreo.", intro: "Descubre vídeos de GTA VI para creadores, prepara contenido corto y crece con una comunidad dedicada.", browse: "Explorar biblioteca", learn: "Explorar plataforma", featured: "Vídeos destacados", featuredSub: "Clips seleccionados para tu próxima edición.", latest: "Lo último de Vice City", latestSub: "Noticias con fuentes identificadas; los rumores no son hechos.", tools: "Todo lo que necesitan los creadores", toolsSub: "Un espacio para descubrir, crear y crecer.", plans: "Planes sencillos. Más libertad.", plansSub: "Empieza gratis y mejora cuando lo necesites.", free: "Gratis", starter: "Starter", pro: "Pro", premium: "Premium", month: "/ mes", freeDesc: "Prueba la biblioteca y encuentra tu flujo de trabajo.", starterDesc: "Más espacio para creadores habituales.", proDesc: "Para creadores constantes.", premiumDesc: "Para creadores listos para crecer.", startFree: "Empezar gratis", choose: "Elegir plan", note: "Plataforma independiente de fans. No afiliada a Rockstar Games ni Take-Two Interactive.", demo: "Los vídeos se publican solo después de verificar los derechos y los archivos.", search: "Buscar vídeos, temas o creadores…", all: "Todo", cinematic: "Cinemáticas", gameplay: "Jugabilidad", edits: "Packs de edición", open: "Abrir sección", soon: "Próximamente", monthly: "5 descargas / mes", noCharge: "Sin datos de pago" },
};
copy.pt = {...copy.en, explore:"Explorar",library:"Biblioteca de vídeos",news:"Notícias GTA VI",creators:"Criadores",studio:"Estúdio IA",social:"Redes sociais",shop:"Loja",pricing:"Planos",signIn:"Entrar",join:"Entrar no hub",eyebrow:"A REDE DE CRIADORES",hero:"Faça de Vice City",hero2:"o seu playground.",intro:"Descubra vídeos GTA VI para criadores, prepare conteúdos curtos e desenvolva a sua audiência.",browse:"Explorar biblioteca",featured:"Vídeos em destaque",latest:"Últimas notícias de Vice City",tools:"Tudo para os criadores",plans:"Planos simples. Mais liberdade.",free:"Grátis",startFree:"Começar grátis",choose:"Escolher plano",note:"Plataforma independente de fãs. Não afiliada à Rockstar Games ou à Take-Two Interactive.",search:"Pesquisar vídeos, temas ou criadores…",all:"Todos",cinematic:"Cinemáticas",gameplay:"Jogabilidade",edits:"Packs de edição",monthly:"5 downloads / mês"};
copy.it = {...copy.en, explore:"Esplora",library:"Libreria video",news:"Notizie GTA VI",creators:"Creator",studio:"Studio IA",social:"Social",shop:"Negozio",pricing:"Piani",signIn:"Accedi",join:"Entra nell'hub",eyebrow:"LA RETE DEI CREATOR",hero:"Fai di Vice City",hero2:"il tuo parco giochi.",intro:"Scopri video GTA VI per creator, prepara contenuti brevi e fai crescere il tuo pubblico.",browse:"Esplora la libreria",featured:"Video in evidenza",latest:"Le ultime notizie da Vice City",tools:"Tutto ciò che serve ai creator",plans:"Piani semplici. Più libertà.",free:"Gratis",startFree:"Inizia gratis",choose:"Scegli il piano",note:"Piattaforma indipendente di fan. Non affiliata a Rockstar Games o Take-Two Interactive.",search:"Cerca video, argomenti o creator…",all:"Tutti",cinematic:"Cinematografici",gameplay:"Gameplay",edits:"Pacchetti di montaggio",monthly:"5 download / mese"};
copy.de = {...copy.en, explore:"Entdecken",library:"Videobibliothek",news:"GTA-VI-News",creators:"Creator",studio:"KI-Studio",social:"Social Media",shop:"Shop",pricing:"Tarife",signIn:"Anmelden",join:"Hub beitreten",eyebrow:"DAS CREATOR-NETZWERK",hero:"Mach Vice City",hero2:"zu deinem Spielplatz.",intro:"Entdecke GTA-VI-Videos für Creator, erstelle Kurzform-Content und baue deine Reichweite aus.",browse:"Bibliothek öffnen",featured:"Ausgewählte Videos",latest:"Neuigkeiten aus Vice City",tools:"Alles für Creator",plans:"Einfache Tarife. Mehr Freiheit.",free:"Kostenlos",startFree:"Kostenlos starten",choose:"Tarif wählen",note:"Unabhängige Fan-Plattform. Keine Verbindung zu Rockstar Games oder Take-Two Interactive.",search:"Videos, Themen oder Creator suchen…",all:"Alle",cinematic:"Filmsequenzen",gameplay:"Gameplay",edits:"Edit-Pakete",monthly:"5 Downloads / Monat"};

const sections = [
  { id: "library", icon: "▧", title: "Video library", desc: "Curated clips, cinematic scenes and creator-ready footage." },
  { id: "studio", icon: "✳", title: "AI creator studio", desc: "Hooks, captions, titles and hashtag ideas for each platform." },
  { id: "news", icon: "◉", title: "GTA VI news desk", desc: "Official updates, press coverage and clearly labelled community reports." },
  { id: "marketplace", icon: "◇", title: "Creator marketplace", desc: "Sell original edits, packs and licensed creator content." },
];


function HomePage() {
  const { isAuthenticated, navigateToLogin, logout } = useAuth();
  const [language, setLanguage] = useState("en");
  const [videoLanguage, setVideoLanguage] = useState("All");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [active, setActive] = useState("explore");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [liveVideos, setLiveVideos] = useState([]);
  const [liveNews, setLiveNews] = useState([]);
  const [livePlans, setLivePlans] = useState([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [downloadMessage, setDownloadMessage] = useState("");
  const t = { ...copy.en, ...(copy[language] || {}) };
  useEffect(() => { getPublicPlans({ data: { currency } }).then((rows) => setLivePlans(Array.isArray(rows) ? rows : [])).catch(() => setLivePlans([])); }, [currency]);
  useEffect(() => { getNewsFeed({ data: { locale: language, limit: 3 } }).then((rows) => setLiveNews(Array.isArray(rows) ? rows : [])).catch(() => setLiveNews([])); }, [language]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const saved = window.localStorage.getItem("vicehub-language");
    if (saved && ["en","fr","es","pt","it","de"].includes(saved)) setLanguage(saved);
    setIsInstalled(window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);
    const handler = event => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  useEffect(() => { window.localStorage.setItem("vicehub-language", language); document.documentElement.lang = language; }, [language]);
  const installApp = async () => {
    if (installPrompt) { installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice?.outcome === "accepted") setIsInstalled(true); setInstallPrompt(null); }
    else setInstallHelp(true);
  };

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
    (videoLanguage === "All" || (v.language || "en") === videoLanguage) &&
    ((v.title || "").toLowerCase().includes(search.toLowerCase()) || (v.category || "").toLowerCase().includes(search.toLowerCase()))
  ), [liveVideos, category, videoLanguage, search]);
  const featuredVideo = liveVideos.find(v => v.is_featured) || liveVideos[0] || null;
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
    const routes = { news: "/news", creators: "/creators", studio: "/studio", shop: "/shop", social: "/social", pricing: "/#plans" };
    if (routes[id]) { window.location.assign(routes[id]); return; }
    setActive(id); setNotice("");
    if (id === "library") document.getElementById("library")?.scrollIntoView({ behavior: "smooth" });
  };
  
  const planCards = [
    {tier:"free",name:t.free,priceText:"FREE",desc:t.freeDesc,features:[t.monthly,"Curated library access","Community browsing"],cta:t.startFree},
    {tier:"starter",name:t.starter,desc:t.starterDesc,features:["Expanded monthly downloads","Clean downloads where licensed","Creator tools"],cta:t.choose},
    {tier:"pro",name:t.pro,desc:t.proDesc,features:["Higher download allowance","AI content workspace","Priority library access"],cta:t.choose},
    {tier:"premium",name:t.premium,desc:t.premiumDesc,features:["Marketplace seller access","Creator subscriptions","Sales and audience insights"],cta:t.choose}
  ].map((p)=>{const configured=livePlans.find((x)=>x.tier_code===p.tier);return {...p,priceText:p.tier==="free"?"FREE":configured?new Intl.NumberFormat("en-US",{style:"currency",currency}).format(configured.monthly_price_cents/100):"Pricing pending"};});
  return (
    <div className="hub-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("explore")} aria-label="GTA6 Creator Hub home"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>CREATOR NETWORK</small></span></button>
        <nav className="main-nav" aria-label="Main navigation">
          {["explore", "library", "news", "creators", "studio", "social", "shop", "pricing"].map((id) => <button key={id} className={active === id ? "nav-link active" : "nav-link"} onClick={() => navigate(id)}>{t[id] || id}</button>)}
        </nav>
        <div className="top-actions">
          <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option><option value="pt">PT</option><option value="it">IT</option><option value="de">DE</option></select>
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select>
          <button className="sign-in" onClick={() => isAuthenticated ? logout() : navigateToLogin()}>{isAuthenticated ? "Sign out" : t.signIn}</button>
          {!isInstalled && <button className="install-app-btn" onClick={installApp}>{installPrompt ? "INSTALL APP ↓" : "ADD TO PHONE +"}</button>}
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
          <div className="hero-art hero-art-rebuilt" aria-label="Vice City inspired cinematic creator artwork">
            <div className="hero-image-wash" /><div className="hero-sun" />
            <div className="hero-cityline"><i/><i/><i/><i/><i/><i/><i/><i/></div>
            <div className="hero-character-silhouette"><span>VICE</span><b>HUB</b></div>
            <div className="hero-art-label"><span>VICEHUB / 06</span><b>YOUR CITY. YOUR CUT.</b><small>THE CREATOR NETWORK</small></div>
          </div>
          <div className="hero-bottom"><span>BUILT FOR THE NEXT GENERATION OF GTA VI CREATORS</span><span>01 / 04 <b>—</b> VICE CITY</span></div>
        </section>

        <section className="section library-section" id="library">
          <div className="section-head"><div><div className="eyebrow">01 / CONTENT LIBRARY</div><h2>{t.featured}</h2><p>{t.featuredSub}</p></div><button className="outline-btn" onClick={() => navigate("library")}>{t.open} <span>↗</span></button></div>
          <div className="video-moment-shell">{featuredVideo && <article className="video-moment-card"><div className="video-moment-media">{featuredVideo.thumbnail_url && <img src={featuredVideo.thumbnail_url} alt="" loading="lazy"/>}<span>VIDEO OF THE MOMENT</span><b>{featuredVideo.title}</b></div><div className="video-moment-info"><div><small>{featuredVideo.category} · {(featuredVideo.language || "en").toUpperCase()}</small><h3>{featuredVideo.description || "The latest featured creator footage."}</h3></div><button className="primary-btn" onClick={() => downloadVideo(featuredVideo)}>DOWNLOAD ↗</button></div></article>}</div>
          <div className="library-tools"><div className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} /></div><div className="filters">{["All", "Cinematics", "Gameplay", "Characters", "Vehicles", "Locations", "Missions", "Shorts", "Edit packs"].map((c) => <button key={c} className={category === c ? "filter active" : "filter"} onClick={() => setCategory(c)}>{c}</button>)}</div><select aria-label="Filter videos by language" className="video-language-filter" value={videoLanguage} onChange={e=>setVideoLanguage(e.target.value)}><option value="All">All languages</option><option value="en">English</option><option value="fr">Français</option><option value="es">Español</option><option value="pt">Português</option><option value="it">Italiano</option><option value="de">Deutsch</option></select></div>
          <div className="video-grid">{filtered.map((v, i) => <article className="video-card" key={v.id}><div className={`video-art ${["sunset","neon","coast","pink"][i % 4]}`}>{v.thumbnail_url && <img className="video-thumb" src={v.thumbnail_url} alt="" loading="lazy" />}<span className="video-tag">{(v.category || "VIDEO").toUpperCase()}</span>{v.is_featured && <span className="video-featured-tag">FEATURED</span>}<span className="play-mark">▶</span><span className="video-length">{v.duration_seconds ? Math.floor(v.duration_seconds / 60) + ":" + String(v.duration_seconds % 60).padStart(2, "0") : "VIDEO"}</span><div className="art-caption">VICE CITY<br /><b>CREATOR SERIES</b></div></div><div className="video-meta"><div><h3>{v.title}</h3><p>{v.category || "GTA VI"} <span>·</span> {(v.language || "en").toUpperCase()} <span>·</span> {v.creator_name || "Creator Hub"}</p></div><button aria-label={`Download ${v.title}`} onClick={() => downloadVideo(v)}>↓</button></div></article>)}{!isLoadingVideos && filtered.length === 0 && <div className="empty-library">{language === "fr" ? "Aucune vidéo publiée pour le moment. Le catalogue sera alimenté après validation des droits et des fichiers." : language === "es" ? "Todavía no hay vídeos publicados. El catálogo se completará cuando se verifiquen los derechos y los archivos." : "No videos published yet. The library will populate after rights and video files are verified."}</div>}{isLoadingVideos && <div className="empty-library">Loading the live catalogue…</div>}</div>{downloadMessage && <div className="demo-note" role="status">{downloadMessage}</div>}
        </section>

        <section className="news-section">
          <div className="section-head"><div><div className="eyebrow">02 / THE NEWSROOM</div><h2>{t.latest}</h2><p>{t.latestSub}</p></div><button className="outline-btn" onClick={() => navigate("news")}>{t.open} <span>↗</span></button></div>
          <div className="news-grid">{liveNews.map((story, i) => <article className="news-card" key={story.id} onClick={() => window.location.assign("/news")}><div className="news-index">0{i + 1}<span> / {story.confidence?.toUpperCase()}</span></div><div className="story-type">{story.source_name}</div><h3>{story.title}</h3><p>{story.summary}</p><div className="story-source"><span>↗</span>{story.source_type}</div></article>)}{!liveNews.length && <div className="empty-library">The newsroom is ready. Published stories will appear here after editorial review.</div>}</div>
        </section>

        <section className="features-section"><div className="section-head"><div><div className="eyebrow">03 / CREATOR WORKSPACE</div><h2>{t.tools}</h2><p>{t.toolsSub}</p></div></div><div className="feature-grid">{sections.map((item, i) => <button className="feature-card" key={item.id} onClick={() => navigate(item.id)}><div className="feature-top"><span className="feature-icon">{item.icon}</span><span>0{i + 1} / 04</span></div><h3>{item.title}</h3><p>{item.desc}</p><span className="feature-link">{t.open} ↗</span></button>)}</div></section>

        <section id="plans" className="pricing-section"><div className="pricing-intro"><div className="eyebrow">04 / MEMBERSHIP</div><h2>{t.plans}</h2><p>{t.plansSub}</p><div className="currency-note">DISPLAY CURRENCY <b>{currency}</b><small>Prices appear in the selected currency when configured by the administrator. Checkout is not active yet.</small></div></div><div className="plans-grid">
          {planCards.map((plan,i)=><article className={i===2?"plan-card highlighted":"plan-card"} key={plan.name}><div className="plan-name">{plan.name}{i===2&&<span>POPULAR</span>}</div><div className="plan-price">{plan.priceText}<small>{plan.tier==="free"?"":t.month}</small></div><p>{plan.desc}</p><ul>{plan.features.map(f=><li key={f}><span>✓</span>{f}</li>)}</ul><button className={i===2?"primary-btn full":"outline-btn full"} onClick={() => setNotice("Subscription checkout is not connected yet. Prices and loyalty discounts will be configured before sales open.")}>{plan.cta} <span>↗</span></button></article>)}
        </div><p className="loyalty-note"><span>✳</span> Loyalty reductions and minimum prices are configurable by the administrator. Uninterrupted paid months increase the discount; voluntary cancellation resets the introductory price. Billing remains disabled until Stripe is connected.</p></section>
      </main>

      <footer className="footer"><div className="footer-brand"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span></span></div><p>{t.note}</p><div className="footer-links"><button onClick={() => window.location.assign("/terms")}>Terms</button><button onClick={() => window.location.assign("/privacy")}>Privacy</button><button onClick={() => window.location.assign("/copyright")}>Copyright</button></div><div className="gta-disclaimer">VICEHUB IS AN INDEPENDENT, UNOFFICIAL CREATOR PLATFORM. IT IS NOT AFFILIATED WITH, ENDORSED BY OR SPONSORED BY ROCKSTAR GAMES OR TAKE-TWO INTERACTIVE. GRAND THEFT AUTO, GTA VI, VICE CITY, LEONIDA, CHARACTERS, LOGOS AND GAME ASSETS ARE THE PROPERTY OF THEIR RESPECTIVE RIGHTS HOLDERS. CONTENT IS PUBLISHED ONLY WHERE DISTRIBUTION RIGHTS HAVE BEEN VERIFIED.</div><small>© 2026 VICEHUB. INDEPENDENT CREATOR PLATFORM.</small></footer>
      {installHelp && <div className="install-help-backdrop" role="presentation" onClick={()=>setInstallHelp(false)}><section className="install-help-panel" role="dialog" aria-modal="true" aria-label="Install VICEHUB" onClick={e=>e.stopPropagation()}><button className="text-btn" onClick={()=>setInstallHelp(false)}>CLOSE ×</button><h2>TAKE VICEHUB WITH YOU.</h2><p>Android: open your browser menu and choose “Install app” or “Add to Home screen”. iPhone: tap Share, then “Add to Home Screen”.</p></section></div>}
    </div>
  );
}
