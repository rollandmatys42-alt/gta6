import { useEffect,useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getNewsFeed,createContentReport } from "@/lib/server-fns";
import { useLocale, translate } from "@/lib/i18n";
export const Route=createFileRoute("/news")({head:()=>({meta:[{title:"GTA VI News — VICEHUB"},{name:"description",content:"Source-labelled GTA VI news, official updates and community coverage."}]}),component:NewsPage});
function NewsPage(){
 const [articles,setArticles]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[filter,setFilter]=useState("all"),[selected,setSelected]=useState(null);
 useEffect(()=>{setLoading(true);getNewsFeed({data:{locale,limit:50}}).then(setArticles).catch(e=>setError(e.message||"News could not be loaded.")).finally(()=>setLoading(false));},[locale]);
 const filtered=articles.filter(a=>filter==="all"||a.confidence===filter||a.source_type===filter);
 return <SiteFrame eyebrow="VICEHUB / NEWS DESK">
  <div className="platform-hero"><div><div className="eyebrow">{tx("news.kicker")}</div><h1>{tx("news.title")}</h1><p>{tx("news.desc")}</p></div><div className="hero-stamp">LIVE<br/>DESK <b>06</b></div></div>
  <div className="platform-toolbar"><div className="eyebrow">NEWSROOM / {articles.length} STORIES</div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{tx("news.all")}</option><option value="official">{tx("news.official")}</option><option value="confirmed">{tx("news.confirmed")}</option><option value="reported">{tx("news.reported")}</option><option value="rumour">{tx("news.rumours")}</option><option value="theory">{tx("news.theories")}</option><option value="community">{tx("news.community")}</option></select></div>
  {error&&<div className="platform-alert">{error}</div>}
  {selected&&<div className="platform-detail"><button className="text-btn" onClick={()=>setSelected(null)}>← {tx("news.back")}</button><div className={"source-pill "+selected.confidence}>{selected.confidence}</div><h2>{selected.title}</h2><p className="detail-summary">{selected.summary}</p><div className="article-body">{selected.body}</div><button className="text-btn" onClick={async()=>{try{await createContentReport({data:{targetType:"news",targetId:selected.id,reason:"other",details:"User-submitted report from the news page."}});setError("Report submitted for moderation.");}catch(e){setError(e.message);}}}>{tx("news.report")}</button><div className="source-line">SOURCE: {selected.source_name} · <a href={selected.source_url} target="_blank" rel="noreferrer">{tx("news.original")} ↗</a></div></div>}
  {!selected&&loading?<div className="platform-empty">{tx("news.loading")}</div>:!selected&&filtered.length===0?<div className="platform-empty">{tx("news.empty")}</div>:!selected&&<div className="news-grid">{filtered.map(a=><article className="news-card" key={a.id} onClick={()=>setSelected(a)}><div className="news-card-top"><span className={"source-pill "+a.confidence}>{a.confidence}</span><span>{a.source_type}</span></div><h2>{a.title}</h2><p>{a.summary}</p><div className="news-card-bottom"><span>{a.source_name}</span><span>READ STORY ↗</span></div></article>)}</div>}
  <div className="platform-note">Rumours, leaks, theories and opinions are not presented as verified facts. Each story links to its original source. VICEHUB does not reproduce full third-party articles.</div>
 </SiteFrame>;
}
