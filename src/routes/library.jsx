import {useCallback,useEffect,useMemo,useState} from "react";
import {createFileRoute,Link} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {useAuth} from "@/lib/AuthContext";
import {getInternalClipDownloadAccess,listPublicInternalClips,requestInternalClipDownload} from "@/lib/internal-video-fns";
import "@/styles/vicehub-library.css";

export const Route=createFileRoute("/library")({
 ssr:false,
 head:()=>({meta:[
  {title:"VICEHUB — The Video Library"},
  {name:"description",content:"Discover featured GTA VI clips, community favourites and the most downloaded videos in the VICEHUB library."},
  {name:"theme-color",content:"#080b12"}
 ]}),
 component:ClientClipLibrary
});

const EDITORIAL_IMAGES=["https://www.rockstargames.com/VI/_next/static/media/Vice_City_01.135x56yoeu.6t.jpg?akim=1&imdensity=1&imwidth=3840","https://www.rockstargames.com/VI/_next/static/media/Leonida_Keys_01.0zgz7tveur6y8.jpg?akim=1&imdensity=1&imwidth=3840","https://www.rockstargames.com/VI/_next/static/media/Port_Gellhorn_01.0fmisvza-5-cq.jpg?akim=1&imdensity=1&imwidth=3840"];

function ClientClipLibrary(){
 const{isAuthenticated}=useAuth();
 const[clips,setClips]=useState([]);
 const[collections,setCollections]=useState({featured:[],favourites:[],mostDownloaded:[],videoOfWeek:null});
 const[total,setTotal]=useState(0);
 const[nextOffset,setNextOffset]=useState(0);
 const[hasMore,setHasMore]=useState(false);
 const[query,setQuery]=useState("");
 const[category,setCategory]=useState("all");
 const[language,setLanguage]=useState("all");
 const[country,setCountry]=useState("all");
 const[sort,setSort]=useState("newest");
 const[selected,setSelected]=useState(null);
 const[busy,setBusy]=useState(false);
 const[downloading,setDownloading]=useState("");
 const[downloadAccess,setDownloadAccess]=useState(null);
 const[error,setError]=useState("");

 const params=useMemo(()=>({
  search:query.trim()||undefined,
  category:category==="all"?undefined:category,
  language:language==="all"?undefined:language,
  country:country==="all"?undefined:country,
  limit:48
 }),[query,category,language,country]);

 const refresh=useCallback(async()=>{
  setBusy(true);setError("");
  try{
   const r=await listPublicInternalClips({data:{...params,offset:0}});
   setClips(r.assets||[]);setCollections(r.collections||{featured:[],favourites:[],mostDownloaded:[],videoOfWeek:null});
   setTotal(Number(r.totalPublished||0));setNextOffset(r.nextOffset||0);setHasMore(!!r.hasMore);
  }catch(e){setError(e?.message||"The video library could not be loaded.");}
  finally{setBusy(false);}
 },[params]);

 useEffect(()=>{refresh();},[refresh]);

 useEffect(()=>{
  let live=true;
  if(!isAuthenticated){setDownloadAccess({canDownload:false,reason:"sign_in"});return ()=>{live=false;};}
  setDownloadAccess(null);
  getInternalClipDownloadAccess({data:{}}).then(result=>{if(live)setDownloadAccess(result);})
   .catch(()=>{if(live)setDownloadAccess({canDownload:false,reason:"membership_check_failed"});});
  return ()=>{live=false;};
 },[isAuthenticated]);

 const languages=useMemo(()=>[...new Set(clips.map(x=>x.language).filter(x=>x&&x!=="und"))].sort(),[clips]);
 const countries=useMemo(()=>[...new Set(clips.flatMap(x=>x.target_countries||[]))].sort(),[clips]);
 const sorted=useMemo(()=>{
  const copy=[...clips];
  if(sort==="score")copy.sort((a,b)=>(b.viral_potential_score??-1)-(a.viral_potential_score??-1));
  else if(sort==="shortest")copy.sort((a,b)=>(a.duration_seconds||0)-(b.duration_seconds||0));
  else if(sort==="longest")copy.sort((a,b)=>(b.duration_seconds||0)-(a.duration_seconds||0));
  else copy.sort((a,b)=>new Date(b.public_published_at||0)-new Date(a.public_published_at||0));
  return copy;
 },[clips,sort]);

 const loadMore=async()=>{
  if(!hasMore||busy)return;
  setBusy(true);setError("");
  try{
   const r=await listPublicInternalClips({data:{...params,offset:nextOffset}});
   setClips(current=>[...current,...(r.assets||[])]);
   setNextOffset(r.nextOffset||nextOffset);setHasMore(!!r.hasMore);
  }catch(e){setError(e?.message||"More clips could not be loaded.");}
  finally{setBusy(false);}
 };

 const preview=clip=>{setError("");setSelected(clip);};
 const download=async clip=>{
  if(!isAuthenticated){window.location.assign("/sign-in");return;}
  if(!downloadAccess?.canDownload){
   if(downloadAccess?.reason==="limit_reached"){setError("Your monthly download allowance has been used. It will reset at the start of next month.");return;}
   if(["paid_subscription_required","clean_downloads_not_included","downloads_not_included"].includes(downloadAccess?.reason)){window.location.assign("/subscription");return;}
   setError("Your download entitlement could not be verified. Please refresh the page or contact support.");return;
  }
  setDownloading(clip.id);setError("");
  try{
   const r=await requestInternalClipDownload({data:{assetId:clip.id}});
   setDownloadAccess(current=>current?{...current,downloadsRemaining:r.downloadsRemaining,canDownload:r.downloadsRemaining>0,reason:r.downloadsRemaining>0?null:"limit_reached"}:current);
   window.location.assign(r.downloadUrl);
  }catch(e){setError(e?.message||"Download could not be authorised.");}
  finally{setDownloading("");}
 };
 const downloadLabel=()=>!isAuthenticated?"SIGN IN TO DOWNLOAD":downloadAccess===null?"CHECKING MEMBERSHIP…":downloadAccess.canDownload?"↓ DOWNLOAD":downloadAccess.reason==="limit_reached"?"MONTHLY LIMIT REACHED":"UNLOCK DOWNLOADS";
 const downloadDisabled=()=>downloading!==""||downloadAccess===null||(isAuthenticated&&downloadAccess?.reason==="limit_reached");
 const duration=s=>{const n=Math.max(0,Number(s)||0);return Math.floor(n/60)+":"+String(n%60).padStart(2,"0");};
 const VideoCard=({clip,index=0,rank})=><article className="vh-card" key={clip.id}>
  <button type="button" className="vh-card-art" onClick={()=>preview(clip)} aria-label={"Preview "+clip.title}>
   {clip.thumbnail_url?<img src={clip.thumbnail_url} alt={clip.title} loading={index>3?"lazy":"eager"}/>:<><img className="vh-card-fallback-image" src={EDITORIAL_IMAGES[index%EDITORIAL_IMAGES.length]} alt="Illustrative Vice City artwork" loading="lazy"/><span className="vh-card-illustrative">ILLUSTRATIVE VISUAL</span></>}
   {rank&&<span className="vh-card-rank">#{rank}</span>}
   <span className="vh-card-duration">{duration(clip.duration_seconds)}</span>
   <span className="vh-card-play">▶</span>
  </button>
  <div className="vh-card-body">
   <div className="vh-card-meta"><span>{clip.category||"VIDEO"}</span><span>{clip.language&&clip.language!=="und"?clip.language.toUpperCase():"MULTI"}</span></div>
   <h3>{clip.title}</h3>
   <p>{clip.description||"A selected clip from the VICEHUB video library."}</p>
   <div className="vh-card-foot"><span>{clip.download_count_30d>0?clip.download_count_30d+" DOWNLOADS / 30 DAYS":clip.viral_potential_score!=null?"✦ "+clip.viral_potential_score+"/100 VIRAL SCORE":"VICEHUB COLLECTION"}</span><div className="vh-card-actions"><button type="button" className="vh-preview-button" onClick={()=>preview(clip)} aria-label={"Preview "+clip.title}>▶ PREVIEW</button><button type="button" className="vh-download-button" onClick={()=>download(clip)} disabled={downloadDisabled()}>{downloading===clip.id?"…":downloadLabel()}</button></div></div>
  </div>
 </article>;

 const Section=({eyebrow,title,description,items,empty,ranked=false,id})=><section className="vh-editorial-section" id={id}>
  <div className="vh-section-head"><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{items.length>0&&<b>{String(items.length).padStart(2,"0")} <small>VIDEOS</small></b>}</div>
  {items.length?<div className="vh-card-row">{items.map((clip,i)=><VideoCard clip={clip} index={i} rank={ranked?i+1:undefined} key={clip.id}/>)}</div>:<div className="vh-section-empty">{empty}</div>}
 </section>;

 const lead=collections.featured[0]||null;
 const week=collections.videoOfWeek;

 return <SiteFrame eyebrow="VICEHUB / THE VIDEO LIBRARY">
  <main className="vh-library">
   <section className={"vh-landing-hero "+(lead?.thumbnail_url?"has-image":"")}>
    <img src={lead?.thumbnail_url||EDITORIAL_IMAGES[0]} alt="" aria-hidden="true" className="vh-landing-backdrop"/>
    <div className="vh-landing-shade"/>
    <div className="vh-landing-content">
     <span className="vh-eyebrow"><i/> THE VICEHUB VIDEO LIBRARY</span>
     <p className="vh-landing-overline">GTA VI CLIPS. CURATED FOR CREATORS.</p>
     <h1>FIND THE MOMENT.<br/><em>MAKE IT YOURS.</em></h1>
     <p className="vh-landing-copy">Discover the clips everyone is watching, explore VICEHUB favourites and find your next viral moment. Preview first. Download with your membership.</p>
     <div className="vh-landing-actions"><a href="#discover" className="vh-btn-primary">EXPLORE THE LIBRARY <span>→</span></a><Link to={isAuthenticated?"/dashboard":"/sign-in"} className="vh-btn-secondary">{isAuthenticated?"MY ACCOUNT":"SIGN IN"} ↗</Link></div>
    </div>
    <div className="vh-landing-side"><span>VICEHUB</span><b>THE<br/>CLIP<br/>ARCHIVE</b><small>LEONIDA · VICE CITY · 2026</small></div>
    <div className="vh-landing-bottom"><span>DISCOVER</span><i/><span>{total.toLocaleString()} PUBLISHED CLIPS</span></div>
   </section>


   <section className="vh-leonida-gallery" aria-label="Explore GTA VI locations">
    <a className="vh-leonida-tile vh-leonida-city" href="#discover"><img src={EDITORIAL_IMAGES[0]} alt="Official GTA VI Vice City artwork"/><span>01 / THE CITY</span><b>VICE CITY</b><i>EXPLORE CLIPS ↘</i></a>
    <a className="vh-leonida-tile vh-leonida-coast" href="#discover"><img src={EDITORIAL_IMAGES[1]} alt="Official GTA VI Leonida Keys artwork"/><span>02 / THE COAST</span><b>LEONIDA KEYS</b><i>EXPLORE CLIPS ↘</i></a>
    <a className="vh-leonida-tile vh-leonida-streets" href="#discover"><img src={EDITORIAL_IMAGES[2]} alt="Official GTA VI Port Gellhorn artwork"/><span>03 / THE STREETS</span><b>PORT GELLHORN</b><i>EXPLORE CLIPS ↘</i></a>
   </section>
   <section className="vh-library-stats" aria-label="Library overview">
    <div><b>{total.toLocaleString()}</b><span>PUBLISHED CLIPS</span></div>
    <div><b>{collections.featured.length.toString().padStart(2,"0")}</b><span>EDITOR'S PICKS</span></div>
    <div><b>{collections.favourites.length.toString().padStart(2,"0")}</b><span>VICEHUB FAVOURITES</span></div>
    <div><b>{collections.mostDownloaded.length.toString().padStart(2,"0")}</b><span>POPULAR THIS MONTH</span></div>
   </section>

   {error&&<div role="alert" className="vh-library-error">{error}{!isAuthenticated&&<Link to="/sign-in"> SIGN IN ↗</Link>}</div>}

   {lead&&<section className="vh-spotlight">
    <div className="vh-spotlight-art">{lead.thumbnail_url?<img src={lead.thumbnail_url} alt={lead.title}/>:<img src={EDITORIAL_IMAGES[1]} alt="Illustrative Leonida artwork"/>}<span>01 / EDITOR'S SPOTLIGHT</span><button type="button" onClick={()=>preview(lead)}>▶</button></div>
    <div className="vh-spotlight-copy"><span className="vh-eyebrow"><i/> HAND-PICKED BY VICEHUB</span><h2>{lead.title}</h2><p>{lead.description||"A featured selection from the VICEHUB editorial team."}</p><div className="vh-spotlight-tags">{[lead.category,lead.language,...(lead.target_countries||[])].filter(Boolean).map((x,i)=><span key={x+i}>{x}</span>)}</div><div className="vh-spotlight-actions"><button type="button" onClick={()=>preview(lead)}>▶ WATCH PREVIEW</button><button type="button" onClick={()=>download(lead)} disabled={downloadDisabled()}>{downloading===lead.id?"PREPARING…":downloadLabel()}</button></div></div>
   </section>}

   <Section eyebrow="SELECTED BY OUR EDITORS / 01" title="À LA UNE" description="The clips currently selected by the VICEHUB editorial team." items={collections.featured} empty="New featured clips will appear here as soon as the editorial team selects them." id="featured"/>
   <Section eyebrow="THE VICEHUB SELECTION / 02" title="COUPS DE CŒUR" description="Hand-picked clips worth saving for your next post." items={collections.favourites} empty="Our favourites will appear here as soon as clips are selected in video administration." id="favourites"/>

   <section className="vh-week-feature">
    <div className="vh-week-label"><span>THE WEEKLY SPOTLIGHT</span><b>VIDEO<br/>OF THE<br/><em>WEEK.</em></b><small>TOP DOWNLOADED · LAST 7 DAYS</small></div>
    {week?<div className="vh-week-content"><button type="button" className="vh-week-art" onClick={()=>preview(week)}>{week.thumbnail_url?<img src={week.thumbnail_url} alt={week.title}/>:<img src={EDITORIAL_IMAGES[2]} alt="Illustrative Port Gellhorn artwork"/>}<i>▶</i></button><div className="vh-week-copy"><span>THE COMMUNITY'S MOST DOWNLOADED THIS WEEK</span><h2>{week.title}</h2><p>{week.description||"The clip with the highest number of confirmed downloads in the last seven days."}</p><strong>{week.download_count_7d} <small>CONFIRMED DOWNLOADS</small></strong><button type="button" onClick={()=>download(week)} disabled={downloadDisabled()}>{downloading===week.id?"PREPARING…":downloadLabel()}</button></div></div>:<div className="vh-week-empty"><b>THE NEXT WEEKLY WINNER IS WAITING.</b><p>The video of the week is selected automatically from confirmed downloads over the last seven days. It will appear here when a clip has download activity.</p></div>}
   </section>

   <Section eyebrow="COMMUNITY ACTIVITY / LAST 30 DAYS / 03" title="MOST DOWNLOADED" description="Ranked by completed, confirmed downloads — not views or AI predictions." items={collections.mostDownloaded} empty="The ranking will update automatically after the first confirmed downloads." ranked id="most-downloaded"/>

   <section className="vh-discover" id="discover">
    <div className="vh-section-head"><div><span>EXPLORE THE FULL ARCHIVE / 04</span><h2>FIND YOUR NEXT CLIP.</h2><p>Filter the published collection by topic, language and target market.</p></div><b>{sorted.length.toString().padStart(2,"0")} <small>RESULTS</small></b></div>
    <div className="vh-filter-bar">
     <label className="vh-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search videos, topics or tags…" aria-label="Search videos"/>{query&&<button type="button" onClick={()=>setQuery("")}>×</button>}</label>
     <label><small>CATEGORY</small><select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{["Gaming","News","Comedy","Sport","Technology","Interview","Education","Other"].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
     <label><small>LANGUAGE</small><select value={language} onChange={e=>setLanguage(e.target.value)}><option value="all">All languages</option>{languages.map(x=><option key={x} value={x}>{x.toUpperCase()}</option>)}</select></label>
     <label><small>MARKET</small><select value={country} onChange={e=>setCountry(e.target.value)}><option value="all">All markets</option>{countries.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
    </div>
    <div className="vh-discover-tools"><span>{sorted.length} MATCHING CLIPS</span><label>SORT BY <select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Recently added</option><option value="score">AI potential score</option><option value="shortest">Shortest first</option><option value="longest">Longest first</option></select></label><button type="button" onClick={refresh} disabled={busy}>{busy?"UPDATING…":"↻ REFRESH"}</button></div>
    {sorted.length?<div className="vh-library-grid">{sorted.map((clip,index)=><VideoCard clip={clip} index={index} key={clip.id}/>)}</div>:<div className="vh-section-empty">{busy?"Loading the VICEHUB archive…":"No published clips match these filters. Try another search or clear your filters."}<button type="button" onClick={()=>{setQuery("");setCategory("all");setLanguage("all");setCountry("all");}}>CLEAR FILTERS</button></div>}
    {hasMore&&<div className="vh-load-more"><button type="button" onClick={loadMore} disabled={busy}>{busy?"LOADING…":"LOAD MORE CLIPS ↓"}</button></div>}
   </section>

   <footer className="vh-library-footer"><span>VICEHUB / LEONIDA VIDEO ARCHIVE</span><p>Download rankings use completed download events recorded by VICEHUB. Weekly and monthly lists update as new downloads are completed. AI viral potential is an estimate, not a verified engagement result. All clips remain subject to their usage rights and membership limits. Decorative artwork: <a href="https://www.rockstargames.com/VI/media/screenshots" target="_blank" rel="noreferrer">official Rockstar Games media gallery</a>.</p></footer>

   {selected&&<div className="vh-preview-modal" role="dialog" aria-modal="true" aria-label={selected.title} onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}><div className="vh-preview-panel"><div className="vh-preview-head"><div><span>VICEHUB / SECURE PREVIEW</span><b>{selected.title}</b></div><button type="button" onClick={()=>setSelected(null)} aria-label="Close preview">×</button></div><video controls autoPlay playsInline src={"/api/internal-video-preview/"+encodeURIComponent(selected.id)}/><div className="vh-preview-foot"><span>Preview available for published clips. Usage rights remain applicable.</span><span>{downloadAccess?.canDownload?downloadAccess.downloadsRemaining+" downloads remaining this month":"Downloads require an eligible paid membership."}</span></div></div></div>}
  </main>
 </SiteFrame>;
}
