import {useEffect,useState} from "react";
import {createFileRoute} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {getMyNotifications,markNotificationRead} from "@/lib/server-fns";
import {useAuth} from "@/lib/AuthContext";
import {useLocale,translate} from "@/lib/i18n";
import "@/styles/vicehub-2026-redesign.css";
export const Route=createFileRoute("/notifications")({ssr:false,head:()=>({meta:[{title:"Notifications — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:NotificationsPage});
function NotificationsPage(){
 const {isAuthenticated,navigateToLogin}=useAuth();const locale=useLocale(),tx=key=>translate(locale,key);const [items,setItems]=useState([]),[error,setError]=useState("");
 const load=()=>getMyNotifications().then(setItems).catch(e=>setError(e.message));
 useEffect(()=>{if(isAuthenticated)load();},[isAuthenticated]);
 return <SiteFrame eyebrow="VICEHUB / NOTIFICATIONS" workspace={isAuthenticated} activeKey="dispatch"><div className="platform-hero vh-image-hero"><img className="vh-page-art-image" src="https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=1920" alt="Vice City — official GTA VI artwork" /><div className="vh-page-art-shade" /><div><div className="eyebrow">{tx("notifications.kicker")}</div><h1>{tx("notifications.title")}</h1><p>{tx("notifications.desc")}</p></div></div>{error&&<div className="platform-alert">{error}</div>}
 <div className="notification-list">{items.map(n=><article className={n.read_at?"notification-row read":"notification-row"} key={n.id}><div className="notification-row-main"><span className="notification-row-mark" aria-hidden="true">✦</span><div className="notification-row-content"><div className="eyebrow">{n.type || "VICEHUB DISPATCH"}</div><h2>{n.title}</h2><p>{n.body}</p><small>{new Date(n.created_date).toLocaleString()}</small></div></div><div><button className="outline-btn" onClick={()=>{if(n.target_url)window.location.assign(n.target_url);}}>{tx("notifications.open")}</button>{!n.read_at&&<button className="text-btn" onClick={()=>markNotificationRead({data:{notificationId:n.id}}).then(load)}>{tx("notifications.read")}</button>}</div></article>)}{!items.length&&<div className="platform-empty">{tx("notifications.empty")}</div>}</div>
 </SiteFrame>;
}
