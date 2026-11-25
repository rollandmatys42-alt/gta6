import {useCallback,useEffect,useState} from "react";
import {createFileRoute,Link} from "@tanstack/react-router";
import {AuthGateError,requireSignedIn} from "@/components/auth/AuthGate";
import {createVideoStorageSource,deleteVideoStorageSource,importLinkedStorageVideo,listVideoStorageSources,syncGoogleDriveStorageSource} from "@/lib/internal-video-fns";

export const Route=createFileRoute("/admin/storage")({ssr:false,beforeLoad:requireSignedIn,errorComponent:AuthGateError,head:()=>({meta:[{title:"Stockages vidéo — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:StoragePage});

const countries=[["US","États-Unis"],["GB","Royaume-Uni"],["FR","France"],["CA","Canada"],["BE","Belgique"],["DE","Allemagne"],["ES","Espagne"],["IT","Italie"],["NL","Pays-Bas"],["AU","Australie"]];
const panel={background:"#141d2b",border:"1px solid #2b374b",borderRadius:14,padding:"clamp(16px,3vw,24px)",marginTop:18};
const field={width:"100%",boxSizing:"border-box",padding:12,borderRadius:8,border:"1px solid #3a4961",background:"#080e18",color:"#fff",fontSize:14};
const primary={padding:"11px 15px",border:0,borderRadius:8,background:"#a6f36b",color:"#11170c",fontWeight:900,cursor:"pointer"};
const secondary={padding:"10px 13px",border:"1px solid #40506a",borderRadius:8,background:"#1a2638",color:"#fff",fontWeight:700,cursor:"pointer"};
const label={display:"grid",gap:6,fontSize:12,color:"#b9c5d5"};

function StoragePage(){
 const{user}=Route.useRouteContext();
 const[sources,setSources]=useState([]);
 const[provider,setProvider]=useState("google_drive");
 const[name,setName]=useState("");
 const[market,setMarket]=useState("US");
 const[folderUrl,setFolderUrl]=useState("");
 const[notes,setNotes]=useState("");
 const[busy,setBusy]=useState(false);
 const[active,setActive]=useState("");
 const[notice,setNotice]=useState("");
 const[error,setError]=useState("");
 const[videoSource,setVideoSource]=useState("");
 const[videoTitle,setVideoTitle]=useState("");
 const[videoUrl,setVideoUrl]=useState("");
 const[previewUrl,setPreviewUrl]=useState("");
 const[downloadUrl,setDownloadUrl]=useState("");
 const[rights,setRights]=useState("pending");
 const[evidence,setEvidence]=useState("");
 const[category,setCategory]=useState("Gaming");

 const refresh=useCallback(async()=>{setBusy(true);setError("");try{const r=await listVideoStorageSources({data:{}});setSources(Array.isArray(r)?r:[]);}catch(e){setError(e?.message||"Impossible de charger les stockages.");}finally{setBusy(false);}},[]);
 useEffect(()=>{if(user?.role==="admin")refresh();},[user?.role,refresh]);
 if(user?.role!=="admin")return <main><h1>Accès refusé</h1></main>;

 const addSource=async e=>{e.preventDefault();setBusy(true);setError("");setNotice("");try{
  await createVideoStorageSource({data:{name,provider,marketCountry:market,folderUrl:folderUrl.trim()||undefined,notes}});
  setName("");setFolderUrl("");setNotes("");setNotice("Source ajoutée.");await refresh();
 }catch(e){setError(e?.message||"Impossible d'ajouter cette source.");}finally{setBusy(false);}};
 const sync=async source=>{setActive(source.id);setError("");setNotice("");try{const r=await syncGoogleDriveStorageSource({data:{sourceId:source.id}});setNotice(r.imported+" vidéo(s) ajoutée(s), "+r.skipped+" déjà présente(s).");}catch(e){setError(e?.message||"Synchronisation impossible.");}finally{setActive("");}};
 const remove=async source=>{if(!window.confirm("Supprimer cette source de la liste ? Les vidéos déjà importées ne seront pas supprimées."))return;setActive(source.id);try{await deleteVideoStorageSource({data:{sourceId:source.id}});await refresh();setNotice("Source supprimée. Les vidéos déjà importées sont conservées.");}catch(e){setError(e?.message||"Suppression impossible.");}finally{setActive("");}};
 const importVideo=async e=>{e.preventDefault();setBusy(true);setError("");setNotice("");try{
  let preview=previewUrl.trim()||videoUrl.trim();
  let download=downloadUrl.trim()||videoUrl.trim();
  if(!previewUrl.trim()&&/mega\.nz\/(file|folder)\/([^#?]+)#([^?]+)/i.test(videoUrl)){
   const m=videoUrl.match(/mega\.nz\/(?:file|folder)\/([^#?]+)#([^?]+)/i);
   if(m)preview="https://mega.nz/embed/"+m[1]+"#"+m[2];
  }
  const r=await importLinkedStorageVideo({data:{sourceId:videoSource,title:videoTitle,videoUrl,previewUrl:preview,downloadUrl:download,category,language:"und",rightsStatus:rights,...(evidence.trim()?{rightsEvidenceUrl:evidence.trim()}:{})}});
  setNotice(r.alreadyImported?"Cette vidéo est déjà dans la bibliothèque.":"Vidéo ajoutée. Elle apparaîtra aux abonnés après validation des droits et publication.");
  setVideoTitle("");setVideoUrl("");setPreviewUrl("");setDownloadUrl("");setEvidence("");
 }catch(e){setError(e?.message||"Import de la vidéo impossible.");}finally{setBusy(false);}};
 return <main style={{minHeight:"100vh",background:"#090e17",color:"#fff",padding:"28px max(16px,4vw)",fontFamily:"Inter,system-ui,sans-serif"}}>
  <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:14,flexWrap:"wrap",borderBottom:"1px solid #263247",paddingBottom:18}}>
   <div><Link to="/admin" style={{color:"#a6f36b",textDecoration:"none",fontWeight:900}}>VICEHUB / ADMINISTRATION</Link><h1 style={{fontSize:"clamp(30px,4vw,48px)",margin:"12px 0 0"}}>Stockages vidéo</h1></div>
   <div style={{display:"flex",gap:10,flexWrap:"wrap"}}><Link to="/admin/video-library" style={{color:"#a6f36b"}}>Bibliothèque vidéo</Link><Link to="/admin/import" style={{color:"#a6f36b"}}>Importer depuis Drive</Link></div>
  </header>
  <p style={{color:"#aab6c8",maxWidth:800,lineHeight:1.65}}>Ajoutez vos espaces de stockage et associez chaque source à un marché. Les fichiers restent chez leur fournisseur : VICEHUB enregistre les liens et les informations utiles à la bibliothèque.</p>
  {error&&<p role="alert" style={{color:"#ffadb5"}}>{error}</p>}{notice&&<p role="status" style={{color:"#a6f3b7"}}>{notice}</p>}
  <section style={panel}>
   <h2 style={{marginTop:0,fontSize:21}}>Ajouter un espace de stockage</h2>
   <form onSubmit={addSource} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
    <label style={label}>Nom de la source<input required minLength={2} value={name} onChange={e=>setName(e.target.value)} placeholder="Drive France / MEGA USA" style={field}/></label>
    <label style={label}>Fournisseur<select value={provider} onChange={e=>setProvider(e.target.value)} style={field}><option value="google_drive">Google Drive</option><option value="mega">MEGA</option><option value="onedrive">OneDrive</option><option value="dropbox">Dropbox</option><option value="direct_url">Lien direct</option></select></label>
    <label style={label}>Marché<select value={market} onChange={e=>setMarket(e.target.value)} style={field}>{countries.map(([code,country])=><option key={code} value={code}>{country} ({code})</option>)}</select></label>
    <label style={{...label,gridColumn:"1 / -1"}}>{provider==="google_drive"?"Lien du dossier Google Drive":"Lien du dossier partagé"}<input value={folderUrl} onChange={e=>setFolderUrl(e.target.value)} placeholder="https://…" type="url" style={field}/></label>
    <label style={{...label,gridColumn:"1 / -1"}}>Notes (facultatif)<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Ex. clips GTA, vertical 9:16" style={field}/></label>
    <div><button disabled={busy||!name.trim()||!folderUrl.trim()} style={primary}>{busy?"Enregistrement…":"Ajouter le stockage"}</button></div>
   </form>
   <p style={{color:"#8fa0b5",fontSize:12,lineHeight:1.5,marginBottom:0}}>Google Drive peut être synchronisé automatiquement depuis un dossier connecté. Pour MEGA, OneDrive et Dropbox, cette première version enregistre les sources et permet d'ajouter les liens vidéo individuels ; la navigation automatique de leurs dossiers nécessite leur API ou leur SDK.</p>
  </section>
  <section style={panel}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><h2 style={{margin:0,fontSize:21}}>Mes stockages ({sources.length})</h2><button onClick={refresh} disabled={busy} style={secondary}>Actualiser</button></div>
   <div style={{display:"grid",gap:10,marginTop:14}}>
    {sources.map(source=><article key={source.id} style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap",background:"#0b121e",border:"1px solid #2b384d",borderRadius:10,padding:14}}>
     <div style={{flex:1,minWidth:220}}><strong>{source.name}</strong><div style={{fontSize:12,color:"#aab6c8",marginTop:5}}>{String(source.provider||"").replace("_"," ").toUpperCase()} · {source.market_country} · {source.enabled?"Actif":"Désactivé"}</div>{source.folder_url&&<a href={source.folder_url} target="_blank" rel="noreferrer" style={{fontSize:12,color:"#a6f36b"}}>Ouvrir le dossier ↗</a>}</div>
     <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{source.provider==="google_drive"&&<button disabled={!!active} onClick={()=>sync(source)} style={primary}>{active===source.id?"Synchronisation…":"Synchroniser les vidéos"}</button>}<button disabled={!!active} onClick={()=>remove(source)} style={secondary}>Supprimer</button></div>
    </article>)}
    {!sources.length&&<p style={{color:"#91a0b5"}}>Aucun stockage ajouté pour le moment.</p>}
   </div>
  </section>
  <section style={panel}>
   <h2 style={{marginTop:0,fontSize:21}}>Ajouter une vidéo depuis un stockage</h2>
   <form onSubmit={importVideo} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
    <label style={label}>Stockage<select required value={videoSource} onChange={e=>setVideoSource(e.target.value)} style={field}><option value="">Choisir une source</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name} — {s.market_country}</option>)}</select></label>
    <label style={label}>Titre<input required minLength={2} value={videoTitle} onChange={e=>setVideoTitle(e.target.value)} style={field}/></label>
    <label style={{...label,gridColumn:"1 / -1"}}>Lien du fichier vidéo ou lien MEGA<input required type="url" value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} placeholder="https://…" style={field}/></label>
    <label style={label}>Lien d'aperçu (facultatif)<input type="url" value={previewUrl} onChange={e=>setPreviewUrl(e.target.value)} placeholder="URL de lecture ou embed" style={field}/></label>
    <label style={label}>Lien de téléchargement (facultatif)<input type="url" value={downloadUrl} onChange={e=>setDownloadUrl(e.target.value)} placeholder="URL de téléchargement" style={field}/></label>
    <label style={label}>Catégorie<select value={category} onChange={e=>setCategory(e.target.value)} style={field}>{["Gaming","News","Comedy","Sport","Technology","Interview","Education","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
    <label style={label}>Droits<select value={rights} onChange={e=>setRights(e.target.value)} style={field}><option value="pending">À vérifier</option><option value="authorised">Autorisée — preuve disponible</option><option value="restricted">Restreinte</option><option value="not_applicable">Non applicable</option></select></label>
    <label style={{...label,gridColumn:"1 / -1"}}>Preuve écrite des droits (URL)<input type="url" value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Obligatoire si les droits sont marqués autorisés" style={field}/></label>
    <div><button disabled={busy||!videoSource||!videoUrl.trim()||!videoTitle.trim()||(rights==="authorised"&&!evidence.trim())} style={primary}>{busy?"Import…":"Ajouter à la bibliothèque"}</button></div>
   </form>
  </section>
 </main>;
}
