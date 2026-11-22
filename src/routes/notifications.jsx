import {useEffect,useState} from "react";
import {createFileRoute} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {getMyNotifications,markNotificationRead} from "@/lib/server-fns";
import {useAuth} from "@/lib/AuthContext";
export const Route=createFileRoute("/notifications")({ssr:false,head:()=>({meta:[{title:"Notifications — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:NotificationsPage});
function NotificationsPage(){
 const {isAuthenticated,navigateToLogin}=useAuth();const [items,setItems]=useState([]),[error,setError]=useState("");
 const load=()=>getMyNotifications().then(setItems).catch(e=>setError(e.message));
 useEffect(()=>{if(isAuthenticated)load();},[isAuthenticated]);
 return <SiteFrame eyebrow="VICEHUB / NOTIFICATIONS"><div className="platform-hero"><div><div className="eyebrow">YOUR PLATFORM UPDATES</div><h1>STAY<br/><em>INFORMED.</em></h1><p>Messages, replies and important account updates in one place.</p></div></div>{error&&<div className="platform-alert">{error}</div>}
 <div className="notification-list">{items.map(n=><article className={n.read_at?"notification-row read":"notification-row"} key={n.id}><div><div className="eyebrow">{n.type}</div><h2>{n.title}</h2><p>{n.body}</p><small>{new Date(n.created_date).toLocaleString()}</small></div><div><button className="outline-btn" onClick={()=>{if(n.target_url)window.location.assign(n.target_url);}}>OPEN</button>{!n.read_at&&<button className="text-btn" onClick={()=>markNotificationRead({data:{notificationId:n.id}}).then(load)}>MARK READ</button>}</div></article>)}{!items.length&&<div className="platform-empty">No notifications yet.</div>}</div>
 </SiteFrame>;
}
