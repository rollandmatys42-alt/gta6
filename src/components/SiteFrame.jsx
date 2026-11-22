import { Link } from "@tanstack/react-router";

const links=[["/","nav.home"],["/news","nav.news"],["/creators","nav.creators"],["/messages","nav.messages"],["/notifications","nav.alerts"],["/shop","nav.shop"],["/studio","nav.studio"],["/social","nav.social"],["/dashboard","nav.account"]];
export default function SiteFrame({children,eyebrow="VICEHUB / CREATOR NETWORK"}) {
 return <div className="platform-shell">
  <header className="platform-topbar"><Link to="/" className="brand"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>CREATOR NETWORK</small></span></Link>
   <nav>{links.map(([href,label])=><Link key={href} to={href} className="platform-nav-link">{label}</Link>)}</nav>
  </header>
  <main className="platform-main"><div className="eyebrow">{eyebrow}</div>{children}</main>
  <footer className="platform-footer"><span>VICEHUB — INDEPENDENT GTA VI CREATOR PLATFORM</span><div><Link to="/terms">TERMS</Link><Link to="/privacy">PRIVACY</Link><Link to="/copyright">COPYRIGHT</Link></div><small>Not affiliated with or endorsed by Rockstar Games or Take-Two Interactive.</small></footer>
 </div>;
}
