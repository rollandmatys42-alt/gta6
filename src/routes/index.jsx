import { useEffect, useMemo, useState } from "react";
import { listPublishedVideos, getVideoPreviewUrl, requestVideoDownload, getNewsFeed, getPublicPlans, createStripeCheckoutSession } from "@/lib/server-fns";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";
import { setSiteLocale } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VICEHUB — The GTA VI Creator Universe" },
      { name: "description", content: "The GTA VI creator universe: discover cinematic footage, short-form drops, creator profiles and tools for your next edit." },
      { name: "theme-color", content: "#09090d" },
      { property: "og:title", content: "VICEHUB — The GTA VI Creator Universe" },
      { property: "og:description", content: "The GTA VI creator universe: discover cinematic footage, short-form drops, creator profiles and tools for your next edit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }, { rel: "icon", href: "/icons/vicehub.svg", type: "image/svg+xml" }, { rel: "canonical", href: "https://gta6-creator-hub-c26cc578.base44.app/" }],
  }),
  component: HomePage,
});

const copy = {
  en:{explore:"Explore",library:"Video library",news:"GTA VI news",creators:"Creators",studio:"AI studio",social:"Social planner",shop:"Shop",pricing:"Plans",signIn:"Sign in",signOut:"Sign out",join:"Join VICEHUB",myAccount:"My account",eyebrow:"THE CREATOR NETWORK",hero:"Enter the world",hero2:"of GTA VI.",intro:"Discover cinematic footage, explore Leonida, follow the latest stories and build content made for your audience.",browse:"Explore the library",learn:"Explore the platform",featured:"Featured footage",featuredSub:"Curated clips and scenes for your next edit.",latest:"The latest from Vice City",latestSub:"Source-labelled updates. Rumours are never presented as facts.",tools:"Everything creators need",toolsSub:"One focused workspace for discovery, production and growth.",plans:"Simple plans. More creative freedom.",plansSub:"Start free. Upgrade when your workflow needs more.",free:"Free",starter:"Starter",pro:"Pro",premium:"Premium",month:"/ month",freeDesc:"Try the library and find your workflow.",starterDesc:"More room for regular creators.",proDesc:"For creators publishing consistently.",premiumDesc:"For creators ready to grow.",startFree:"Start for free",choose:"Choose plan",note:"Independent fan platform. Not affiliated with Rockstar Games or Take-Two Interactive.",search:"Search videos, topics or creators…",all:"All",cinematic:"Cinematics",gameplay:"Gameplay",characters:"Characters",vehicles:"Vehicles",locations:"Locations",missions:"Missions",shorts:"Shorts",edits:"Edit packs",open:"Open section",soon:"Coming soon",monthly:"5 downloads / month",noCharge:"No payment details required",discover:"DISCOVER",create:"CREATE",grow:"GROW",videoMoment:"VIDEO OF THE MOMENT",latestDrops:"LATEST DROPS",viewDetails:"VIEW DETAILS",creatorLabel:"CREATOR",licensedLabel:"RIGHTS VERIFIED",closeDetails:"CLOSE",allLanguages:"All languages",loading:"Loading the live catalogue…",noVideos:"No videos published yet. The catalogue will appear after rights and files are verified.",noNews:"The newsroom is ready. Approved stories will appear here after editorial review.",libraryLabel:"01 / CONTENT LIBRARY",newsLabel:"02 / THE NEWSROOM",workspaceLabel:"03 / CREATOR WORKSPACE",membershipLabel:"04 / MEMBERSHIP",communityBrowsing:"Curated library access",expandedDownloads:"Expanded monthly downloads",cleanDownloads:"Clean downloads where licensed",creatorTools:"Creator tools",higherAllowance:"Higher download allowance",aiWorkspace:"AI content workspace",priorityAccess:"Priority library access",directSocial:"Direct social publishing when approved",analytics:"Creator analytics",advancedAllowance:"Advanced download allowance",currencyLabel:"DISPLAY CURRENCY",pricePending:"Pricing pending",checkoutDisabled:"Prices appear here when configured. Checkout is not active yet.",popular:"POPULAR",loyaltyNote:"Loyalty reductions and minimum prices are configurable by the administrator. Billing remains disabled until payment processing is configured.",terms:"Terms",privacy:"Privacy",copyright:"Copyright",footerLegal:"VICEHUB IS AN INDEPENDENT, UNOFFICIAL CREATOR PLATFORM. IT IS NOT AFFILIATED WITH, ENDORSED BY OR SPONSORED BY ROCKSTAR GAMES OR TAKE-TWO INTERACTIVE. GRAND THEFT AUTO, GTA VI, VICE CITY, LEONIDA, CHARACTERS, LOGOS AND GAME ASSETS ARE THE PROPERTY OF THEIR RESPECTIVE RIGHTS HOLDERS. CONTENT IS PUBLISHED ONLY WHERE DISTRIBUTION RIGHTS HAVE BEEN VERIFIED.",footerCopyright:"© 2026 VICEHUB. INDEPENDENT CREATOR PLATFORM.",install:"ADD TO PHONE +",installNow:"INSTALL APP ↓",close:"CLOSE ×",installTitle:"TAKE VICEHUB WITH YOU.",installAndroid:"Android: open your browser menu and choose “Install app” or “Add to Home screen”.",installIos:"iPhone: tap Share, then “Add to Home Screen”.",download:"DOWNLOAD ↗",loadingPlans:"Prices are not configured yet.",currencyInfo:"Select your display currency."},
  fr:{explore:"Explorer",library:"Bibliothèque vidéo",news:"Actualités GTA VI",creators:"Créateurs",studio:"Studio IA",social:"Planificateur social",shop:"Boutique",pricing:"Offres",signIn:"Connexion",signOut:"Déconnexion",join:"Rejoindre VICEHUB",myAccount:"Mon compte",eyebrow:"LE RÉSEAU DES CRÉATEURS",hero:"Entrez dans l’univers",hero2:"de GTA VI.",intro:"Explorez Leonida, découvrez des vidéos cinématiques, suivez les actualités et créez des contenus pour votre audience.",browse:"Explorer la bibliothèque",learn:"Découvrir la plateforme",featured:"Vidéos à la une",featuredSub:"Des séquences sélectionnées pour vos prochains montages.",latest:"Les dernières nouvelles de Vice City",latestSub:"Des actualités avec sources identifiées. Les rumeurs ne sont jamais présentées comme des faits.",tools:"Tout ce qu’il faut aux créateurs",toolsSub:"Un espace dédié à la découverte, la production et la croissance.",plans:"Des offres simples. Plus de liberté.",plansSub:"Commencez gratuitement et évoluez selon vos besoins.",free:"Gratuit",starter:"Starter",pro:"Pro",premium:"Premium",month:"/ mois",freeDesc:"Découvrez la bibliothèque et votre méthode de travail.",starterDesc:"Plus de possibilités pour les créateurs réguliers.",proDesc:"Pour publier régulièrement.",premiumDesc:"Pour développer votre activité.",startFree:"Commencer gratuitement",choose:"Choisir l’offre",note:"Plateforme de fans indépendante. Non affiliée à Rockstar Games ni à Take-Two Interactive.",search:"Rechercher des vidéos, sujets ou créateurs…",all:"Tout",cinematic:"Cinématiques",gameplay:"Gameplay",characters:"Personnages",vehicles:"Véhicules",locations:"Lieux",missions:"Missions",shorts:"Formats courts",edits:"Packs de montage",open:"Ouvrir la rubrique",soon:"Bientôt disponible",monthly:"5 téléchargements / mois",noCharge:"Aucune carte bancaire requise",discover:"DÉCOUVRIR",create:"CRÉER",grow:"DÉVELOPPER",videoMoment:"VIDÉO DU MOMENT",latestDrops:"DERNIERS CONTENUS",viewDetails:"VOIR LES DÉTAILS",creatorLabel:"CRÉATEUR",licensedLabel:"DROITS VÉRIFIÉS",closeDetails:"FERMER",allLanguages:"Toutes les langues",loading:"Chargement du catalogue…",noVideos:"Aucune vidéo publiée pour le moment. Le catalogue sera alimenté après vérification des droits et des fichiers.",noNews:"La rédaction est prête. Les articles validés apparaîtront après contrôle éditorial.",libraryLabel:"01 / BIBLIOTHÈQUE VIDÉO",newsLabel:"02 / ACTUALITÉS",workspaceLabel:"03 / ESPACE CRÉATEUR",membershipLabel:"04 / ABONNEMENT",communityBrowsing:"Accès à la bibliothèque sélectionnée",expandedDownloads:"Plus de téléchargements mensuels",cleanDownloads:"Téléchargements sans filigrane si autorisés",creatorTools:"Outils pour créateurs",higherAllowance:"Quota de téléchargement supérieur",aiWorkspace:"Espace de création IA",priorityAccess:"Accès prioritaire à la bibliothèque",directSocial:"Publication directe si autorisée",analytics:"Statistiques créateur",advancedAllowance:"Quota de téléchargement avancé",currencyLabel:"DEVISE D’AFFICHAGE",pricePending:"Tarif à définir",checkoutDisabled:"Les tarifs apparaîtront ici après configuration. Le paiement n’est pas encore activé.",popular:"POPULAIRE",loyaltyNote:"Les réductions de fidélité et les prix minimums sont configurables par l’administrateur. La facturation reste désactivée tant que le paiement n’est pas configuré.",terms:"Conditions",privacy:"Confidentialité",copyright:"Droits d’auteur",footerLegal:"VICEHUB EST UNE PLATEFORME INDÉPENDANTE ET NON OFFICIELLE POUR LES CRÉATEURS. ELLE N’EST NI AFFILIÉE, NI APPROUVÉE, NI SPONSORISÉE PAR ROCKSTAR GAMES OU TAKE-TWO INTERACTIVE. GRAND THEFT AUTO, GTA VI, VICE CITY, LEONIDA, LES PERSONNAGES, LOGOS ET ÉLÉMENTS DU JEU APPARTIENNENT À LEURS TITULAIRES RESPECTIFS. LES CONTENUS NE SONT PUBLIÉS QUE SI LES DROITS DE DISTRIBUTION ONT ÉTÉ VÉRIFIÉS.",footerCopyright:"© 2026 VICEHUB. PLATEFORME INDÉPENDANTE POUR CRÉATEURS.",install:"AJOUTER AU TÉLÉPHONE +",installNow:"INSTALLER L’APP ↓",close:"FERMER ×",installTitle:"EMMENEZ VICEHUB AVEC VOUS.",installAndroid:"Android : ouvrez le menu du navigateur et choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».",installIos:"iPhone : touchez Partager, puis « Sur l’écran d’accueil ».",download:"TÉLÉCHARGER ↗",loadingPlans:"Les tarifs ne sont pas encore configurés.",currencyInfo:"Choisissez votre devise d’affichage."},
  es:{explore:"Explorar",library:"Biblioteca de vídeos",news:"Noticias GTA VI",creators:"Creadores",studio:"Estudio IA",social:"Planificador social",shop:"Tienda",pricing:"Planes",signIn:"Iniciar sesión",signOut:"Cerrar sesión",join:"Unirse a VICEHUB",myAccount:"Mi cuenta",eyebrow:"LA RED DE CREADORES",hero:"Haz de Vice City",hero2:"tu patio de recreo.",intro:"Descubre vídeos de GTA VI para creadores, prepara contenido corto y amplía tu audiencia.",browse:"Explorar biblioteca",learn:"Explorar plataforma",featured:"Vídeos destacados",featuredSub:"Clips seleccionados para tu próxima edición.",latest:"Lo último de Vice City",latestSub:"Noticias con fuentes identificadas. Los rumores nunca se presentan como hechos.",tools:"Todo lo que necesitan los creadores",toolsSub:"Un espacio para descubrir, producir y crecer.",plans:"Planes sencillos. Más libertad.",plansSub:"Empieza gratis y mejora cuando lo necesites.",free:"Gratis",starter:"Starter",pro:"Pro",premium:"Premium",month:"/ mes",freeDesc:"Prueba la biblioteca y encuentra tu flujo de trabajo.",starterDesc:"Más espacio para creadores habituales.",proDesc:"Para creadores constantes.",premiumDesc:"Para creadores que quieren crecer.",startFree:"Empezar gratis",choose:"Elegir plan",note:"Plataforma independiente de fans. No afiliada a Rockstar Games ni Take-Two Interactive.",search:"Buscar vídeos, temas o creadores…",all:"Todo",cinematic:"Cinemáticas",gameplay:"Jugabilidad",characters:"Personajes",vehicles:"Vehículos",locations:"Ubicaciones",missions:"Misiones",shorts:"Vídeos cortos",edits:"Packs de edición",open:"Abrir sección",soon:"Próximamente",monthly:"5 descargas / mes",noCharge:"Sin datos de pago",discover:"DESCUBRIR",create:"CREAR",grow:"CRECER",videoMoment:"VÍDEO DEL MOMENTO",allLanguages:"Todos los idiomas",loading:"Cargando el catálogo…",noVideos:"Todavía no hay vídeos publicados. El catálogo se completará cuando se verifiquen los derechos y los archivos.",noNews:"La redacción está lista. Las noticias aprobadas aparecerán tras la revisión editorial.",libraryLabel:"01 / BIBLIOTECA DE VÍDEOS",newsLabel:"02 / ACTUALIDAD",workspaceLabel:"03 / ESPACIO DEL CREADOR",membershipLabel:"04 / MEMBRESÍA",communityBrowsing:"Acceso a la biblioteca seleccionada",expandedDownloads:"Más descargas mensuales",cleanDownloads:"Descargas sin marca de agua cuando estén autorizadas",creatorTools:"Herramientas para creadores",higherAllowance:"Mayor límite de descargas",aiWorkspace:"Espacio de creación con IA",priorityAccess:"Acceso prioritario a la biblioteca",directSocial:"Publicación directa cuando esté aprobada",analytics:"Estadísticas de creador",advancedAllowance:"Límite avanzado de descargas",currencyLabel:"MONEDA DE VISUALIZACIÓN",pricePending:"Precio pendiente",checkoutDisabled:"Los precios aparecerán aquí cuando se configuren. El pago aún no está activo.",popular:"POPULAR",loyaltyNote:"El administrador puede configurar los descuentos por fidelidad y los precios mínimos. La facturación seguirá desactivada hasta configurar los pagos.",terms:"Condiciones",privacy:"Privacidad",copyright:"Derechos de autor",footerLegal:"VICEHUB ES UNA PLATAFORMA INDEPENDIENTE Y NO OFICIAL PARA CREADORES. NO ESTÁ AFILIADA, RESPALDADA NI PATROCINADA POR ROCKSTAR GAMES O TAKE-TWO INTERACTIVE. GRAND THEFT AUTO, GTA VI, VICE CITY, LEONIDA, LOS PERSONAJES, LOGOTIPOS Y ELEMENTOS DEL JUEGO PERTENECEN A SUS TITULARES. EL CONTENIDO SOLO SE PUBLICA CUANDO SE HAN VERIFICADO LOS DERECHOS DE DISTRIBUCIÓN.",footerCopyright:"© 2026 VICEHUB. PLATAFORMA INDEPENDIENTE PARA CREADORES.",install:"AÑADIR AL MÓVIL +",installNow:"INSTALAR APP ↓",close:"CERRAR ×",installTitle:"LLEVA VICEHUB CONTIGO.",installAndroid:"Android: abre el menú del navegador y elige «Instalar aplicación» o «Añadir a pantalla de inicio».",installIos:"iPhone: toca Compartir y después «Añadir a pantalla de inicio».",download:"DESCARGAR ↗"},
  pt:{explore:"Explorar",library:"Biblioteca de vídeos",news:"Notícias GTA VI",creators:"Criadores",studio:"Estúdio IA",social:"Planeador social",shop:"Loja",pricing:"Planos",signIn:"Entrar",signOut:"Sair",join:"Entrar no VICEHUB",myAccount:"A minha conta",eyebrow:"A REDE DE CRIADORES",hero:"Faça de Vice City",hero2:"o seu recreio.",intro:"Descubra vídeos GTA VI para criadores, prepare conteúdos curtos e aumente a sua audiência.",browse:"Explorar biblioteca",learn:"Conhecer a plataforma",featured:"Vídeos em destaque",featuredSub:"Clips selecionados para a sua próxima edição.",latest:"As últimas novidades de Vice City",latestSub:"Notícias com fontes identificadas. Os rumores nunca são apresentados como factos.",tools:"Tudo o que os criadores precisam",toolsSub:"Um espaço para descobrir, produzir e crescer.",plans:"Planos simples. Mais liberdade.",plansSub:"Comece gratuitamente e evolua quando precisar.",free:"Grátis",starter:"Starter",pro:"Pro",premium:"Premium",month:"/ mês",freeDesc:"Explore a biblioteca e encontre o seu fluxo de trabalho.",starterDesc:"Mais espaço para criadores regulares.",proDesc:"Para criadores que publicam regularmente.",premiumDesc:"Para criadores que querem crescer.",startFree:"Começar grátis",choose:"Escolher plano",note:"Plataforma independente de fãs. Não afiliada à Rockstar Games nem à Take-Two Interactive.",search:"Pesquisar vídeos, temas ou criadores…",all:"Todos",cinematic:"Cinemáticas",gameplay:"Jogabilidade",characters:"Personagens",vehicles:"Veículos",locations:"Locais",missions:"Missões",shorts:"Vídeos curtos",edits:"Packs de edição",open:"Abrir secção",soon:"Brevemente",monthly:"5 downloads / mês",noCharge:"Sem dados de pagamento",discover:"DESCOBRIR",create:"CRIAR",grow:"CRESCER",videoMoment:"VÍDEO DO MOMENTO",allLanguages:"Todos os idiomas",loading:"A carregar a biblioteca…",noVideos:"Ainda não existem vídeos publicados. A biblioteca será preenchida após a verificação dos direitos e ficheiros.",noNews:"A redação está pronta. As notícias aprovadas serão apresentadas após revisão editorial.",libraryLabel:"01 / BIBLIOTECA DE VÍDEOS",newsLabel:"02 / NOTÍCIAS",workspaceLabel:"03 / ESPAÇO DO CRIADOR",membershipLabel:"04 / MEMBRESIA",communityBrowsing:"Acesso à biblioteca selecionada",expandedDownloads:"Mais downloads mensais",cleanDownloads:"Downloads sem marca de água quando autorizados",creatorTools:"Ferramentas para criadores",higherAllowance:"Limite de downloads superior",aiWorkspace:"Espaço de criação com IA",priorityAccess:"Acesso prioritário à biblioteca",directSocial:"Publicação direta quando aprovada",analytics:"Estatísticas do criador",advancedAllowance:"Limite avançado de downloads",currencyLabel:"MOEDA DE VISUALIZAÇÃO",pricePending:"Preço por definir",checkoutDisabled:"Os preços serão apresentados após configuração. Os pagamentos ainda não estão ativos.",popular:"POPULAR",loyaltyNote:"Os descontos de fidelidade e os preços mínimos são configuráveis pelo administrador. A faturação permanece desativada até configurar os pagamentos.",terms:"Termos",privacy:"Privacidade",copyright:"Direitos de autor",footerLegal:"O VICEHUB É UMA PLATAFORMA INDEPENDENTE E NÃO OFICIAL PARA CRIADORES. NÃO É AFILIADA, ENDOSSADA OU PATROCINADA PELA ROCKSTAR GAMES OU TAKE-TWO INTERACTIVE. GRAND THEFT AUTO, GTA VI, VICE CITY, LEONIDA, PERSONAGENS, LOGÓTIPOS E ELEMENTOS DO JOGO PERTENCEM AOS RESPETIVOS TITULARES. O CONTEÚDO SÓ É PUBLICADO QUANDO OS DIREITOS DE DISTRIBUIÇÃO ESTÃO VERIFICADOS.",footerCopyright:"© 2026 VICEHUB. PLATAFORMA INDEPENDENTE PARA CRIADORES.",install:"ADICIONAR AO TELEMÓVEL +",installNow:"INSTALAR APP ↓",close:"FECHAR ×",installTitle:"LEVE O VICEHUB CONSIGO.",installAndroid:"Android: abra o menu do navegador e escolha «Instalar aplicação» ou «Adicionar ao ecrã inicial».",installIos:"iPhone: toque em Partilhar e depois «Adicionar ao ecrã principal».",download:"DESCARREGAR ↗"},
  it:{explore:"Esplora",library:"Libreria video",news:"Notizie GTA VI",creators:"Creator",studio:"Studio IA",social:"Pianificatore social",shop:"Negozio",pricing:"Piani",signIn:"Accedi",signOut:"Esci",join:"Entra in VICEHUB",myAccount:"Il mio account",eyebrow:"LA RETE DEI CREATOR",hero:"Fai di Vice City",hero2:"il tuo parco giochi.",intro:"Scopri video GTA VI per creator, prepara contenuti brevi e fai crescere il tuo pubblico.",browse:"Esplora la libreria",learn:"Scopri la piattaforma",featured:"Video in evidenza",featuredSub:"Clip selezionate per il tuo prossimo montaggio.",latest:"Le ultime notizie da Vice City",latestSub:"Notizie con fonti identificate. Le indiscrezioni non sono mai presentate come fatti.",tools:"Tutto ciò che serve ai creator",toolsSub:"Uno spazio dedicato a scoperta, produzione e crescita.",plans:"Piani semplici. Più libertà.",plansSub:"Inizia gratis e passa a un piano superiore quando serve.",free:"Gratis",starter:"Starter",pro:"Pro",premium:"Premium",month:"/ mese",freeDesc:"Prova la libreria e trova il tuo flusso di lavoro.",starterDesc:"Più spazio per i creator abituali.",proDesc:"Per creator che pubblicano con costanza.",premiumDesc:"Per creator pronti a crescere.",startFree:"Inizia gratis",choose:"Scegli il piano",note:"Piattaforma indipendente di fan. Non affiliata a Rockstar Games né a Take-Two Interactive.",search:"Cerca video, argomenti o creator…",all:"Tutti",cinematic:"Filmati cinematografici",gameplay:"Gameplay",characters:"Personaggi",vehicles:"Veicoli",locations:"Luoghi",missions:"Missioni",shorts:"Video brevi",edits:"Pacchetti di montaggio",open:"Apri sezione",soon:"Prossimamente",monthly:"5 download / mese",noCharge:"Nessun dato di pagamento richiesto",discover:"SCOPRI",create:"CREA",grow:"CRESCI",videoMoment:"VIDEO DEL MOMENTO",allLanguages:"Tutte le lingue",loading:"Caricamento della libreria…",noVideos:"Non ci sono ancora video pubblicati. La libreria sarà disponibile dopo la verifica dei diritti e dei file.",noNews:"La redazione è pronta. Le notizie approvate appariranno dopo la revisione editoriale.",libraryLabel:"01 / LIBRERIA VIDEO",newsLabel:"02 / NOTIZIE",workspaceLabel:"03 / SPAZIO CREATOR",membershipLabel:"04 / ABBONAMENTO",communityBrowsing:"Accesso alla libreria selezionata",expandedDownloads:"Più download mensili",cleanDownloads:"Download senza filigrana se autorizzati",creatorTools:"Strumenti per creator",higherAllowance:"Limite di download superiore",aiWorkspace:"Spazio creativo IA",priorityAccess:"Accesso prioritario alla libreria",directSocial:"Pubblicazione diretta quando approvata",analytics:"Statistiche creator",advancedAllowance:"Limite di download avanzato",currencyLabel:"VALUTA DI VISUALIZZAZIONE",pricePending:"Prezzo da definire",checkoutDisabled:"I prezzi appariranno qui dopo la configurazione. I pagamenti non sono ancora attivi.",popular:"POPOLARE",loyaltyNote:"Gli sconti fedeltà e i prezzi minimi sono configurabili dall’amministratore. La fatturazione resta disattivata finché i pagamenti non sono configurati.",terms:"Termini",privacy:"Privacy",copyright:"Copyright",footerLegal:"VICEHUB È UNA PIATTAFORMA INDIPENDENTE E NON UFFICIALE PER CREATOR. NON È AFFILIATA, APPROVATA O SPONSORIZZATA DA ROCKSTAR GAMES O TAKE-TWO INTERACTIVE. GRAND THEFT AUTO, GTA VI, VICE CITY, LEONIDA, PERSONAGGI, LOGHI ED ELEMENTI DEL GIOCO APPARTENGONO AI RISPETTIVI TITOLARI. I CONTENUTI SONO PUBBLICATI SOLO DOPO LA VERIFICA DEI DIRITTI DI DISTRIBUZIONE.",footerCopyright:"© 2026 VICEHUB. PIATTAFORMA INDIPENDENTE PER CREATOR.",install:"AGGIUNGI AL TELEFONO +",installNow:"INSTALLA APP ↓",close:"CHIUDI ×",installTitle:"PORTA VICEHUB CON TE.",installAndroid:"Android: apri il menu del browser e scegli «Installa app» o «Aggiungi alla schermata Home».",installIos:"iPhone: tocca Condividi, poi «Aggiungi alla schermata Home».",download:"SCARICA ↗"},
  de:{explore:"Entdecken",library:"Videobibliothek",news:"GTA-VI-News",creators:"Creator",studio:"KI-Studio",social:"Social-Planer",shop:"Shop",pricing:"Tarife",signIn:"Anmelden",signOut:"Abmelden",join:"VICEHUB beitreten",myAccount:"Mein Konto",eyebrow:"DAS CREATOR-NETZWERK",hero:"Mach Vice City",hero2:"zu deinem Spielplatz.",intro:"Entdecke GTA-VI-Videos für Creator, erstelle Kurzform-Content und baue deine Reichweite aus.",browse:"Bibliothek entdecken",learn:"Plattform entdecken",featured:"Ausgewählte Videos",featuredSub:"Ausgewählte Clips und Szenen für deinen nächsten Schnitt.",latest:"Neuigkeiten aus Vice City",latestSub:"Nachrichten mit Quellenangaben. Gerüchte werden nicht als Fakten dargestellt.",tools:"Alles, was Creator brauchen",toolsSub:"Ein zentraler Arbeitsbereich zum Entdecken, Produzieren und Wachsen.",plans:"Einfache Tarife. Mehr Freiheit.",plansSub:"Starte kostenlos und erweitere deinen Tarif bei Bedarf.",free:"Kostenlos",starter:"Starter",pro:"Pro",premium:"Premium",month:"/ Monat",freeDesc:"Entdecke die Bibliothek und deinen Workflow.",starterDesc:"Mehr Möglichkeiten für regelmäßige Creator.",proDesc:"Für Creator, die regelmäßig veröffentlichen.",premiumDesc:"Für Creator, die wachsen möchten.",startFree:"Kostenlos starten",choose:"Tarif wählen",note:"Unabhängige Fan-Plattform. Keine Verbindung zu Rockstar Games oder Take-Two Interactive.",search:"Videos, Themen oder Creator suchen…",all:"Alle",cinematic:"Filmszenen",gameplay:"Gameplay",characters:"Charaktere",vehicles:"Fahrzeuge",locations:"Orte",missions:"Missionen",shorts:"Kurzvideos",edits:"Schnittpakete",open:"Bereich öffnen",soon:"Demnächst",monthly:"5 Downloads / Monat",noCharge:"Keine Zahlungsdaten erforderlich",discover:"ENTDECKEN",create:"ERSTELLEN",grow:"WACHSEN",videoMoment:"VIDEO DES TAGES",allLanguages:"Alle Sprachen",loading:"Videobibliothek wird geladen…",noVideos:"Noch keine Videos veröffentlicht. Die Bibliothek wird nach Prüfung der Rechte und Dateien gefüllt.",noNews:"Die Redaktion ist bereit. Freigegebene Beiträge erscheinen nach der redaktionellen Prüfung.",libraryLabel:"01 / VIDEOBIBLIOTHEK",newsLabel:"02 / NEWSROOM",workspaceLabel:"03 / CREATOR-BEREICH",membershipLabel:"04 / MITGLIEDSCHAFT",communityBrowsing:"Zugang zur ausgewählten Bibliothek",expandedDownloads:"Mehr Downloads pro Monat",cleanDownloads:"Downloads ohne Wasserzeichen, sofern lizenziert",creatorTools:"Creator-Tools",higherAllowance:"Höheres Download-Limit",aiWorkspace:"KI-Content-Arbeitsbereich",priorityAccess:"Bevorzugter Bibliothekszugang",directSocial:"Direktveröffentlichung nach Freigabe",analytics:"Creator-Analysen",advancedAllowance:"Erweitertes Download-Limit",currencyLabel:"ANZEIGEWÄHRUNG",pricePending:"Preis folgt",checkoutDisabled:"Preise werden nach der Konfiguration angezeigt. Zahlungen sind noch nicht aktiviert.",popular:"BELIEBT",loyaltyNote:"Treuerabatte und Mindestpreise werden vom Administrator festgelegt. Die Abrechnung bleibt deaktiviert, bis die Zahlungsabwicklung eingerichtet ist.",terms:"Nutzungsbedingungen",privacy:"Datenschutz",copyright:"Urheberrecht",footerLegal:"VICEHUB IST EINE UNABHÄNGIGE, INOFFIZIELLE CREATOR-PLATTFORM. SIE IST NICHT MIT ROCKSTAR GAMES ODER TAKE-TWO INTERACTIVE VERBUNDEN, WIRD NICHT VON IHNEN UNTERSTÜTZT ODER GESPONSERT. GRAND THEFT AUTO, GTA VI, VICE CITY, LEONIDA, FIGUREN, LOGOS UND SPIELINHALTE GEHÖREN DEN JEWEILIGEN RECHTEINHABERN. INHALTE WERDEN NUR VERÖFFENTLICHT, WENN DIE VERBREITUNGSRECHTE GEPRÜFT WURDEN.",footerCopyright:"© 2026 VICEHUB. UNABHÄNGIGE CREATOR-PLATTFORM.",install:"ZUM HANDY HINZUFÜGEN +",installNow:"APP INSTALLIEREN ↓",close:"SCHLIESSEN ×",installTitle:"NIMM VICEHUB MIT.",installAndroid:"Android: Öffne das Browsermenü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.",installIos:"iPhone: Tippe auf Teilen und dann auf „Zum Home-Bildschirm“.",download:"HERUNTERLADEN ↗"}
};
const sections = [
  { id: "library", icon: "▧", titleKey: "library", descKey: "featuredSub" },
  { id: "studio", icon: "✳", titleKey: "studio", descKey: "toolsSub" },
  { id: "news", icon: "◉", titleKey: "news", descKey: "latestSub" },
];


