import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import "@/styles/video-library.css";
import { getVideoPreviewUrl, listPublishedVideosPage, requestVideoDownload, getPublicFreeSamplePack } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";
import { useLocale } from "@/lib/i18n";

export const Route = createFileRoute("/library")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Video Library — VICEHUB" },
      { name: "description", content: "Explore the VICEHUB GTA VI video library: verified footage, cinematics, gameplay, shorts and creator edit packs." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: VideoLibraryPage,
});

const categories = ["All", "Cinematics", "Gameplay", "Characters", "Vehicles", "Locations", "Missions", "Shorts", "Edit packs", "Tutorials", "Other"];
const languages = ["All", "en", "fr", "es", "pt", "it", "de"];
const words = {
  en: { kicker:"THE DROP ZONE / VERIFIED VIDEO LIBRARY", title:"FIND YOUR NEXT", titleAccent:"ICONIC MOMENT.", intro:"A curated GTA VI creator library. Discover cinematic footage, gameplay, locations and short-form drops — then preview and download within your membership.", search:"Search titles, creators or tags…", category:"CATEGORY", language:"LANGUAGE", all:"All", featured:"VIDEO OF THE MOMENT", latest:"LATEST DROPS", results:"RESULTS", loading:"Loading the catalogue…", empty:"No videos match these filters. Try another category or language.", more:"LOAD MORE VIDEOS", end:"YOU'VE REACHED THE END OF THE LIBRARY.", preview:"WATCH PREVIEW", download:"DOWNLOAD", creator:"CREATOR", rights:"RIGHTS VERIFIED", close:"CLOSE", preparing:"Preparing secure watermarked preview…", previewError:"The preview is temporarily unavailable.", downloadError:"Download could not be authorised.", minutes:"MIN", noImage:"VICEHUB / VERIFIED DROP" },
  fr: { kicker:"THE DROP ZONE / BIBLIOTHÈQUE VÉRIFIÉE", title:"TROUVEZ VOTRE PROCHAIN", titleAccent:"MOMENT ICONIQUE.", intro:"Une bibliothèque GTA VI sélectionnée pour les créateurs. Découvrez cinématiques, gameplay, lieux et formats courts, puis prévisualisez et téléchargez selon votre abonnement.", search:"Rechercher un titre, créateur ou hashtag…", category:"CATÉGORIE", language:"LANGUE", all:"Tout", featured:"VIDÉO DU MOMENT", latest:"DERNIERS CONTENUS", results:"RÉSULTATS", loading:"Chargement du catalogue…", empty:"Aucune vidéo ne correspond à ces filtres. Essayez une autre catégorie ou langue.", more:"CHARGER PLUS DE VIDÉOS", end:"VOUS ÊTES AU BOUT DE LA BIBLIOTHÈQUE.", preview:"VOIR L'APERÇU", download:"TÉLÉCHARGER", creator:"CRÉATEUR", rights:"DROITS VÉRIFIÉS", close:"FERMER", preparing:"Préparation de l'aperçu protégé…", previewError:"L'aperçu est temporairement indisponible.", downloadError:"Le téléchargement n'a pas pu être autorisé.", minutes:"MIN", noImage:"VICEHUB / CONTENU VÉRIFIÉ" },
  es: { kicker:"THE DROP ZONE / BIBLIOTECA VERIFICADA", title:"ENCUENTRA TU PRÓXIMO", titleAccent:"MOMENTO ICÓNICO.", intro:"Una biblioteca GTA VI seleccionada para creadores. Descubre cinemáticas, gameplay, ubicaciones y clips cortos; previsualiza y descarga según tu membresía.", search:"Buscar títulos, creadores o etiquetas…", category:"CATEGORÍA", language:"IDIOMA", all:"Todo", featured:"VÍDEO DEL MOMENTO", latest:"ÚLTIMOS VÍDEOS", results:"RESULTADOS", loading:"Cargando catálogo…", empty:"No hay vídeos para estos filtros. Prueba otra categoría o idioma.", more:"CARGAR MÁS VÍDEOS", end:"HAS LLEGADO AL FINAL DE LA BIBLIOTECA.", preview:"VER VISTA PREVIA", download:"DESCARGAR", creator:"CREADOR", rights:"DERECHOS VERIFICADOS", close:"CERRAR", preparing:"Preparando vista previa protegida…", previewError:"La vista previa no está disponible temporalmente.", downloadError:"No se pudo autorizar la descarga.", minutes:"MIN", noImage:"VICEHUB / VÍDEO VERIFICADO" },
  pt: { kicker:"THE DROP ZONE / BIBLIOTECA VERIFICADA", title:"ENCONTRE O SEU PRÓXIMO", titleAccent:"MOMENTO ICÓNICO.", intro:"Uma biblioteca GTA VI selecionada para criadores. Descubra cinemáticas, gameplay, locais e vídeos curtos; pré-visualize e transfira conforme a sua subscrição.", search:"Pesquisar títulos, criadores ou etiquetas…", category:"CATEGORIA", language:"IDIOMA", all:"Todos", featured:"VÍDEO DO MOMENTO", latest:"VÍDEOS RECENTES", results:"RESULTADOS", loading:"A carregar a biblioteca…", empty:"Não existem vídeos para estes filtros. Experimente outra categoria ou idioma.", more:"CARREGAR MAIS VÍDEOS", end:"CHEGOU AO FIM DA BIBLIOTECA.", preview:"VER PRÉ-VISUALIZAÇÃO", download:"TRANSFERIR", creator:"CRIADOR", rights:"DIREITOS VERIFICADOS", close:"FECHAR", preparing:"A preparar pré-visualização protegida…", previewError:"A pré-visualização está temporariamente indisponível.", downloadError:"Não foi possível autorizar a transferência.", minutes:"MIN", noImage:"VICEHUB / VÍDEO VERIFICADO" },
  it: { kicker:"THE DROP ZONE / LIBRERIA VERIFICATA", title:"TROVA IL TUO PROSSIMO", titleAccent:"MOMENTO ICONICO.", intro:"Una libreria GTA VI selezionata per i creator. Scopri cinematiche, gameplay, luoghi e clip brevi; visualizza e scarica in base al tuo abbonamento.", search:"Cerca titoli, creator o tag…", category:"CATEGORIA", language:"LINGUA", all:"Tutti", featured:"VIDEO DEL MOMENTO", latest:"ULTIMI VIDEO", results:"RISULTATI", loading:"Caricamento della libreria…", empty:"Nessun video corrisponde ai filtri. Prova un'altra categoria o lingua.", more:"CARICA ALTRI VIDEO", end:"HAI RAGGIUNTO LA FINE DELLA LIBRERIA.", preview:"GUARDA ANTEPRIMA", download:"SCARICA", creator:"CREATOR", rights:"DIRITTI VERIFICATI", close:"CHIUDI", preparing:"Preparazione dell'anteprima protetta…", previewError:"Anteprima temporaneamente non disponibile.", downloadError:"Download non autorizzato.", minutes:"MIN", noImage:"VICEHUB / VIDEO VERIFICATO" },
  de: { kicker:"THE DROP ZONE / GEPRÜFTE VIDEOBIBLIOTHEK", title:"FINDE DEINEN NÄCHSTEN", titleAccent:"IKONISCHEN MOMENT.", intro:"Eine kuratierte GTA-VI-Bibliothek für Creator. Entdecke Cinematics, Gameplay, Orte und Kurzclips und lade sie gemäß deiner Mitgliedschaft herunter.", search:"Titel, Creator oder Tags suchen…", category:"KATEGORIE", language:"SPRACHE", all:"Alle", featured:"VIDEO DES MOMENTS", latest:"NEUESTE VIDEOS", results:"ERGEBNISSE", loading:"Bibliothek wird geladen…", empty:"Keine Videos passen zu diesen Filtern. Wähle eine andere Kategorie oder Sprache.", more:"WEITERE VIDEOS LADEN", end:"DU HAST DAS ENDE DER BIBLIOTHEK ERREICHT.", preview:"VORSCHAU ANSEHEN", download:"HERUNTERLADEN", creator:"CREATOR", rights:"RECHTE GEPRÜFT", close:"SCHLIESSEN", preparing:"Geschützte Vorschau wird vorbereitet…", previewError:"Vorschau vorübergehend nicht verfügbar.", downloadError:"Download konnte nicht autorisiert werden.", minutes:"MIN", noImage:"VICEHUB / GEPRÜFTER DROP" },
};

