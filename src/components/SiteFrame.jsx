import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import "@/styles/fan-theme.css";
import "@/styles/fan-pages.css";
import "@/styles/vicehub-cinematic-pages.css";
import "@/styles/fan-admin.css";
import "@/styles/fan-admin-fix.css";
import "@/styles/pwa-notifications.css";
import "@/styles/fan-home.css";
import "@/styles/client-workspace.css";
import "@/styles/vicehub-page-refresh.css";
import { useAuth } from "@/lib/AuthContext";
import { useLocale, setSiteLocale, translate } from "@/lib/i18n";
import { getMyNotifications, getPushNotificationConfig, savePushSubscription } from "@/lib/server-fns";
import "@/styles/vicehub-2026-redesign.css";

const links = [["/", "nav.home"], ["/library", "nav.library"], ["/news", "nav.news"], ["/creators", "nav.creators"]];
const workspaceLinks = [
  ["/dashboard", "⌂", "overview"],
  ["/library", "▤", "library"],
  ["/news", "▧", "news"],
  ["/creators", "◎", "profile"],
  ["/messages", "✉", "messages"],
  ["/social", "↗", "social"],
  ["/notifications", "✦", "dispatch"],
  ["/subscription", "◈", "subscription"],
];
const libraryLabels = { en: "Video library", fr: "Bibliothèque vidéo", es: "Biblioteca de vídeos", pt: "Biblioteca de vídeos", it: "Libreria video", de: "Videobibliothek" };


function decodeVapidKey(value){
  const padded=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);
  const raw=atob(padded);return Uint8Array.from(raw,char=>char.charCodeAt(0));
}
function DispatchIndicator({isAuthenticated}) {
  const [unread,setUnread]=useState(0);
  const [permission,setPermission]=useState(typeof Notification==="undefined"?"unsupported":Notification.permission);
  const [pushAvailable,setPushAvailable]=useState(false);
  const [pushMessage,setPushMessage]=useState("");
  const newestId=useRef(null);
  useEffect(()=>{
    if(!isAuthenticated){setUnread(0);newestId.current=null;return;}
    let active=true;
    getPushNotificationConfig().then(config=>{if(active)setPushAvailable(!!config.available);}).catch(()=>{});
    const load=()=>getMyNotifications().then(rows=>{
      if(!active)return;
      const ordered=[...(rows||[])].sort((a,b)=>new Date(b.created_date||0)-new Date(a.created_date||0));
      setUnread(ordered.filter(n=>!n.read_at).length);
      const newest=ordered[0];
      if(newestId.current!==null && newest && newest.id!==newestId.current && typeof Notification!=="undefined" && Notification.permission==="granted"){
        const notice={title:newest.title||"VICEHUB update",body:newest.body||"A new update is available.",data:{url:newest.target_url||"/notifications"},tag:"vicehub-"+newest.id};
        if("serviceWorker" in navigator)navigator.serviceWorker.ready.then(reg=>reg.showNotification(notice.title,notice)).catch(()=>{});
        else new Notification(notice.title,{body:notice.body});
      }
      newestId.current=newest?.id || "__none__";
    }).catch(()=>{});
    load();
    const timer=window.setInterval(load,30000);
    const onFocus=()=>load();
    window.addEventListener("focus",onFocus);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",onFocus);};
  },[isAuthenticated]);
  if(!isAuthenticated)return null;
  const enable=async()=>{
    try{
      if(typeof Notification==="undefined")throw new Error("Browser notifications are not supported.");
      const granted=await Notification.requestPermission();
      setPermission(granted);
      if(granted!=="granted")return;
      const config=await getPushNotificationConfig();
      if(!config.available||!config.publicKey){setPushMessage("Browser alerts are enabled while VICEHUB is open. Background push awaits server VAPID keys.");return;}
      if(!("serviceWorker" in navigator)||!("PushManager" in window))throw new Error("Background push is not supported by this browser.");
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(config.publicKey)});
      const payload=subscription.toJSON();
      if(!payload.endpoint||!payload.keys?.p256dh||!payload.keys?.auth)throw new Error("The browser returned an incomplete push subscription.");
      await savePushSubscription({data:{endpoint:payload.endpoint,p256dh:payload.keys.p256dh,auth:payload.keys.auth,expirationTime:payload.expirationTime||undefined}});
      setPushMessage("Background push alerts enabled on this device.");
    }catch(error){setPushMessage(error?.message||"Push alerts could not be enabled.");}
  };
  return <span className="vh-notification-control"><Link to="/notifications" className="vh-notification-dispatch" aria-label={unread?unread+" unread dispatches":"VICEHUB dispatches"} title="VICEHUB dispatches"><span className="vh-notification-mark" aria-hidden="true"><svg viewBox="0 0 40 40" role="img"><path d="M20 2.5 35.5 11v18L20 37.5 4.5 29V11L20 2.5Z"/><path d="m20 7 11 6v14l-11 6-11-6V13l11-6Z"/><text x="20" y="24.5" textAnchor="middle">VI</text><path d="m30 5 1.8-3 1.8 3 3 1.8-3 1.8-1.8 3-1.8-3-3-1.8L30 5Z"/></svg></span>{unread>0&&<b className="vh-notification-count">{unread>99?"99+":unread}</b>}</Link>{permission==="default"||(pushAvailable&&permission==="granted")?<button type="button" className="vh-notification-enable" onClick={enable} aria-label="Enable dispatch alerts" title="Enable dispatch alerts">✦</button>:null}{pushMessage&&<span className="vh-pwa-install-message" role="status">{pushMessage}</span>}</span>;
}

