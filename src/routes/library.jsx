import {useCallback,useEffect,useMemo,useState} from "react";
import {createFileRoute,Link} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {useAuth} from "@/lib/AuthContext";
import {listPublicInternalClips,requestInternalClipDownload} from "@/lib/internal-video-fns";
import "@/styles/vicehub-library.css";

export const Route=createFileRoute("/library")({
  ssr:false,
  head:()=>({meta:[
    {title:"VICEHUB — Video Library"},
    {name:"description",content:"Explore, preview and download curated VICEHUB video clips."}
  ]}),
  component:ClientClipLibrary
});

function ClientClipLibrary(){
  const{isAuthenticated}=useAuth();
  const[clips,setClips]=useState([]);
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
  const[error,setError]=useState("");

  const requestParams=useMemo(()=>({
    search:query.trim()||undefined,
    category:category==="all"?undefined:category,
    language:language==="all"?undefined:language,
    country:country==="all"?undefined:country,
    limit:48
  }),[query,category,language,country]);

  const refresh=useCallback(async()=>{
    setBusy(true);setError("");
    try{
      const r=await listPublicInternalClips({data:{...requestParams,offset:0}});
      setClips(r.assets||[]);
      setNextOffset(r.nextOffset||0);
      setHasMore(!!r.hasMore);
    }catch(e){setError(e?.message||"The clip library could not be loaded.");}
    finally{setBusy(false);}
  },[requestParams]);

  useEffect(()=>{refresh();},[refresh]);

  const categories=useMemo(()=>["Gaming","News","Comedy","Sport","Technology","Interview","Education","Other"],[]);
  const languages=useMemo(()=>[...new Set(clips.map(x=>x.language).filter(x=>x&&x!=="und"))].sort(),[clips]);
  const countries=useMemo(()=>[...new Set(clips.flatMap(x=>x.target_countries||[]))].sort(),[clips]);

  const sortedClips=useMemo(()=>{
    const copy=[...clips];
    if(sort==="score")copy.sort((a,b)=>(b.viral_potential_score??-1)-(a.viral_potential_score??-1));
    else if(sort==="shortest")copy.sort((a,b)=>(a.duration_seconds||0)-(b.duration_seconds||0));
    else if(sort==="longest")copy.sort((a,b)=>(b.duration_seconds||0)-(a.duration_seconds||0));
    else copy.sort((a,b)=>new Date(b.created_date||b.created_at||0)-new Date(a.created_date||a.created_at||0));
    return copy;
  },[clips,sort]);

  const loadMore=async()=>{
    if(!hasMore||busy)return;
    setBusy(true);setError("");
    try{
      const r=await listPublicInternalClips({data:{...requestParams,offset:nextOffset}});
      setClips(current=>[...current,...(r.assets||[])]);
      setNextOffset(r.nextOffset||nextOffset);
      setHasMore(!!r.hasMore);
    }catch(e){setError(e?.message||"More clips could not be loaded.");}
    finally{setBusy(false);}
  };

  const preview=clip=>{
    if(!isAuthenticated){setError("Sign in to preview and download clips.");return;}
    setError("");setSelected(clip);
  };

  const download=async clip=>{
    if(!isAuthenticated){setError("Sign in to download clips.");return;}
    setDownloading(clip.id);setError("");
    try{
      const r=await requestInternalClipDownload({data:{assetId:clip.id}});
      window.location.assign(r.downloadUrl);
    }catch(e){setError(e?.message||"Download could not be authorised.");}
    finally{setDownloading("");}
  };

  const featured=sortedClips[0];
  const formatDuration=seconds=>{
    const value=Math.max(0,Number(seconds)||0);
    return Math.floor(value/60)+":"+String(value%60).padStart(2,"0");
  };

  return <SiteFrame eyebrow="VICEHUB / VIDEO LIBRARY">
    <main className="vh-library">
      <section className="vh-library-hero">
        {featured?.thumbnail_url&&<img className="vh-library-hero-image" src={featured.thumbnail_url} alt="" />}
        <div className="vh-library-hero-shade"/>
        <div className="vh-library-hero-content">
          <div className="vh-library-kicker"><span/> THE VICEHUB VIDEO ARCHIVE <span className="vh-library-kicker-line"/></div>
          <p className="vh-library-overline">CURATED CLIPS. READY FOR YOUR NEXT POST.</p>
          <h1>FIND THE<br/><em>PERFECT CLIP.</em></h1>
          <p className="vh-library-hero-copy">Explore a growing collection of short-form video. Find the right moment, preview it, then download it for your next creation.</p>
          <div className="vh-library-hero-actions">
            <a href="#clip-catalogue" className="vh-library-primary">EXPLORE THE LIBRARY <span>↘</span></a>
            <Link to={isAuthenticated?"/dashboard":"/sign-in"} className="vh-library-secondary">{isAuthenticated?"MY ACCOUNT":"SIGN IN"} ↗</Link>
          </div>
        </div>
        <div className="vh-library-hero-stamp"><span>VICE</span><b>HUB</b><small>VIDEO ARCHIVE / 2026</small></div>
        <div className="vh-library-hero-index">01 <i/> THE CLIP COLLECTION</div>
      </section>

      <nav className="vh-library-subnav" aria-label="Library sections">
        <a className={sort==="newest"?"active":""} href="#clip-catalogue" onClick={()=>setSort("newest")}>LATEST CLIPS</a>
        <a href="#featured-clip">FEATURED</a>
        <button type="button" className={sort==="score"?"active":""} onClick={()=>setSort("score")}>TOP RATED</button>
        <span>VICEHUB ORIGINAL COLLECTION</span>
      </nav>

      <section className="vh-library-intro" id="clip-catalogue">
        <div>
          <p className="vh-library-section-kicker">THE COLLECTION / 001</p>
          <h2>YOUR NEXT <em>SCENE</em> STARTS HERE.</h2>
          <p>Search the archive, narrow your selection and preview clips before downloading.</p>
        </div>
        <div className="vh-library-count"><b>{clips.length}</b><span>CLIPS<br/>LOADED</span></div>
      </section>

      <section className="vh-library-toolbar" aria-label="Search and filter clips">
        <label className="vh-library-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search titles, topics or tags…" aria-label="Search clips"/>{query&&<button type="button" onClick={()=>setQuery("")} aria-label="Clear search">×</button>}</label>
        <label className="vh-library-filter"><span>CATEGORY</span><select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{categories.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
        <label className="vh-library-filter"><span>LANGUAGE</span><select value={language} onChange={e=>setLanguage(e.target.value)}><option value="all">All languages</option>{languages.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
        <label className="vh-library-filter"><span>MARKET</span><select value={country} onChange={e=>setCountry(e.target.value)}><option value="all">All markets</option>{countries.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
      </section>

      <div className="vh-library-results-row">
        <div><span className="vh-library-live-dot"/><b>{sortedClips.length}</b> MATCHING CLIPS <i> / </i> {hasMore?"MORE AVAILABLE":"END OF CURRENT COLLECTION"}</div>
        <label>SORT BY <select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Recently added</option><option value="score">AI potential score</option><option value="shortest">Shortest first</option><option value="longest">Longest first</option></select></label>
        <button type="button" onClick={refresh} disabled={busy} className="vh-library-refresh">{busy?"UPDATING…":"↻ REFRESH"}</button>
      </div>

      {error&&<div role="alert" className="vh-library-error">{error}{!isAuthenticated&&<Link to="/sign-in"> SIGN IN ↗</Link>}</div>}

      {featured&&<section className="vh-library-featured" id="featured-clip">
        <div className="vh-library-featured-image">
          {featured.thumbnail_url?<img src={featured.thumbnail_url} alt={featured.title}/>:<div className="vh-library-no-art">VICEHUB / FEATURED</div>}
          <span className="vh-library-featured-label">EDITOR'S PICK / LATEST DROP</span>
          <span className="vh-library-featured-duration">{formatDuration(featured.duration_seconds)}</span>
          <button type="button" onClick={()=>preview(featured)} aria-label={"Preview "+featured.title}>▶</button>
        </div>
        <div className="vh-library-featured-copy">
          <p className="vh-library-section-kicker">FEATURED CLIP / 001</p>
          <h3>{featured.title}</h3>
          <p>{featured.description||"A selected clip from the VICEHUB video archive."}</p>
          <div className="vh-library-feature-tags">{[featured.category,featured.language,...(featured.target_countries||[])].filter(Boolean).map((x,i)=><span key={x+i}>{x}</span>)}</div>
          {featured.viral_potential_score!==null&&featured.viral_potential_score!==undefined&&<div className="vh-library-score"><span>AI VIRAL POTENTIAL</span><b>{featured.viral_potential_score}<small>/100</small></b></div>}
          <div className="vh-library-feature-actions"><button type="button" onClick={()=>preview(featured)}>▶ PREVIEW CLIP</button><button type="button" onClick={()=>download(featured)} disabled={downloading===featured.id}>{downloading===featured.id?"PREPARING…":"↓ DOWNLOAD"}</button></div>
        </div>
      </section>}

      <section className="vh-library-grid" aria-label="Video clips">
        {sortedClips.map((clip,index)=><article className="vh-library-card" key={clip.id}>
          <button type="button" className="vh-library-card-art" onClick={()=>preview(clip)} aria-label={"Preview "+clip.title}>
            {clip.thumbnail_url?<img src={clip.thumbnail_url} alt={clip.title} loading={index>5?"lazy":"eager"}/>:<span className="vh-library-no-art">VICEHUB<br/>CLIP</span>}
            <span className="vh-library-card-number">{String(index+1).padStart(2,"0")}</span>
            <span className="vh-library-card-duration">{formatDuration(clip.duration_seconds)}</span>
            <span className="vh-library-card-play">▶</span>
            {clip.viral_potential_score>=90&&<span className="vh-library-best">BEST CLIP</span>}
          </button>
          <div className="vh-library-card-body">
            <div className="vh-library-card-meta"><span>{clip.category||"VIDEO"}</span><span>{clip.language&&clip.language!=="und"?clip.language:"MULTI"}</span></div>
            <h3>{clip.title}</h3>
            <p>{clip.description||"Selected from the VICEHUB video archive."}</p>
            <div className="vh-library-card-tags">{(clip.tags||[]).slice(0,3).map(tag=><span key={tag}>#{tag}</span>)}</div>
            <div className="vh-library-card-footer">
              {clip.viral_potential_score!==null&&clip.viral_potential_score!==undefined?<span className="vh-library-card-score">✦ {clip.viral_potential_score}/100</span>:<span className="vh-library-card-score">VICEHUB ARCHIVE</span>}
              <button type="button" onClick={()=>download(clip)} disabled={downloading===clip.id}>{downloading===clip.id?"…":"↓ DOWNLOAD"}</button>
            </div>
          </div>
        </article>)}
      </section>

      {!busy&&!clips.length&&<div className="vh-library-empty"><span>NO RESULTS / 000</span><h3>NOTHING IN THIS FRAME.</h3><p>No published clips match these filters. Try another category, language or market.</p><button type="button" onClick={()=>{setQuery("");setCategory("all");setLanguage("all");setCountry("all");}}>CLEAR ALL FILTERS</button></div>}
      {busy&&!clips.length&&<div className="vh-library-loading">LOADING THE ARCHIVE<span>•••</span></div>}
      {hasMore&&<div className="vh-library-load-more"><button type="button" onClick={loadMore} disabled={busy}>{busy?"LOADING…":"LOAD MORE CLIPS  ↓"}</button></div>}

      <div className="vh-library-footnote"><span>VICEHUB / CONTENT ARCHIVE</span><p>AI viral potential is an editorial estimate based on the opening hook, emotion, clarity, shareability and pacing. It is not a view or engagement result. “Best Clip” means an AI score of 90/100 or higher. Trending is not shown without verified post-publication performance data.</p></div>

      {selected&&<div className="vh-library-modal" role="dialog" aria-modal="true" aria-label={selected.title} onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
        <div className="vh-library-modal-panel">
          <div className="vh-library-modal-head"><div><span>VICEHUB / SECURE PREVIEW</span><b>{selected.title}</b></div><button type="button" onClick={()=>setSelected(null)} aria-label="Close preview">×</button></div>
          <video controls autoPlay playsInline src={"/api/internal-video-preview/"+encodeURIComponent(selected.id)}/>
          <div className="vh-library-modal-foot"><span>Preview access requires a signed-in account.</span><span>Downloads remain subject to your subscription allowance.</span></div>
        </div>
      </div>}
    </main>
  </SiteFrame>;
}