function VideoLibraryPage() {
  const { isAuthenticated } = useAuth();
  const locale = useLocale();
  const t = words[locale] || words.en;
  const [category, setCategory] = useState("All");
  const [language, setLanguage] = useState("All");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const requestSequence = useRef(0);
  const [videos, setVideos] = useState([]);
  const [samplePack, setSamplePack] = useState({ready:false,videos:[]});
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");

  useEffect(() => { getPublicFreeSamplePack().then(setSamplePack).catch(() => setSamplePack({ready:false,videos:[]})); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(async ({ reset = false } = {}) => {
    const requestId = ++requestSequence.current;
    const nextOffset = reset ? 0 : offset;
    if (reset) setLoading(true); else setLoadingMore(true);
    setError("");
    try {
      const result = await listPublishedVideosPage({
        data: {
          category: category === "All" ? undefined : category,
          language: language === "All" ? undefined : language,
          search: debouncedQuery || undefined,
          offset: nextOffset,
          limit: 24,
        },
      });
      if (requestId !== requestSequence.current) return;
      setVideos(current => reset ? result.videos : [...current, ...result.videos]);
      setOffset(result.nextOffset);
      setHasMore(result.hasMore);
    } catch (err) {
      if (requestId === requestSequence.current) setError(err?.message || "The video catalogue could not be loaded.");
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [category, language, debouncedQuery, offset]);

  useEffect(() => {
    setVideos([]);
    setOffset(0);
    setHasMore(false);
    fetchPage({ reset: true });
  }, [category, language, debouncedQuery]);

  const filtered = videos;

  const featured = videos.find(video => video.is_featured) || videos[0] || null;
  const gridVideos = filtered.filter(video => video.id !== featured?.id);
  const openPreview = async video => {
    setSelected(video);
    setPreviewUrl("");
    setPreviewMessage(t.preparing);
    try {
      const result = await getVideoPreviewUrl({ data: { videoId: video.id } });
      setPreviewUrl(result.previewUrl);
      setPreviewMessage("");
    } catch (err) {
      setPreviewMessage(err?.message || t.previewError);
    }
  };
  const download = async video => {
    setDownloadMessage("");
    try {
      const result = await requestVideoDownload({ data: { videoId: video.id } });
      window.location.assign(result.downloadUrl);
    } catch (err) {
      setDownloadMessage(err?.message || t.downloadError);
    }
  };
  const closePreview = () => {
    setSelected(null);
    setPreviewUrl("");
    setPreviewMessage("");
  };
  const categoryLabel = value => value === "All" ? t.all : value;
  const languageLabel = value => value === "All" ? t.all : ({en:"English",fr:"Français",es:"Español",pt:"Português",it:"Italiano",de:"Deutsch"}[value] || value);
  const formatDuration = seconds => seconds ? Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") : "VIDEO";

  return <SiteFrame eyebrow="VICEHUB / VIDEO LIBRARY" workspace={isAuthenticated} activeKey="library">
    <div className="vh-lib2-page">
      <div className="vh-lib2-ticker"><span>VICEHUB / THE DROP ZONE</span><b>GTA VI CREATOR LIBRARY</b><span>CURATED FOOTAGE · CINEMATICS · GAMEPLAY · SHORTS</span></div>
      <section className="vh-lib2-hero">
        <div className="vh-lib2-hero-copy">
          <span className="vh-lib2-kicker"><i/> THE GTA VI CREATOR DESTINATION</span>
          <h1>YOUR NEXT<br/><em>VIRAL MOMENT.</em></h1>
          <p>{t.intro}</p>
          <div className="vh-lib2-hero-actions"><a href="#vh-lib2-catalog">EXPLORE THE DROPS <b>↘</b></a><span>VICE CITY · LEONIDA · 2026</span></div>
          <div className="vh-lib2-stats"><div><b>{videos.length.toString().padStart(2,"0")}</b><span>AVAILABLE DROPS</span></div><div><b>9:16</b><span>CREATOR READY</span></div><div><b>06</b><span>LANGUAGES</span></div></div>
        </div>
        <div className="vh-lib2-hero-art"><div className="vh-lib2-art-frame"><img src={featured?.thumbnail_url || "https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=3840"} alt="GTA VI Vice City artwork"/><span className="vh-lib2-art-tag">VICEHUB ORIGINALS</span><span className="vh-lib2-art-caption"><small>THE DROP ZONE</small><b>MADE FOR THE FEED.</b></span></div></div>
        <span className="vh-lib2-hero-index">V / 06</span>
      </section>
      <section className="vh-lib2-free-pack">
        <div className="vh-lib2-free-pack-head"><div><span className="vh-lib2-kicker">FREE CREATOR STARTER PACK / 01</span><h2>TRY THE DROP ZONE. <em>ON US.</em></h2><p>Create a free account and download the same three selected videos as every other new member. One download per video, once per account.</p></div><span className="vh-lib2-free-pack-stamp">3 FREE<br/>DOWNLOADS</span></div>
        {samplePack.ready ? <div className="vh-lib2-free-pack-grid">{samplePack.videos.map((video,index)=><article className="vh-lib2-free-pack-card" key={video.id}><div className="vh-lib2-free-pack-image">{video.thumbnail_url?<img src={video.thumbnail_url} alt={video.title} loading="lazy"/>:<img src="/vicehub-news-placeholder.svg" alt="VICEHUB video preview"/>}<span>FREE DROP 0{index+1}</span></div><div><small>{video.category} · {(video.language||"en").toUpperCase()}</small><b>{video.title}</b><p>{video.description}</p></div></article>)}</div> : <div className="vh-lib2-free-pack-empty">The three fixed sample videos will appear here as soon as the rights-cleared pack is selected and published. The same three videos will be offered to every new account.</div>}
        <Link to={isAuthenticated?"/dashboard":"/register"} className="vh-lib2-free-pack-cta">{isAuthenticated?"OPEN YOUR FREE SAMPLE PACK":"CREATE A FREE ACCOUNT TO DOWNLOAD"} ↗</Link>
      </section>
      <section className="vh-lib2-feature">
        <div className="vh-lib2-section-label"><span>01 / EDITOR'S SELECTION</span><b>{t.featured}</b></div>
        {featured ? <button type="button" className="vh-lib2-feature-card" onClick={() => openPreview(featured)}>
          <div className="vh-lib2-feature-image">{featured.thumbnail_url ? <img src={featured.thumbnail_url} alt={featured.title}/> : <img src="https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=3840" alt="Vice City artwork"/>}<span className="vh-lib2-feature-play">▶</span></div>
          <div className="vh-lib2-feature-copy"><span className="vh-lib2-kicker">FEATURED DROP · {(featured.language || "en").toUpperCase()}</span><h2>{featured.title}</h2><p>{featured.creator_name || "VICEHUB COMMUNITY"} <span>·</span> {featured.category || "GTA VI"}</p><b>{t.preview} <i>↗</i></b></div>
        </button> : <div className="vh-lib2-feature-empty">{loading ? t.loading : t.empty}</div>}
      </section>
      <section className="vh-lib2-catalog" id="vh-lib2-catalog">
        <div className="vh-lib2-catalog-head"><div><span className="vh-lib2-kicker">02 / BROWSE THE COLLECTION</span><h2>THE <em>LATEST DROPS.</em></h2><p>Find the right footage. Preview it. Download it. Create.</p></div><span className="vh-lib2-result-count">{filtered.length.toString().padStart(2,"0")} <small>{t.results}</small></span></div>
        <div className="vh-lib2-filter-panel">
          <label className="vh-lib2-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t.search}/></label>
          <label className="vh-lib2-language"><span>{t.language}</span><select value={language} onChange={event => setLanguage(event.target.value)}>{languages.map(value => <option key={value} value={value}>{languageLabel(value)}</option>)}</select></label>
        </div>
        <div className="vh-lib2-categories" aria-label={t.category}>{categories.map(value => <button key={value} type="button" className={category === value ? "active" : ""} onClick={() => setCategory(value)}>{categoryLabel(value)}</button>)}</div>
        {error && <div className="vh-lib2-alert" role="alert">{error}</div>}{downloadMessage && <div className="vh-lib2-alert" role="status">{downloadMessage}</div>}
        <div className="vh-lib2-grid">{loading && videos.length === 0 ? <div className="vh-lib2-empty">{t.loading}</div> : filtered.length === 0 ? <div className="vh-lib2-empty">{t.empty}</div> : gridVideos.map((video,index) => <article className="vh-lib2-card" key={video.id}>
          <button type="button" className="vh-lib2-poster" onClick={() => openPreview(video)} aria-label={t.preview + ": " + video.title}>
            {video.thumbnail_url ? <img src={video.thumbnail_url} alt={video.title} loading="lazy"/> : <div className="vh-lib2-poster-fallback"><img src={index%2===0 ? "https://www.rockstargames.com/VI/_next/static/media/Lucia_Caminos_12.0saq9ns-~xj03.jpg?akim=1&imdensity=1&imwidth=3840" : "https://www.rockstargames.com/VI/_next/static/media/VINTAGE_VICE_CITY_PACK_01.05zaof7o1uz.3.jpg?akim=1&imdensity=1&imwidth=3840"} alt="GTA VI artwork"/><b>VICEHUB</b></div>}
            <span className="vh-lib2-poster-number">{String(index+1).padStart(2,"0")}</span><span className="vh-lib2-poster-duration">{formatDuration(video.duration_seconds)}</span><span className="vh-lib2-poster-play">▶</span>
          </button>
          <div className="vh-lib2-card-info"><div className="vh-lib2-card-meta"><span>{video.category || "GTA VI"}</span><span>{(video.language || "en").toUpperCase()}</span></div><h3>{video.title}</h3><p>{video.creator_name || "VICEHUB COMMUNITY"}</p><div className="vh-lib2-card-actions"><button type="button" onClick={() => openPreview(video)}>{t.preview}</button><button type="button" onClick={() => download(video)}>{t.download} ↓</button></div></div>
        </article>)}</div>
        <div className="vh-lib2-pagination">{hasMore ? <button type="button" onClick={() => fetchPage()} disabled={loadingMore}>{loadingMore ? t.loading : t.more} ↗</button> : !loading && videos.length > 0 ? <span>{t.end}</span> : null}</div>
      </section>
      <section className="vh-lib2-bottom-banner"><div><span className="vh-lib2-kicker">VICEHUB / CREATOR HQ</span><h2>MAKE THE CITY<br/><em>YOUR CONTENT.</em></h2></div><a href="/dashboard">ENTER CREATOR HQ ↗</a></section>
    </div>
    {selected && <div className="vh-lib2-modal-backdrop" role="presentation" onClick={closePreview}><section className="vh-lib2-modal" role="dialog" aria-modal="true" aria-label={selected.title} onClick={event => event.stopPropagation()}>
      <div className="vh-lib2-modal-head"><div><span>{t.rights}</span><h2>{selected.title}</h2></div><button type="button" onClick={closePreview} aria-label={t.close}>×</button></div>
      {previewUrl ? <video className="vh-lib2-player" src={previewUrl} controls playsInline autoPlay/> : <div className="vh-lib2-preview-loading">{previewMessage}</div>}
      <div className="vh-lib2-modal-meta"><span>{t.creator}: {selected.creator_name || "VICEHUB COMMUNITY"}</span><span>{selected.category} · {(selected.language || "en").toUpperCase()}</span></div>
      <div className="vh-lib2-modal-actions"><button type="button" onClick={closePreview}>{t.close}</button><button type="button" onClick={() => download(selected)}>{t.download} ↓</button></div>
      {!isAuthenticated && <p className="vh-lib2-modal-note">Sign in to download videos and manage your monthly allowance.</p>}
    </section></div>}
  </SiteFrame>;
}