function PwaInstallButton() {
  const [prompt,setPrompt]=useState(null),[installed,setInstalled]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{
    const standalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
    setInstalled(standalone);
    const capture=e=>{e.preventDefault();setPrompt(e);};
    const done=()=>{setInstalled(true);setPrompt(null);setMessage("");};
    window.addEventListener("beforeinstallprompt",capture);
    window.addEventListener("appinstalled",done);
    return()=>{window.removeEventListener("beforeinstallprompt",capture);window.removeEventListener("appinstalled",done);};
  },[]);
  if(installed)return null;
  const install=async()=>{
    if(prompt){prompt.prompt();const result=await prompt.userChoice;setPrompt(null);if(result?.outcome!=="accepted")setMessage("You can install VICEHUB later from your browser menu.");return;}
    setMessage(/iphone|ipad|ipod/i.test(navigator.userAgent)?"On iPhone: tap Share, then Add to Home Screen.":"Open your browser menu and choose Install app or Add to Home Screen.");
  };
  return <span className="vh-pwa-install-wrap"><button type="button" className="vh-pwa-install" onClick={install}>↓ INSTALL APP</button>{message&&<span className="vh-pwa-install-message" role="status">{message}</span>}</span>;
}

export default function SiteFrame({ children, eyebrow = "VICEHUB / GTA VI FAN HQ", workspace = false, activeKey = "" }) {
  const locale = useLocale();
  const { isAuthenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const label = key => key === "nav.library" ? (libraryLabels[locale] || libraryLabels.en) : translate(locale, key);
  const tx = key => translate(locale, key);
  const close = () => setOpen(false);
  const activeLabel = workspaceLinks.find(([, , key]) => key === activeKey);
  return <div className={"platform-shell fh-shell" + (workspace ? " vh-workspace-mode" : "")}>
    {workspace ? <>
      <aside className="vh-workspace-sidebar">
        <Link to="/dashboard" className="vh-workspace-brand"><span className="vh-workspace-mark">VI</span><span>VICE<b>HUB</b><small>MEMBER HQ / LEONIDA</small></span></Link>
        <div className="vh-workspace-caption">MEMBER NAVIGATION</div>
        <nav className="vh-workspace-nav" aria-label="Member workspace navigation">
          {workspaceLinks.map(([href, icon, key]) => <Link key={href} to={href} className={activeKey === key ? "active" : ""} aria-current={activeKey === key ? "page" : undefined}>
            <span className="vh-workspace-icon">{icon}</span><span>{key === "dispatch" ? "DISPATCHES" : key === "subscription" ? "MY SUBSCRIPTION" : tx("dashboard.nav." + key)}</span>
          </Link>)}
        </nav>
        <div className="vh-workspace-sidebar-bottom">
          <Link to="/" className="vh-workspace-public">↗ {tx("nav.home")}</Link>
          <button type="button" onClick={logout}>↪ {tx("dashboard.signout")}</button>
        </div>
      </aside>
      <div className="vh-workspace-content">
        <header className="vh-workspace-topbar">
          <div><small>VICEHUB / MEMBER AREA</small><b>{activeLabel ? tx("dashboard.nav." + activeLabel[2]) : "Member dashboard"}</b></div>
          <div className="vh-workspace-actions"><DispatchIndicator isAuthenticated={isAuthenticated}/><PwaInstallButton/>
            <label><span className="sr-only">Language</span><select aria-label="Language" value={locale} onChange={e => setSiteLocale(e.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option><option value="pt">PT</option><option value="it">IT</option><option value="de">DE</option></select></label>
            <Link to="/dashboard" className="vh-workspace-account">MY DASHBOARD ↗</Link>
          </div>
        </header>
        <main className="platform-main vh-workspace-page"><div className="eyebrow">{eyebrow}</div>{children}</main>
      </div>
    </> : <>
      <header className="fh-header">
        <div className="fh-header-inner">
          <Link to="/" className="fh-brand" onClick={close}><span className="fh-brand-mark">VI</span><span className="fh-brand-text">VICE<b>HUB</b><small>GTA VI FAN DROPS</small></span></Link>
          <button type="button" className="fh-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><i /><i /><i /></button>
          <nav className={"fh-nav" + (open ? " open" : "")} aria-label="Main">
            {links.map(([href, key]) => <Link key={href} to={href} className="fh-nav-link" activeProps={{ className: "fh-nav-link active" }} activeOptions={{ exact: href === "/" }} onClick={close}>{label(key)}</Link>)}
            <a href="/#plans" className="fh-nav-link" onClick={close}>Pricing</a>
            <div className="fh-nav-actions"><DispatchIndicator isAuthenticated={isAuthenticated}/><PwaInstallButton/>
              <select className="fh-lang" aria-label="Language" value={locale} onChange={e => setSiteLocale(e.target.value)}><option value="en">EN</option><option value="fr">FR</option><option value="es">ES</option><option value="pt">PT</option><option value="it">IT</option><option value="de">DE</option></select>
              {isAuthenticated
                ? <><Link to="/dashboard" className="fh-btn solid" onClick={close}>My account</Link><button type="button" className="fh-btn ghost" onClick={() => { close(); logout(); }}>Sign out</button></>
                : <><Link to="/sign-in" className="fh-btn ghost" onClick={close}>Sign in</Link><Link to="/register" className="fh-btn solid" onClick={close}>Join now</Link></>}
            </div>
          </nav>
        </div>
      </header>
      <main className="platform-main"><div className="eyebrow">{eyebrow}</div>{children}</main>
      <footer className="fh-footer">
        <div className="fh-footer-grid">
          <div><div className="fh-brand-text">VICE<b>HUB</b></div><p>Weekly vertical GTA VI videos for TikTok, Instagram and YouTube Shorts. Download, post on your own channels, grow your page.</p></div>
          <div><h4>Explore</h4><Link to="/library">Video library</Link><Link to="/news">GTA VI news</Link><Link to="/creators">Creators</Link></div>
          <div><h4>Account</h4><Link to="/dashboard">My account</Link><a href="/#plans">Pricing</a><Link to="/social">Social planner</Link></div>
          <div><h4>Legal</h4><Link to="/terms">{translate(locale, "footer.terms")}</Link><Link to="/privacy">{translate(locale, "footer.privacy")}</Link><Link to="/copyright">{translate(locale, "footer.copyright")}</Link><Link to="/cookies">Cookies</Link><Link to="/refunds">Refunds</Link><Link to="/contact">Contact</Link></div>
        </div>
        <div className="fh-footer-bottom"><span>{translate(locale, "footer.independent")}</span><small>{translate(locale, "footer.disclaimer")}</small></div>
      </footer>
    </>}
  </div>;
}
