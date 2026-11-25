import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { AuthGateError, requireSignedIn } from "@/components/auth/AuthGate";
import "@/styles/vicehub-admin-console.css";
export const Route = createFileRoute("/admin/vicehub")({ ssr:false, beforeLoad:requireSignedIn, errorComponent:AuthGateError, head:()=>({meta:[{title:"VICEHUB — Video Operations"},{name:"robots",content:"noindex,nofollow"}]}), component:VicehubAdminHome });
const cards=[
["Importer une source","Coller un lien YouTube, Dailymotion, Twitch, Vimeo ou une URL directe.","/admin/import","↗"],
["File de traitement","Suivre analyses, transcriptions, découpages et transferts Drive.","/admin/video-library#jobs","◷"],
["Clips et bibliothèque","Examiner titres, langues, pays, tags, miniatures et scores.","/admin/video-library","▣"],
["Catalogue client","Contrôler les contenus accessibles aux clients.","/library","▤"],
["Stockage et moteur","Accéder aux opérations et diagnostics du worker.","/admin/operations","⌘"],
["Clients et affiliation","Gérer comptes, abonnements, parrains et paiements.","/admin/affiliates","◎"]
];
function VicehubAdminHome(){const {user}=Route.useRouteContext();if(user?.role!=="admin")return <SiteFrame eyebrow="VICEHUB / ACCÈS RESTREINT"><h1>ACCÈS REFUSÉ</h1></SiteFrame>;return <main className="vh-admin-home"><header className="vh-admin-top"><Link to="/" className="vh-admin-brand"><span className="vh-admin-mark">V</span><span>VICEHUB<small>VIDEO OPERATIONS</small></span></Link><span className="vh-admin-user">ADMIN CONNECTÉ · {user.email}</span></header><section className="vh-admin-hero"><div><p className="vh-admin-kicker">COMMAND CENTRE / VIDEO OPERATIONS</p><h1>Votre bibliothèque vidéo.<br/><em>Un seul centre de contrôle.</em></h1><p className="vh-admin-lead">Importez une source, analysez le contenu, sélectionnez les meilleurs extraits et distribuez les clips dans la bibliothèque client.</p></div><Link to="/admin/import" className="vh-admin-primary">＋ Importer une source →</Link></section><section className="vh-admin-grid">{cards.map(([title,description,href,icon],i)=><Link key={href} to={href} className="vh-admin-card"><div className="vh-admin-card-top"><span className="vh-admin-card-icon">{icon}</span><span className="vh-admin-card-index">0{i+1}</span></div><h2>{title}</h2><p>{description}</p><strong>OUVRIR L'ESPACE ↗</strong></Link>)}</section><footer className="vh-admin-footer"><span>VICEHUB · VIDEO LIBRARY MANAGEMENT</span><Link to="/admin">Administration historique</Link></footer></main>}
