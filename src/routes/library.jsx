import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import "@/styles/video-library.css";
import { getVideoPreviewUrl, listPublishedVideosPage, requestVideoDownload } from "@/lib/server-fns";
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
  const [videos, setVideos] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");

  const fetchPage = useCallback(async ({ reset = false } = {}) => {
    const nextOffset = reset ? 0 : offset;
    if (reset) setLoading(true); else setLoadingMore(true);
    setError("");
    try {
      const result = await listPublishedVideosPage({
        data: {
          category: category === "All" ? undefined : category,
          language: language === "All" ? undefined : language,
          offset: nextOffset,
          limit: 24,
        },
      });
      setVideos(current => reset ? result.videos : [...current, ...result.videos]);
      setOffset(result.nextOffset);
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err?.message || "The video catalogue could not be loaded.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [category, language, offset]);

  useEffect(() => {
    setVideos([]);
    setOffset(0);
    setHasMore(false);
    fetchPage({ reset: true });
  }, [category, language]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return videos;
    return videos.filter(video => [
      video.title, video.description, video.creator_name, video.category,
      ...(Array.isArray(video.tags) ? video.tags : []),
    ].filter(Boolean).join(" ").toLowerCase().includes(term));
  }, [videos, query]);

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

  return <SiteFrame eyebrow="VICEHUB / THE DROP ZONE">
    <div className="vh-library-page">
      <section className="vh-library-hero">
        <div className="vh-library-hero-art" aria-hidden="true"><span className="vh-library-sun" /><span className="vh-library-skyline" /><span className="vh-library-palm">✦</span></div>
        <div className="vh-library-hero-copy">
          <span className="vh-library-eyebrow"><i />{t.kicker}</span>
          <h1>{t.title}<br/><em>{t.titleAccent}</em></h1>
          <p>{t.intro}</p>
          <div className="vh-library-hero-meta"><span>VICE CITY · LEONIDA</span><span>CURATED / RIGHTS-CHECKED</span><span>6 LANGUAGES</span></div>
        </div>
        <div className="vh-library-hero-index"><b>VICEHUB</b><span>THE DROP ZONE</span><small>EST. 2026</small></div>
      </section>

      {featured && <section className="vh-featured-video">
        <div className="vh-featured-heading"><span>{t.featured}</span><b>01 / EDITOR'S PICK</b></div>
        <button className="vh-featured-art" onClick={() => openPreview(featured)}>
          {featured.thumbnail_url ? <img src={featured.thumbnail_url} alt={featured.title} /> : <div className="vh-library-placeholder"><b>VICEHUB</b><span>{featured.category?.toUpperCase()}</span></div>}
          <span className="vh-featured-play">▶</span><span className="vh-featured-overlay"><small>{featured.category} · {(featured.language || "en").toUpperCase()}</small><strong>{featured.title}</strong><i>{t.preview} ↗</i></span>
        </button>
      </section>}

      <section className="vh-library-controls">
        <div className="vh-library-controls-top">
          <div><span className="vh-library-eyebrow">{t.category}</span><h2>{t.latest}</h2></div>
          <span className="vh-library-count">{filtered.length} {t.results}</span>
        </div>
        <div className="vh-library-search-row">
          <label className="vh-library-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t.search} /></label>
          <label className="vh-library-select"><span>{t.language}</span><select value={language} onChange={event => setLanguage(event.target.value)}>{languages.map(value => <option key={value} value={value}>{languageLabel(value)}</option>)}</select></label>
        </div>
        <div className="vh-library-categories">{categories.map(value => <button key={value} type="button" className={category === value ? "active" : ""} onClick={() => setCategory(value)}>{categoryLabel(value)}</button>)}</div>
      </section>

      {error && <div className="vh-library-alert" role="alert">{error}</div>}
      {downloadMessage && <div className="vh-library-alert" role="status">{downloadMessage}</div>}
      <section className="vh-library-results">
        {loading && videos.length === 0 ? <div className="vh-library-empty">{t.loading}</div> :
          filtered.length === 0 ? <div className="vh-library-empty">{t.empty}</div> :
          <div className="vh-library-grid">{gridVideos.map((video, index) => <article className="vh-library-card" key={video.id}>
            <button type="button" className="vh-library-card-art" onClick={() => openPreview(video)} aria-label={t.preview + ": " + video.title}>
              {video.thumbnail_url ? <img src={video.thumbnail_url} alt={video.title} loading="lazy" /> : <div className="vh-library-placeholder"><b>VICEHUB</b><span>{(video.category || "GTA VI").toUpperCase()}</span></div>}
              <span className="vh-library-card-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="vh-library-card-duration">{formatDuration(video.duration_seconds)}</span>
              <span className="vh-library-card-play">▶</span>
            </button>
            <div className="vh-library-card-body">
              <div className="vh-library-card-tags"><span>{video.category || "GTA VI"}</span><span>{(video.language || "en").toUpperCase()}</span>{video.is_featured && <b>FEATURED</b>}</div>
              <h3>{video.title}</h3>
              <p>{video.creator_name || "VICEHUB COMMUNITY"}</p>
              <div className="vh-library-card-actions"><button type="button" onClick={() => openPreview(video)}>{t.preview}</button><button type="button" onClick={() => download(video)}>{t.download} ↓</button></div>
            </div>
          </article>)}</div>
        }
      </section>
      <div className="vh-library-pagination">{hasMore ? <button type="button" onClick={() => fetchPage()} disabled={loadingMore}>{loadingMore ? t.loading : t.more} ↗</button> : !loading && videos.length > 0 ? <span>{t.end}</span> : null}</div>
    </div>

    {selected && <div className="vh-preview-backdrop" role="presentation" onClick={closePreview}>
      <section className="vh-preview-modal" role="dialog" aria-modal="true" aria-label={selected.title} onClick={event => event.stopPropagation()}>
        <div className="vh-preview-head"><div><span>{t.rights}</span><h2>{selected.title}</h2></div><button type="button" onClick={closePreview}>×</button></div>
        {previewUrl ? <video className="vh-preview-player" src={previewUrl} controls playsInline autoPlay /> : <div className="vh-preview-loading">{previewMessage}</div>}
        <div className="vh-preview-meta"><span>{t.creator}: {selected.creator_name || "VICEHUB COMMUNITY"}</span><span>{selected.category} · {(selected.language || "en").toUpperCase()}</span></div>
        <div className="vh-preview-actions"><button type="button" className="vh-preview-close" onClick={closePreview}>{t.close}</button><button type="button" className="vh-preview-download" onClick={() => download(selected)}>{t.download} ↓</button></div>
        {!isAuthenticated && <p className="vh-preview-note">Sign in to download videos and manage your monthly allowance.</p>}
      </section>
    </div>}
  </SiteFrame>;
}
