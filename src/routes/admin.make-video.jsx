import {useState} from "react";
import {createFileRoute,Link} from "@tanstack/react-router";
import {AuthGateError,requireSignedIn} from "@/components/auth/AuthGate";
import {createExternalVideoSource} from "@/lib/external-video-fns";
import {enqueueInternalVideoJob} from "@/lib/internal-video-fns";

const TEST_URL="https://www.youtube.com/watch?v=Zk_6kPubA1g";
export const Route=createFileRoute("/admin/make-video")({ssr:false,beforeLoad:requireSignedIn,errorComponent:AuthGateError,head:()=>({meta:[{title:"Make Video — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:MakeVideoPage});

function MakeVideoPage(){
 const{user}=Route.useRouteContext();
 const[url,setUrl]=useState(TEST_URL);
 const[title,setTitle]=useState("");
 const[rights,setRights]=useState(true);
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState("");
 const[error,setError]=useState("");
 if(user?.role!=="admin")return <main><h1>Access denied</h1></main>;
 const submit=async e=>{
  e.preventDefault();setBusy(true);setError("");setMessage("");
  try{
   const source=await createExternalVideoSource({data:{sourceUrl:url.trim(),title:title.trim(),rightsAttested:rights}});
   const job=await enqueueInternalVideoJob({data:{assetId:source.asset.id,jobType:"analyse"}});
   setMessage("La vidéo a été ajoutée à la file de traitement. "+(job.message||""));
  }catch(err){setError(err?.message||"Impossible de lancer le traitement.");}
  finally{setBusy(false);}
 };
 return <main style={{minHeight:"100vh",background:"#090e17",color:"#f4f6fb",padding:"28px clamp(16px,4vw,48px) 56px",fontFamily:"Inter,system-ui,sans-serif"}}>
  <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,borderBottom:"1px solid #273348",paddingBottom:18}}>
   <div><Link to="/admin" style={{color:"#a6f36b",textDecoration:"none",fontWeight:900}}>VICEHUB / ADMIN</Link><div style={{fontSize:11,color:"#8f9db1",marginTop:7}}>VIDEO CREATION</div></div>
   <Link to="/admin" style={{color:"#a6f36b",textDecoration:"none"}}>← Retour à l'administration</Link>
  </header>
  <section style={{maxWidth:980,margin:"48px auto 0"}}>
   <div style={{display:"flex",alignItems:"center",gap:10,color:"#a6f36b",fontSize:11,fontWeight:800,letterSpacing:".18em"}}><span style={{width:8,height:8,borderRadius:99,background:"#a6f36b"}}/> MAKE VIDEO</div>
   <h1 style={{fontSize:"clamp(38px,6vw,66px)",letterSpacing:"-.055em",lineHeight:1.02,margin:"18px 0"}}>Turn long videos<br/><span style={{color:"#a6f36b"}}>into short clips.</span></h1>
   <p style={{maxWidth:650,color:"#a2afc2",fontSize:15,lineHeight:1.7}}>Paste a video link to start the analysis and clip preparation workflow.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))",gap:12,margin:"30px 0"}}>
    {[[ "01","Video source","Paste a supported video URL."],["02","AI analysis","The source is analysed and transcribed."],["03","Clip processing","Detected moments are prepared as clips."],["04","Review","Review and manage the generated clips."]].map(([n,t,d])=><div key={n} style={{background:"#121b29",border:"1px solid #29364a",borderRadius:13,padding:17}}><div style={{color:"#a6f36b",fontSize:11,fontWeight:900}}>{n}</div><h2 style={{fontSize:16,margin:"10px 0 5px"}}>{t}</h2><p style={{fontSize:12,color:"#9ca8bb",lineHeight:1.5,margin:0}}>{d}</p></div>)}
   </div>
   <form onSubmit={submit} style={{background:"#121b29",border:"1px solid #35445b",borderRadius:16,padding:"clamp(20px,4vw,32px)",display:"grid",gap:14}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><h2 style={{fontSize:19,margin:0}}>Create a video project</h2><span style={{fontSize:10,color:"#a6f36b",letterSpacing:".12em"}}>YOUTUBE LINK PRELOADED</span></div>
    <label htmlFor="make-video-url" style={{fontSize:13,fontWeight:700}}>Video URL</label>
    <input id="make-video-url" type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" style={field}/>
    <label htmlFor="make-video-title" style={{fontSize:13,fontWeight:700}}>Project title <span style={{color:"#8391a6",fontWeight:400}}>(optional)</span></label>
    <input id="make-video-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Automatically detected if available" style={field}/>
    <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:12,color:"#bdc8d7",lineHeight:1.5}}><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)} style={{marginTop:2}}/>I confirm that VICEHUB has the necessary rights or permission to process this video.</label>
    {error&&<p role="alert" style={{color:"#ffadb5",margin:0}}>{error}</p>}
    {message&&<p role="status" style={{color:"#a6f3b7",margin:0}}>{message}</p>}
    <button disabled={busy||!url.trim()||!rights} style={{padding:16,border:0,borderRadius:9,background:"#a6f36b",color:"#11170c",fontWeight:900,fontSize:14,cursor:busy?"wait":"pointer",opacity:busy?.65:1}}>{busy?"Starting video analysis…":"Generate clips →"}</button>
   </form>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:20,fontSize:12}}><span style={{color:"#8f9db1"}}>Processing status and generated clips remain in the existing admin library.</span><Link to="/admin/video-library" style={{color:"#a6f36b"}}>Open clip library →</Link></div>
  </section>
 </main>;
}
const field={width:"100%",boxSizing:"border-box",padding:15,borderRadius:9,border:"1px solid #3a4961",background:"#080e18",color:"#fff",fontSize:14};
