import { Link } from "@tanstack/react-router";
import {useLocale,setSiteLocale,translate} from "@/lib/i18n";

const links=[["/","nav.home"],["/news","nav.news"],["/creators","nav.creators"],["/messages","nav.messages"],["/notifications","nav.alerts"],["/shop","nav.shop"],["/studio","nav.studio"],["/social","nav.social"],["/dashboard","nav.account"]];
export default function SiteFrame({children,eyebrow="VICEHUB / CREATOR NETWORK"}) {
 const locale=useLocale();
 return <div className="platform-shell">
  <header className="platform-topbar"><Link to="/" className="brand"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>CREATOR NETWORK</small></span></Link>
   <nav>{links.map(([href,key])=><Link key={href} to={href} className="platform-nav-link">{translate(locale,key)}</Link>)}</nav>
   <select className="site-language-select" aria-label="Language" value={locale} onChange={e=>setSiteLocale(e.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option><option value="pt">PT</option><option value="it">IT</option><option value="de">DE</option></select>
  </header>
  <main className="platform-main"><div className="eyebrow">{eyebrow}</div>{children}</main>
  <footer className="platform-footer"><span>{translate(locale,"footer.independent")}</span><div><Link to="/terms">{translate(locale,"footer.terms")}</Link><Link to="/privacy">{translate(locale,"footer.privacy")}</Link><Link to="/copyright">{translate(locale,"footer.copyright")}</Link></div><small>{translate(locale,"footer.disclaimer")}</small></footer>
 </div>;
}