function HomePage() {
  const { isAuthenticated, navigateToLogin, logout } = useAuth();
  const [language, setLanguage] = useState(() => {
    if (typeof window === "undefined") return "en";
    const saved = window.localStorage.getItem("vicehub-language");
    return saved && ["en","fr","es","pt","it","de"].includes(saved) ? saved : "en";
  });
  const [videoLanguage, setVideoLanguage] = useState("All");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [active, setActive] = useState("explore");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState("");
  const [liveVideos, setLiveVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [liveNews, setLiveNews] = useState([]);
  const [livePlans, setLivePlans] = useState([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [faqOpen, setFaqOpen] = useState(0);
  const t = { ...copy.en, ...(copy[language] || {}) };
  useEffect(() => { getPublicPlans({ data: { currency } }).then((rows) => setLivePlans(Array.isArray(rows) ? rows : [])).catch(() => setLivePlans([])); }, [currency]);
  useEffect(() => { getNewsFeed({ data: { locale: language, limit: 3 } }).then((rows) => setLiveNews(Array.isArray(rows) ? rows : [])).catch(() => setLiveNews([])); }, [language]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
     setIsInstalled(window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);
    const handler = event => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  useEffect(() => { setSiteLocale(language); }, [language]);
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
    ((v.title || "").toLowerCase().includes(search.toLowerCase()) || (v.category || "").toLowerCase().includes(search.toLowerCase()) || (v.creator_name || "").toLowerCase().includes(search.toLowerCase()) || (Array.isArray(v.tags) && v.tags.some(tag => String(tag).toLowerCase().includes(search.toLowerCase()))))
  ), [liveVideos, category, videoLanguage, search]);
  const featuredVideo = liveVideos.find(v => v.is_featured) || liveVideos[0] || null;
  const shortVideos = liveVideos.filter(v => ["Shorts","Edit packs"].includes(v.category));
  const topCreators = Object.values(liveVideos.reduce((acc, video) => { const name = (video.creator_name || "VICEHUB Creator").trim(); acc[name] = acc[name] || {name,count:0,video}; acc[name].count += 1; return acc; }, {})).sort((a,b) => b.count-a.count).slice(0,5);
  const reactionVideos = liveVideos.slice(0,4);
  const feedVideos = liveVideos.slice(0,8);
  const startCheckout = async (plan) => {
    if (!isAuthenticated) { navigateToLogin(); return; }
    if (!plan.checkoutReady) { setNotice(t.pricePending); return; }
    setCheckoutBusy(plan.tier); setNotice("");
    try {
      const result = await createStripeCheckoutSession({ data: { tierCode: plan.tier, currency } });
      window.location.assign(result.url);
    } catch (error) {
      setNotice(error?.message || "Secure checkout could not be opened.");
      setCheckoutBusy("");
    }
  };
  const openVideoDetails = async (video) => {
    setSelectedVideo(video); setPreviewUrl(""); setPreviewMessage("Preparing secure watermarked preview…");
    try { const result = await getVideoPreviewUrl({ data: { videoId: video.id } }); setPreviewUrl(result.previewUrl); setPreviewMessage(""); }
    catch (error) { setPreviewMessage(error?.message || "Preview is temporarily unavailable."); }
  };
  const closeVideoDetails = () => { setSelectedVideo(null); setPreviewUrl(""); setPreviewMessage(""); };
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
    {tier:"free",name:t.free,priceText:"FREE",desc:t.freeDesc,features:[t.monthly,t.communityBrowsing],cta:t.startFree},
    {tier:"starter",name:t.starter,desc:t.starterDesc,features:[t.expandedDownloads,t.cleanDownloads,t.creatorTools],cta:t.choose},
    {tier:"pro",name:t.pro,desc:t.proDesc,features:[t.higherAllowance,t.aiWorkspace,t.priorityAccess],cta:t.choose},
    {tier:"premium",name:t.premium,desc:t.premiumDesc,features:[t.directSocial,t.analytics,t.advancedAllowance],cta:t.choose}
  ].map((p)=>{const configured=livePlans.find((x)=>x.tier_code===p.tier);return {...p,priceText:p.tier==="free"?"FREE":configured?new Intl.NumberFormat(language,{style:"currency",currency}).format(configured.monthly_price_cents/100):t.pricePending,checkoutReady:!!configured&&Number(configured.monthly_price_cents)>0};});
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
          <button className="sign-in" onClick={() => isAuthenticated ? logout() : navigateToLogin()}>{isAuthenticated ? t.signOut : t.signIn}</button>
          {!isInstalled && <button className="install-app-btn" onClick={installApp}>{installPrompt ? t.installNow : t.install}</button>}
          <button className="join-btn" onClick={() => isAuthenticated ? window.location.assign("/dashboard") : navigateToLogin()}>{isAuthenticated ? t.myAccount : t.join}<span>↗</span></button>
        </div>
      </header>

      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

      <main>
        <section className="hero vice-landing-hero">
          <img className="vice-hero-photo" src="https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=2400&q=90" alt="Neon-lit coastal city at night" fetchPriority="high" />
          <div className="vice-hero-shade" />
          <div className="hero-copy vice-hero-copy">
            <div className="eyebrow"><span className="live-dot" /> {t.eyebrow} · LEONIDA NETWORK</div>
            <div className="vice-hero-overline">WELCOME TO VICE CITY</div>
            <h1>{t.hero}<br /><em>{t.hero2}</em></h1>
            <p>{t.intro}</p>
            <div className="hero-actions"><button className="primary-btn" onClick={() => navigate("library")}>{t.browse}<span>↗</span></button><button className="text-btn" onClick={() => navigate("news")}>{t.latest} <span>→</span></button></div>
            <div className="hero-proof"><span><b>01</b> {t.discover}</span><i /> <span><b>02</b> {t.create}</span><i /> <span><b>03</b> {t.grow}</span></div>
          </div>
          <div className="vice-hero-side">
            <div className="vice-hero-stamp">VICE<br/><b>HUB</b><small>EST. 2026</small></div>
            <div className="vice-hero-caption"><span>THE CITY IS YOURS</span><b>DISCOVER · CREATE · DROP</b></div>
          </div>
          <div className="hero-bottom"><span>VICEHUB / THE GTA VI CREATOR NETWORK</span><span>26°07' N · 80°08' W <b>—</b> LEONIDA</span></div>
        </section>


        <section className="reference-benefits" aria-label="VICEHUB benefits">
          <div><b>01</b><span>INSTANT VIDEO ACCESS</span><small>Preview and download in one place</small></div>
          <div><b>02</b><span>CREATOR-READY CONTENT</span><small>Curated clips, shorts and edits</small></div>
          <div><b>03</b><span>SECURE CHECKOUT</span><small>Membership when plans are activated</small></div>
          <div><b>04</b><span>MADE FOR THE COMMUNITY</span><small>Creators, fan pages and editors</small></div>
        </section>

        <section className="reference-section reaction-section">
          <div className="reference-section-head"><div><span className="eyebrow">THE INTERNET LOST IT</span><h2>FAMOUS REACTIONS</h2><p>Standout moments and community reactions from the VICEHUB video library.</p></div><span className="reference-index">01 / REACTIONS</span></div>
          <div className="reaction-gallery">
            {reactionVideos.map((video,i)=><button className={`reaction-card reaction-card-${i+1}`} key={video.id} onClick={()=>openVideoDetails(video)}>
              <div className="reference-card-image">{video.thumbnail_url?<img src={video.thumbnail_url} alt={video.title} loading="lazy"/>:<div className="reference-image-fallback"><b>VICEHUB</b><span>{(video.category||"GTA VI").toUpperCase()}</span></div>}<span className="reference-play">▶</span><span className="reference-card-tag">{(video.category||"REACTION").toUpperCase()}</span></div>
              <div className="reference-card-copy"><small>REACTION / 0{i+1}</small><b>{video.title}</b><span>{video.creator_name||"VICEHUB COMMUNITY"} · {(video.language||"en").toUpperCase()}</span></div>
            </button>)}
            {!reactionVideos.length&&<div className="reference-empty"><b>THE NEXT BIG REACTION STARTS HERE.</b><span>Featured community videos will appear as soon as the catalogue is populated.</span></div>}
          </div>
        </section>

        <section className="reference-section shorts-section">
          <div className="reference-section-head"><div><span className="eyebrow">FROM THE SOCIALS</span><h2>SHORTS &amp; REELS</h2><p>Vertical clips, fast edits and moments built for the social feed.</p></div><button className="reference-link" onClick={()=>{setCategory("Shorts");document.getElementById("library")?.scrollIntoView({behavior:"smooth"});}}>EXPLORE SHORTS ↗</button></div>
          <div className="shorts-rail">
            {shortVideos.slice(0,6).map((video,i)=><button className="short-card" key={video.id} onClick={()=>openVideoDetails(video)}>
              <div className="short-poster">{video.thumbnail_url?<img src={video.thumbnail_url} alt={video.title} loading="lazy"/>:<div className="reference-image-fallback"><b>VICEHUB</b><span>SHORT / REEL</span></div>}<span className="short-play">▶</span><small>0{i+1} / SHORT</small></div><b>{video.title}</b><span>{video.creator_name||"VICEHUB CREATOR"}</span>
            </button>)}
            {!shortVideos.length&&<div className="shorts-empty"><div className="shorts-empty-mark">▶</div><b>YOUR NEXT VIRAL CLIP BELONGS HERE.</b><p>Shorts and Reels will appear here when short-form videos are published in the VICEHUB library.</p><button className="outline-btn" onClick={()=>{setCategory("Shorts");document.getElementById("library")?.scrollIntoView({behavior:"smooth"});}}>BROWSE SHORT-FORM CONTENT ↗</button></div>}
          </div>
        </section>


        <section className="section library-section" id="library">
          <div className="section-head"><div><div className="eyebrow">VICEHUB DROP MARKET · RIGHTS-CHECKED VIDEO CATALOGUE</div><h2>BLACK MARKET DROPS</h2><p>Exclusive creator footage, video packs and featured drops. Preview first, then download with your membership allowance.</p></div><button className="outline-btn" onClick={() => navigate("library")}>{t.open} <span>↗</span></button></div>
          <div className="video-moment-shell">{featuredVideo && <article className="video-moment-card"><div className="video-moment-media">{featuredVideo.thumbnail_url && <img src={featuredVideo.thumbnail_url} alt="" loading="lazy"/>}<span>{t.videoMoment}</span><b>{featuredVideo.title}</b></div><div className="video-moment-info"><div><small>{featuredVideo.category} · {(featuredVideo.language || "en").toUpperCase()}</small><h3>{featuredVideo.description || "The latest featured creator footage."}</h3></div><button className="primary-btn" onClick={() => downloadVideo(featuredVideo)}>{t.download}</button></div></article>}</div>
          <div className="library-tools"><div className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} /></div><div className="filters">{[{value:"All",label:t.all},{value:"Cinematics",label:t.cinematic},{value:"Gameplay",label:t.gameplay},{value:"Characters",label:t.characters},{value:"Vehicles",label:t.vehicles},{value:"Locations",label:t.locations},{value:"Missions",label:t.missions},{value:"Shorts",label:t.shorts},{value:"Edit packs",label:t.edits}].map(({value,label}) => <button key={value} className={category === value ? "filter active" : "filter"} onClick={() => setCategory(value)}>{label}</button>)}</div><select aria-label="Filter videos by language" className="video-language-filter" value={videoLanguage} onChange={e=>setVideoLanguage(e.target.value)}><option value="All">{t.allLanguages}</option><option value="en">English</option><option value="fr">Français</option><option value="es">Español</option><option value="pt">Português</option><option value="it">Italiano</option><option value="de">Deutsch</option></select></div>
          <div className="drops-feed-head"><div><span className="eyebrow">HOT RIGHT NOW · NEW CONTENT</span><h3>FRESH DROPS</h3></div><span className="drops-count">{filtered.length} {filtered.length === 1 ? "DROP" : "DROPS"}</span></div><div className="video-grid">{filtered.filter(v => v.id !== featuredVideo?.id).map((v, i) => <article className="video-card drop-card" key={v.id}><button className="drop-open" onClick={() => openVideoDetails(v)} aria-label={`View details for ${v.title}`}><div className={`video-art ${["sunset","neon","coast","pink"][i % 4]}`}>{v.thumbnail_url ? <img className="video-thumb" src={v.thumbnail_url} alt={v.title} loading="lazy" /> : <div className="drop-art-fallback"><span>VICEHUB / DROP {String(i + 1).padStart(2,"0")}</span><b>{(v.category || "GTA VI").toUpperCase()}</b></div>}<span className="video-tag">{(v.category || "VIDEO").toUpperCase()}</span>{v.is_featured && <span className="video-featured-tag">FEATURED</span>}<span className="play-mark">↗</span><span className="video-length">{v.duration_seconds ? Math.floor(v.duration_seconds / 60) + ":" + String(v.duration_seconds % 60).padStart(2, "0") : "VIDEO"}</span></div><div className="video-meta"><div><h3>{v.title}</h3><p>{v.category || "GTA VI"} <span>·</span> {(v.language || "en").toUpperCase()} <span>·</span> {v.creator_name || "Creator Hub"}</p></div><span className="drop-view-label">{t.viewDetails} ↗</span></div></button><div className="drop-card-bottom"><div className="drop-tags">{(Array.isArray(v.tags) ? v.tags : []).slice(0,3).map(tag => <span key={tag}>#{tag}</span>)}</div><button aria-label={`Download ${v.title}`} onClick={() => downloadVideo(v)}>↓</button></div></article>)}{!isLoadingVideos && filtered.length === 0 && <div className="empty-library">{t.noVideos}</div>}{isLoadingVideos && <div className="empty-library">{t.loading}</div>}</div>{downloadMessage && <div className="demo-note" role="status">{downloadMessage}</div>}
        </section>

        <section className="news-section">
          <div className="section-head"><div><div className="eyebrow">02 / THE NEWSROOM</div><h2>{t.latest}</h2><p>{t.latestSub}</p></div><button className="outline-btn" onClick={() => navigate("news")}>{t.open} <span>↗</span></button></div>
          <div className="news-grid">{liveNews.map((story, i) => <article className="news-card" key={story.id} onClick={() => window.location.assign("/news")}><div className="news-index">0{i + 1}<span> / {story.confidence?.toUpperCase()}</span></div><div className="story-type">{story.source_name}</div><h3>{story.title}</h3><p>{story.summary}</p><div className="story-source"><span>↗</span>{story.source_type}</div></article>)}{!liveNews.length && <div className="empty-library">{t.noNews}</div>}</div>
        </section>


        <section className="reference-section reaction-feed-section">
          <div className="reference-section-head"><div><span className="eyebrow">HOT RIGHT NOW</span><h2>REACTION FEED</h2><p>A live-style feed of the newest published VICEHUB drops.</p></div><span className="reference-live">● CATALOGUE LIVE</span></div>
          <div className="reaction-feed">
            {feedVideos.map((video,i)=><button className="feed-row" key={video.id} onClick={()=>openVideoDetails(video)}>
              <span className="feed-number">{String(i+1).padStart(2,"0")}</span>
              <span className="feed-thumb">{video.thumbnail_url?<img src={video.thumbnail_url} alt="" loading="lazy"/>:<b>V</b>}</span>
              <span className="feed-title"><b>{video.title}</b><small>{video.creator_name||"VICEHUB CREATOR"} · {(video.category||"GTA VI").toUpperCase()}</small></span>
              <span className="feed-action">WATCH DROP ↗</span>
            </button>)}
            {!feedVideos.length&&<div className="reference-empty"><b>THE FEED IS WAITING FOR ITS FIRST DROP.</b><span>New videos will appear here automatically after publication.</span></div>}
          </div>
        </section>

        <section className="reference-section how-section">
          <div className="reference-section-head"><div><span className="eyebrow">EASY AS A HEIST</span><h2>HOW IT WORKS</h2><p>Find your footage. Preview the drop. Create something worth watching.</p></div><span className="reference-index">3 STEPS · ONE CREATOR HUB</span></div>
          <div className="how-grid">
            <article><span className="how-number">01</span><div className="how-symbol">⌕</div><h3>PICK A DROP</h3><p>Explore the video library, filter by category and language, and open the footage that fits your next edit.</p><button onClick={()=>document.getElementById("library")?.scrollIntoView({behavior:"smooth"})}>EXPLORE THE LIBRARY ↗</button></article>
            <article><span className="how-number">02</span><div className="how-symbol">▶</div><h3>PREVIEW &amp; DOWNLOAD</h3><p>Watch a protected preview, choose your membership and download content within your monthly allowance.</p><button onClick={()=>document.getElementById("plans")?.scrollIntoView({behavior:"smooth"})}>VIEW MEMBERSHIPS ↗</button></article>
            <article><span className="how-number">03</span><div className="how-symbol">↗</div><h3>MAKE IT YOURS</h3><p>Build your edits, organise your creator workflow and prepare content for your own social channels.</p><button onClick={()=>window.location.assign("/social")}>OPEN CREATOR TOOLS ↗</button></article>
          </div>
        </section>

        <section className="reference-section leaderboard-section">
          <div className="reference-section-head"><div><span className="eyebrow">WHO RUNS LEONIDA?</span><h2>THE LEADERBOARD</h2><p>Discover the creators and fan pages building the VICEHUB community.</p></div><button className="reference-link" onClick={()=>window.location.assign("/creators")}>SEE CREATOR DIRECTORY ↗</button></div>
          <div className="leaderboard-grid">
            <article className="leaderboard-panel"><div className="leaderboard-panel-head"><span>01 / VIDEO CREATORS</span><b>TOP CREATORS</b></div>
              {topCreators.length?topCreators.map((creator,i)=><div className="leaderboard-row" key={creator.name}><span className="leader-rank">{String(i+1).padStart(2,"0")}</span><span className="leader-avatar">{creator.name.slice(0,1).toUpperCase()}</span><span className="leader-name"><b>{creator.name}</b><small>VICEHUB VIDEO CREATOR</small></span><span className="leader-score">{creator.count} {creator.count===1?"DROP":"DROPS"}</span></div>):<div className="leaderboard-empty">Creator rankings will populate automatically as verified creators publish videos.</div>}
            </article>
            <article className="leaderboard-panel"><div className="leaderboard-panel-head"><span>02 / COMMUNITY PAGES</span><b>TOP FAN PAGES</b></div>
              <div className="fanpage-feature"><div className="fanpage-orbit">✦</div><h3>GET SEEN BY GTA FANS.</h3><p>Bring your GTA VI fan page to VICEHUB. Creator and fan-page rankings will be published when verified profiles and ranking data are available.</p><button onClick={()=>window.location.assign("/creators")}>FEATURE YOUR PAGE ↗</button></div>
            </article>
          </div>
        </section>

        <section className="reference-feature-cta">
          <div><span className="eyebrow">YOUR NAME. YOUR COMMUNITY. YOUR LEONIDA.</span><h2>PUT YOUR PAGE<br/><em>ON THE MAP.</em></h2><p>Create your VICEHUB creator profile, publish your work and grow your presence in the GTA VI creator community.</p></div>
          <button className="primary-btn" onClick={()=>isAuthenticated?window.location.assign("/dashboard"):navigateToLogin()}>JOIN THE CREATOR NETWORK ↗</button>
        </section>

        <section className="features-section"><div className="section-head"><div><div className="eyebrow">03 / CREATOR WORKSPACE</div><h2>{t.tools}</h2><p>{t.toolsSub}</p></div></div><div className="feature-grid">{sections.map((item, i) => <button className="feature-card" key={item.id} onClick={() => navigate(item.id)}><div className="feature-top"><span className="feature-icon">{item.icon}</span><span>0{i + 1} / 04</span></div><h3>{t[item.titleKey] || t.studio}</h3><p>{t[item.descKey] || t.latestSub}</p><span className="feature-link">{t.open} ↗</span></button>)}</div></section>

        <section id="plans" className="pricing-section"><div className="pricing-intro"><div className="eyebrow">04 / MEMBERSHIP</div><h2>{t.plans}</h2><p>{t.plansSub}</p><div className="currency-note">{t.currencyLabel} <b>{currency}</b><small>{t.checkoutDisabled}</small></div></div><div className="plans-grid">
          {planCards.map((plan,i)=><article className={i===2?"plan-card highlighted":"plan-card"} key={plan.name}><div className="plan-name">{plan.name}{i===2&&<span>{t.popular}</span>}</div><div className="plan-price">{plan.priceText}<small>{plan.tier==="free"?"":t.month}</small></div><p>{plan.desc}</p><ul>{plan.features.map(f=><li key={f}><span>✓</span>{f}</li>)}</ul><button className={i===2?"primary-btn full":"outline-btn full"} disabled={plan.tier!=="free"&&(!plan.checkoutReady||!!checkoutBusy)} onClick={() => plan.tier==="free" ? (isAuthenticated?window.location.assign("/dashboard"):navigateToLogin()) : startCheckout(plan)}>{checkoutBusy===plan.tier?"OPENING SECURE CHECKOUT…":plan.tier==="free"?plan.cta:plan.checkoutReady?plan.cta:t.pricePending} <span>↗</span></button></article>)}
        </div><p className="loyalty-note"><span>✳</span> {t.loyaltyNote}</p></section>

        <section className="reference-section faq-section">
          <div className="reference-section-head"><div><span className="eyebrow">GOT QUESTIONS?</span><h2>FAQ</h2><p>Everything you need to know before your first drop.</p></div><span className="reference-index">HELP / 01—06</span></div>
          <div className="faq-list">
            {[
              ["What is VICEHUB?","VICEHUB is an independent creator platform for discovering GTA VI-related video content, managing downloads and building a creator workflow. It is not affiliated with Rockstar Games or Take-Two Interactive."],
              ["Can I preview a video before downloading it?","Yes. Published videos with verified distribution rights can be opened in the secure preview player. Download access is subject to your account and monthly allowance."],
              ["How do download allowances work?","Each membership tier has a monthly download allowance. The free tier currently includes five downloads per month. Paid tiers remain unavailable until pricing and checkout are configured."],
              ["Can I publish content on my own social networks?","VICEHUB includes social planning tools. Direct publishing depends on the relevant social platform permissions and connected accounts; it is not represented as active until those connections are configured."],
              ["Can I become a featured creator?","Create an account and build your creator profile. Public rankings and fan-page features will use verified profile and activity data rather than invented rankings."],
              ["Is VICEHUB an official Rockstar website?","No. VICEHUB is independent and unofficial. All trademarks, game assets and intellectual property belong to their respective rights holders."]
            ].map(([question,answer],i)=><article className={faqOpen===i?"faq-item open":"faq-item"} key={question}><button onClick={()=>setFaqOpen(faqOpen===i?-1:i)} aria-expanded={faqOpen===i}><span>{String(i+1).padStart(2,"0")}</span><b>{question}</b><i>{faqOpen===i?"−":"+"}</i></button>{faqOpen===i&&<p>{answer}</p>}</article>)}
          </div>
        </section>
      </main>

{selectedVideo && <div className="drop-modal-backdrop" role="presentation" onClick={closeVideoDetails}><section className="drop-modal" role="dialog" aria-modal="true" aria-label={selectedVideo.title} onClick={e => e.stopPropagation()}><button className="drop-modal-close" onClick={closeVideoDetails} aria-label={t.closeDetails}>×</button><div className="drop-modal-media">{previewUrl ? <video className="drop-preview-player" controls playsInline preload="metadata" poster={selectedVideo.thumbnail_url || undefined} src={previewUrl}>Your browser does not support video playback.</video> : selectedVideo.thumbnail_url ? <img src={selectedVideo.thumbnail_url} alt={selectedVideo.title}/> : <div className="drop-art-fallback"><b>{(selectedVideo.category || "GTA VI").toUpperCase()}</b></div>}<span>{(selectedVideo.category || "VIDEO").toUpperCase()} · {(selectedVideo.language || "en").toUpperCase()}</span></div><div className="drop-modal-copy"><div className="eyebrow">VICEHUB / VERIFIED CATALOGUE</div>{previewMessage && <div className="drop-preview-status" role="status">{previewMessage}</div>}<h2>{selectedVideo.title}</h2><p>{selectedVideo.description || "Creator footage selected for the VICEHUB catalogue."}</p><div className="drop-modal-meta"><span>{t.creatorLabel}: <b>{selectedVideo.creator_name || "VICEHUB CREATOR"}</b></span><span>{selectedVideo.duration_seconds ? Math.floor(selectedVideo.duration_seconds / 60) + ":" + String(selectedVideo.duration_seconds % 60).padStart(2,"0") : "VIDEO"}</span><span>{t.licensedLabel}</span></div>{Array.isArray(selectedVideo.tags) && selectedVideo.tags.length > 0 && <div className="drop-tags">{selectedVideo.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}<div className="drop-modal-actions"><button className="primary-btn" onClick={() => downloadVideo(selectedVideo)}>{t.download} ↗</button>{selectedVideo.source_reference && <a href={selectedVideo.source_reference} target="_blank" rel="noreferrer">SOURCE ↗</a>}</div></div></section></div>}
      <footer className="footer"><div className="footer-brand"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span></span></div><p>{t.note}</p><div className="footer-links"><button onClick={() => window.location.assign("/terms")}>{t.terms}</button><button onClick={() => window.location.assign("/privacy")}>{t.privacy}</button><button onClick={() => window.location.assign("/copyright")}>{t.copyright}</button></div><div className="gta-disclaimer">{t.footerLegal}</div><small>{t.footerCopyright}</small></footer>
      {installHelp && <div className="install-help-backdrop" role="presentation" onClick={()=>setInstallHelp(false)}><section className="install-help-panel" role="dialog" aria-modal="true" aria-label="Install VICEHUB" onClick={e=>e.stopPropagation()}><button className="text-btn" onClick={()=>setInstallHelp(false)}>{t.close}</button><h2>{t.installTitle}</h2><p>{t.installAndroid} {t.installIos}</p></section></div>}
    </div>
  );
}
