import { Link } from "@tanstack/react-router";
import "@/styles/fan-theme.css";
import {useLocale,setSiteLocale,translate} from "@/lib/i18n";

const links=[["/","nav.home"],["/library","nav.library"],["/news","nav.news"],["/creators","nav.creators"],["/shop","nav.shop"],["/studio","nav.studio"],["/social","nav.social"],["/dashboard","nav.account"]];
export default function SiteFrame({children,eyebrow="VICEHUB / GTA VI FAN HQ"}) {
 const locale=useLocale();
 const libraryLabel=({en:"VIDEO LIBRARY",fr:"BIBLIOTHÈQUE VIDÉO",es:"BIBLIOTECA DE VÍDEOS",pt:"BIBLIOTECA DE VÍDEOS",it:"LIBRERIA VIDEO",de:"VIDEOBIBLIOTHEK"})[locale] || "VIDEO LIBRARY";
 return <div className="platform-shell">
  <header className="platform-topbar"><Link to="/" className="brand"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>CREATOR NETWORK</small></span></Link>
   <nav><a href="/#plans" className="platform-nav-link">Pricing</a>{links.map(([href,key])=><Link key={href} to={href} className="platform-nav-link">{key==="nav.library"?libraryLabel:translate(locale,key)}</Link>)}</nav>
   <select className="site-language-select" aria-label="Language" value={locale} onChange={e=>setSiteLocale(e.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option><option value="pt">PT</option><option value="it">IT</option><option value="de">DE</option></select>
  </header>
  <main className="platform-main"><div className="eyebrow">{eyebrow}</div>{children}</main>
  <footer className="platform-footer"><span>{translate(locale,"footer.independent")}</span><div><Link to="/terms">{translate(locale,"footer.terms")}</Link><Link to="/privacy">{translate(locale,"footer.privacy")}</Link><Link to="/copyright">{translate(locale,"footer.copyright")}</Link></div><small>{translate(locale,"footer.disclaimer")}</small></footer>
 </div>;
}
