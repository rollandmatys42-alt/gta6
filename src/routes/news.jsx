import { useEffect,useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getNewsFeed,createContentReport } from "@/lib/server-fns";
export const Route=createFileRoute("/news")({head:()=>({meta:[{title:"GTA VI News — VICEHUB"},{name:"description",content:"Source-labelled GTA VI news, official updates and community coverage."}]}),component:NewsPage});
function NewsPage(){
 const [articles,setArticles]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[filter,setFilter]=useState("all"),[selected,setSelected]=useState(null);
 useEffect(()=>{getNewsFeed({data:{locale:"en",limit:50}}).then(setArticles).catch(e=>setError(e.message||"News could not be loaded.")).finally(()=>setLoading(false));},[]);
 const filtered=articles.filter(a=>filter==="all"||a.confidence===filter||a.source_type===filter);
 return <SiteFrame eyebrow="VICEHUB / NEWS DESK">
  <div className="platform-hero"><div><div className="eyebrow">THE LATEST FROM VICE CITY</div><h1>NEWS WITHOUT<br/><em>THE NOISE.</em></h1><p>Official announcements, reported coverage and community discussion — clearly labelled by source and confidence.</p></div><div className="hero-stamp">LIVE<br/>DESK <b>06</b></div></div>
  <div className="platform-toolbar"><div className="eyebrow">NEWSROOM / {articles.length} STORIES</div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All coverage</option><option value="official">Official</option><option value="confirmed">Confirmed</option><option value="reported">Reported</option><option value="rumour">Rumours</option><option value="theory">Theories</option><option value="community">Community</option></select></div>
  {error&&<div className="platform-alert">{error}</div>}
  {selected&&<div className="platform-detail"><button className="text-btn" onClick={()=>setSelected(null)}>← BACK TO NEWS</button><div className={"source-pill "+selected.confidence}>{selected.confidence}</div><h2>{selected.title}</h2><p className="detail-summary">{selected.summary}</p><div className="article-body">{selected.body}</div><button className="text-btn" onClick={async()=>{try{await createContentReport({data:{targetType:"news",targetId:selected.id,reason:"other",details:"User-submitted report from the news page."}});setError("Report submitted for moderation.");}catch(e){setError(e.message);}}}>REPORT THIS STORY</button><div className="source-line">SOURCE: {selected.source_name} · <a href={selected.source_url} target="_blank" rel="noreferrer">Read original ↗</a></div></div>}
  {!selected&&loading?<div className="platform-empty">Loading the newsroom…</div>:!selected&&filtered.length===0?<div className="platform-empty">No published stories yet. The editorial desk is ready for verified updates.</div>:!selected&&<div className="news-grid">{filtered.map(a=><article className="news-card" key={a.id} onClick={()=>setSelected(a)}><div className="news-card-top"><span className={"source-pill "+a.confidence}>{a.confidence}</span><span>{a.source_type}</span></div><h2>{a.title}</h2><p>{a.summary}</p><div className="news-card-bottom"><span>{a.source_name}</span><span>READ STORY ↗</span></div></article>)}</div>}
  <div className="platform-note">Rumours, leaks, theories and opinions are not presented as verified facts. Each story links to its original source. VICEHUB does not reproduce full third-party articles.</div>
 </SiteFrame>;
}
