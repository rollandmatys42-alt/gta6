import { useState } from "react";
import { Link } from "@tanstack/react-router";
import "@/styles/fan-theme.css";
import "@/styles/fan-pages.css";
import "@/styles/fan-admin.css";
import "@/styles/fan-admin-fix.css";
import "@/styles/fan-home.css";
import { useAuth } from "@/lib/AuthContext";
import { useLocale, setSiteLocale, translate } from "@/lib/i18n";

const links = [["/", "nav.home"], ["/library", "nav.library"], ["/news", "nav.news"], ["/creators", "nav.creators"], ["/shop", "nav.shop"], ["/studio", "nav.studio"]];
const libraryLabels = { en: "Video library", fr: "Bibliothèque vidéo", es: "Biblioteca de vídeos", pt: "Biblioteca de vídeos", it: "Libreria video", de: "Videobibliothek" };

export default function SiteFrame({ children, eyebrow = "VICEHUB / GTA VI FAN HQ" }) {
  const locale = useLocale();
  const { isAuthenticated, navigateToLogin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const label = (key) => key === "nav.library" ? (libraryLabels[locale] || libraryLabels.en) : translate(locale, key);
  const close = () => setOpen(false);
  return <div className="platform-shell fh-shell">
    <header className="fh-header">
      <div className="fh-header-inner">
        <Link to="/" className="fh-brand" onClick={close}><span className="fh-brand-mark">V</span><span className="fh-brand-text">VICE<b>HUB</b><small>GTA VI FAN DROPS</small></span></Link>
        <button type="button" className="fh-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><i /><i /><i /></button>
        <nav className={"fh-nav" + (open ? " open" : "")} aria-label="Main">
          {links.map(([href, key]) => <Link key={href} to={href} className="fh-nav-link" activeProps={{ className: "fh-nav-link active" }} activeOptions={{ exact: href === "/" }} onClick={close}>{label(key)}</Link>)}
          <a href="/#plans" className="fh-nav-link" onClick={close}>Pricing</a>
          <div className="fh-nav-actions">
            <select className="fh-lang" aria-label="Language" value={locale} onChange={e => setSiteLocale(e.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option><option value="pt">PT</option><option value="it">IT</option><option value="de">DE</option></select>
            {isAuthenticated
              ? <><Link to="/dashboard" className="fh-btn solid" onClick={close}>My account</Link><button type="button" className="fh-btn ghost" onClick={() => { close(); logout(); }}>Sign out</button></>
              : <><button type="button" className="fh-btn ghost" onClick={() => { close(); navigateToLogin(); }}>Sign in</button><button type="button" className="fh-btn solid" onClick={() => { close(); navigateToLogin(); }}>Join now</button></>}
          </div>
        </nav>
      </div>
    </header>
    <main className="platform-main"><div className="eyebrow">{eyebrow}</div>{children}</main>
    <footer className="fh-footer">
      <div className="fh-footer-grid">
        <div><div className="fh-brand-text">VICE<b>HUB</b></div><p>Weekly vertical GTA VI videos for TikTok, Instagram and YouTube Shorts. Download, post on your own channels, grow your page.</p></div>
        <div><h4>Explore</h4><Link to="/library">Video library</Link><Link to="/news">GTA VI news</Link><Link to="/creators">Creators</Link><Link to="/shop">Shop</Link></div>
        <div><h4>Account</h4><Link to="/dashboard">My account</Link><a href="/#plans">Pricing</a><Link to="/studio">AI studio</Link><Link to="/social">Social planner</Link></div>
        <div><h4>Legal</h4><Link to="/terms">{translate(locale, "footer.terms")}</Link><Link to="/privacy">{translate(locale, "footer.privacy")}</Link><Link to="/copyright">{translate(locale, "footer.copyright")}</Link><Link to="/refunds">Refunds</Link><Link to="/contact">Contact</Link></div>
      </div>
      <div className="fh-footer-bottom"><span>{translate(locale, "footer.independent")}</span><small>{translate(locale, "footer.disclaimer")}</small></div>
    </footer>
  </div>;
}
