import {useEffect,useState} from "react";
import {createFileRoute} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {getMySocialPosts,saveSocialPost} from "@/lib/server-fns";
import {useAuth} from "@/lib/AuthContext";
export const Route=createFileRoute("/social")({head:()=>({meta:[{title:"Social Planner — VICEHUB"},{name:"description",content:"Plan social content for TikTok, Instagram, YouTube and X with the VICEHUB social planner."},{property:"og:title",content:"Social Planner — VICEHUB"},{property:"og:description",content:"Plan social content for TikTok, Instagram, YouTube and X with the VICEHUB social planner."}]}),component:SocialPlanner});
function SocialPlanner(){
 const {isAuthenticated,navigateToLogin}=useAuth();const [posts,setPosts]=useState([]),[platform,setPlatform]=useState("TikTok"),[caption,setCaption]=useState(""),[planned,setPlanned]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const load=()=>getMySocialPosts().then(setPosts).catch(e=>setError(e.message));
 useEffect(()=>{if(isAuthenticated)load();},[isAuthenticated]);
 const save=async e=>{e.preventDefault();if(!isAuthenticated){navigateToLogin();return;}setError("");setNotice("");try{await saveSocialPost({data:{platform,caption,...(planned?{scheduledAt:new Date(planned).toISOString()}:{})}});setCaption("");setPlanned("");setNotice("Content saved to your planner.");load();}catch(e){setError(e.message);}};
 return <SiteFrame eyebrow="VICEHUB / SOCIAL PLANNER"><div className="platform-hero"><div><div className="eyebrow">PLAN YOUR NEXT DROP</div><h1>STAY<br/><em>IN THE FEED.</em></h1><p>Prepare platform-specific captions and build a publishing calendar for your GTA VI channels.</p></div><div className="hero-stamp">SOCIAL<br/>DESK</div></div>
 <div className="platform-alert">Planning mode: posts are saved as drafts. Direct publishing and automatic scheduling remain disabled until official TikTok / Instagram / YouTube / X account connections are configured.</div>
 {error&&<div className="platform-alert">{error}</div>}{notice&&<div className="platform-success">{notice}</div>}
 <div className="social-layout"><form className="platform-form" onSubmit={save}><h2>NEW SOCIAL POST</h2><label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}>{["TikTok","Instagram","YouTube","X"].map(x=><option>{x}</option>)}</select></label><label>Caption / post text<textarea required rows={8} maxLength={5000} value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Write your caption, CTA and hashtags…"/></label><label>Planned publish date (optional)<input type="datetime-local" value={planned} onChange={e=>setPlanned(e.target.value)}/></label><button className="primary-btn">SAVE CONTENT DRAFT</button></form>
 <section className="admin-panel"><h2>MY CONTENT PLAN</h2>{posts.map(p=><article className="social-post-row" key={p.id}><div className="eyebrow">{p.platform} · {p.status}</div><p>{p.caption}</p>{p.scheduled_at&&<small>Planned: {new Date(p.scheduled_at).toLocaleString()}</small>}</article>)}{!posts.length&&<div className="platform-empty">Your saved social drafts will appear here.</div>}</section></div>
 </SiteFrame>;
}
