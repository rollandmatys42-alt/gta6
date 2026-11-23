import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createVideoRecord, createVideoUploadUrl, publishVideo, testVideoStorage, getAdminVideoLibrary, updateAdminVideo, archiveAdminVideo, importAdminVideoMetadataCsv } from "@/lib/server-fns";

export const Route = createFileRoute("/_authed/admin/videos")({
  ssr: false,
  head: () => ({ meta: [{ title: "Video administration — VICEHUB" }] }),
  component: AdminVideosPage,
});

async function uploadAsset(file, assetVariant) {
  const signed = await createVideoUploadUrl({
    data: { fileName: file.name, contentType: file.type, assetVariant },
  });
  const response = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) throw new Error("Private storage rejected the " + assetVariant + " upload (HTTP " + response.status + "). Check R2 CORS and bucket permissions.");
  return signed.objectKey;
}


async function createWatermarkedRendition(file, onProgress) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("This browser cannot create a watermarked MP4. Use an up-to-date Chrome or Edge browser on a desktop.");
  }
  const video = document.createElement("video");
  const sourceUrl = URL.createObjectURL(file);
  let recorder = null, raf = 0;
  let videoStream = null, canvasStream = null;
  video.src = sourceUrl;
  video.preload = "auto";
  video.playsInline = true;
  video.muted = false;
  video.volume = 1;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("The source video could not be decoded by this browser."));
      video.load();
    });
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      throw new Error("The source video has invalid dimensions or duration.");
    }
    const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
    const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
    const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not initialise the video watermark renderer.");
    const capture = typeof video.captureStream === "function" ? video.captureStream.bind(video)
      : typeof video.mozCaptureStream === "function" ? video.mozCaptureStream.bind(video) : null;
    if (!capture) throw new Error("This browser cannot capture the source video's audio. Use Chrome or Edge on desktop.");
    videoStream = capture();
    canvasStream = canvas.captureStream(30);
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...videoStream.getAudioTracks()]);
    const mimeType = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]
      .find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("MP4/H.264 recording is not supported by this browser. No unwatermarked file will be uploaded.");
    recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
    const chunks = [];
    const result = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("The browser stopped while generating the watermarked MP4."));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/mp4" });
        if (!blob.size) reject(new Error("The watermark renderer produced an empty video."));
        else resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + "-vicehub-watermarked.mp4", { type: "video/mp4" }));
      };
    });
    let lastProgress = -1;
    const drawFrame = () => {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, width, height);
        const pad = Math.max(16, Math.round(width * 0.018));
        const fontSize = Math.max(18, Math.round(width * 0.027));
        ctx.save();
        ctx.font = "900 " + fontSize + "px Arial, sans-serif";
        const textWidth = ctx.measureText("VICEHUB").width;
        const boxWidth = textWidth + pad * 2;
        const boxHeight = fontSize + pad * 1.25;
        const x = width - boxWidth - pad;
        const y = height - boxHeight - pad;
        ctx.fillStyle = "rgba(8, 9, 16, 0.62)";
        ctx.fillRect(x, y, boxWidth, boxHeight);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,.75)";
        ctx.shadowBlur = 5;
        ctx.textBaseline = "middle";
        ctx.fillText("VICEHUB", x + pad, y + boxHeight / 2);
        ctx.restore();
      }
      const progress = Math.min(99, Math.round((video.currentTime / video.duration) * 100));
      if (progress !== lastProgress) { lastProgress = progress; onProgress?.(progress); }
      if (!video.ended && !video.error) raf = requestAnimationFrame(drawFrame);
    };
    const ended = new Promise(resolve => video.addEventListener("ended", resolve, { once: true }));
    recorder.start(1000);
    await video.play();
    drawFrame();
    await ended;
    if (raf) cancelAnimationFrame(raf);
    drawFrame();
    await new Promise(resolve => setTimeout(resolve, 180));
    if (recorder.state !== "inactive") recorder.stop();
    const output = await result;
    onProgress?.(100);
    return output;
  } catch (error) {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    throw error;
  } finally {
    if (raf) cancelAnimationFrame(raf);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    for (const track of [...(videoStream?.getTracks() || []), ...(canvasStream?.getTracks() || [])]) track.stop();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

function AdminVideosPage() {
  const { user } = Route.useRouteContext();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Gameplay");
  const [language, setLanguage] = useState("en");
  const [isFeatured, setIsFeatured] = useState(false);
  const [creatorName, setCreatorName] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [licenseVerified, setLicenseVerified] = useState(false);
  const [originalFile, setOriginalFile] = useState(null);
  const [watermarkProgress, setWatermarkProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [storageState, setStorageState] = useState("unchecked");
  const [storageDetails, setStorageDetails] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const [videos, setVideos] = useState([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("All");
  const [libraryStatus, setLibraryStatus] = useState("All");
  const [libraryRights, setLibraryRights] = useState("All");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [editingVideo, setEditingVideo] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const refreshLibrary = async () => { setLibraryBusy(true); try { setVideos(await getAdminVideoLibrary()); } catch (err) { setError(err?.message || "Could not load the video library."); } finally { setLibraryBusy(false); } };
  const importCsv = async (event) => { event.preventDefault(); const form = event.currentTarget; if (!csvFile) return; setBusy(true); setError(""); setMessage(""); try { const result = await importAdminVideoMetadataCsv({ data: { csvText: await csvFile.text() } }); setImportResult(result); setMessage(result.message); setCsvFile(null); form.reset(); await refreshLibrary(); } catch (err) { setError(err?.message || "CSV import failed."); } finally { setBusy(false); } };
  useEffect(() => { if (user?.role === "admin") refreshLibrary(); }, [user?.id]);

  if (user?.role !== "admin") return <main className="account-page"><section className="account-content"><h1>ACCESS DENIED.</h1><p className="account-intro">Administrator permissions are required to manage video content.</p><button className="outline-btn" onClick={() => window.location.assign("/dashboard")}>Back to account</button></section></main>;

  const checkStorage = async () => {
    setStorageBusy(true);
    setStorageState("checking");
    setStorageDetails("");
    setError("");
    try {
      const result = await testVideoStorage();
      if (!result?.ok || result.testObjectRemoved !== true) throw new Error("Storage test did not confirm write, read-back and cleanup.");
      setStorageState("ready");
      setStorageDetails("Private storage verified · write, read-back and cleanup passed · " + result.latencyMs + " ms.");
    } catch (err) {
      setStorageState("failed");
      setStorageDetails(err?.message || "Private storage could not be verified.");
    } finally {
      setStorageBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(""); setMessage("");
    if (storageState !== "ready") {
      setError("Run and pass the private storage check before uploading. No file has been sent.");
      return;
    }
    if (!originalFile) {
      setError("Choose the original video. VICEHUB will generate the watermarked MP4 automatically in your browser.");
      return;
    }
    if (licenseVerified && !sourceReference.trim()) {
      setError("Add a source or rights reference before marking the licence as verified.");
      return;
    }
    setBusy(true);
    try {
      setWatermarkProgress(0);
      setMessage("1/4 — Creating the VICEHUB watermarked MP4 locally. Keep this tab open…");
      const watermarkedFile = await createWatermarkedRendition(originalFile, setWatermarkProgress);
      setMessage("2/4 — Uploading the clean master to private storage…");
      const originalStorageKey = await uploadAsset(originalFile, "original");
      setMessage("3/4 — Uploading the generated watermarked rendition…");
      const watermarkedStorageKey = await uploadAsset(watermarkedFile, "watermarked");
      setMessage("4/4 — Saving video metadata…");
      const video = await createVideoRecord({ data: {
        title, description, category, language, isFeatured, creatorName,
        ...(thumbnailUrl.trim() ? { thumbnailUrl: thumbnailUrl.trim() } : {}),
        ...(sourceReference.trim() ? { sourceReference: sourceReference.trim() } : {}),
        ...(durationSeconds ? { durationSeconds: Number(durationSeconds) } : {}),
        licenseVerified, originalStorageKey, watermarkedStorageKey,
      }});
      if (licenseVerified) {
        await publishVideo({ data: { videoId: video.id } });
        setMessage("Video uploaded, rights marked verified and published to the public library.");
      } else {
        setMessage("Video uploaded as a draft. Verify its rights before publishing.");
      }
      setTitle(""); setDescription(""); setCreatorName(""); setSourceReference(""); setThumbnailUrl(""); setLanguage("en"); setIsFeatured(false);
      setDurationSeconds(""); setLicenseVerified(false); setOriginalFile(null); setWatermarkProgress(0);
      event.target.reset();
      await refreshLibrary();
    } catch (err) {
      setError(err?.message || "Video upload failed.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const visibleVideos = videos.filter(video => {
    const term = librarySearch.trim().toLowerCase();
    const matchesSearch = !term || [video.title, video.description, video.creator_name, video.source_reference, ...(video.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(term);
    return matchesSearch && (libraryCategory === "All" || video.category === libraryCategory) && (libraryStatus === "All" || video.status === libraryStatus) && (libraryRights === "All" || video.license_status === libraryRights);
  });

  return (
    <main className="account-page">
      <header className="account-header">
        <button className="brand" onClick={() => window.location.assign("/")}><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>CREATOR NETWORK</small></span></button>
        <div className="account-header-actions"><span>Administrator</span><button className="outline-btn" onClick={() => window.location.assign("/dashboard")}>My account</button></div>
      </header>
      <section className="account-content admin-video-content">
        <div className="eyebrow">CONTENT CONTROL / VIDEO INGESTION</div>
        <h1>ADD FOOTAGE.</h1>
        <p className="account-intro">Upload licensed content into private storage. Videos remain drafts until rights and both renditions are ready.</p>
        <div className="admin-warning"><b>Automatic watermark protection</b><span>VICEHUB generates a permanent MP4 watermark in your browser. The clean master and watermarked copy are stored separately in private storage. Free downloads receive the branded copy; paid access follows the active plan entitlement. Browser-side rendering is not a server-side transcoding pipeline: keep this tab open and use a desktop browser for ingestion.</span></div>
        <section className="admin-warning" aria-live="polite">
          <b>PRIVATE STORAGE READINESS</b>
          <span>{storageState === "ready" ? storageDetails : storageState === "checking" ? "Testing private storage permissions…" : storageState === "failed" ? storageDetails : "Storage has not yet been tested in this session. Uploads are locked until a real write, read-back and cleanup test succeeds."}</span>
          <div className="admin-form-actions"><button className="outline-btn" type="button" onClick={checkStorage} disabled={storageBusy || busy}>{storageBusy ? "Checking…" : storageState === "ready" ? "Recheck storage" : "Test private storage"}</button><span>{storageState === "ready" ? "READY" : storageState === "failed" ? "NOT READY" : "NOT CHECKED"}</span></div>
        </section>
        <form className="admin-video-form" onSubmit={submit}>
          <label>Video title<input required minLength={2} maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Vice City night drive" /></label>
          <label>Description<textarea maxLength={3000} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Describe the footage and permitted use." /></label>
          <div className="admin-form-row">
            <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{["Gameplay","Cinematics","Characters","Vehicles","Locations","Missions","Shorts","Edit packs","Tutorials","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
            <label>Video language<select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="fr">Français</option><option value="es">Español</option><option value="pt">Português</option><option value="it">Italiano</option><option value="de">Deutsch</option></select></label>
          </div>
          <div className="admin-form-row">
            <label>Duration (seconds)<input type="number" min="0" max="86400" value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} placeholder="Optional" /></label>
            <label>Thumbnail URL<input type="url" value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} placeholder="https://…" /></label>
          </div>
          <label>Creator / source name<input maxLength={80} value={creatorName} onChange={(e) => setCreatorName(e.target.value)} placeholder="Creator name" /></label>
          <label>Rights / licence evidence reference<input type="url" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="URL to written permission or licence evidence" /><small>Use a reference to actual written rights evidence. A public source URL or a checkbox alone does not grant commercial rights.</small></label>
          <label className="license-check"><input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} /> Feature as “Video of the Moment”</label>
          <div className="admin-form-row upload-pair">
            <label>Original video (.mp4 / .mov)<input required type="file" accept="video/mp4,video/quicktime" onChange={(e) => { setOriginalFile(e.target.files?.[0] || null); setWatermarkProgress(0); }} /><small>{originalFile?.name || "Choose the clean master video"}</small></label>
          </div>
          {originalFile && <div className="watermark-progress-panel"><div><b>AUTOMATIC WATERMARK</b><span>{watermarkProgress > 0 ? watermarkProgress + "% processed" : "Generated when you upload this video"}</span></div><div className="quota-track"><i style={{ width: watermarkProgress + "%" }} /></div><small>The watermark is burned into every frame. Processing runs locally in this browser before either file is uploaded.</small></div>}
          <label className="license-check"><input type="checkbox" checked={licenseVerified} onChange={(e) => setLicenseVerified(e.target.checked)} /> I have checked and documented the rights needed to distribute this footage.</label>
          {error && <div className="account-error" role="alert">{error}</div>}
          {message && <div className="admin-status" role="status">{message}</div>}
          <div className="admin-form-actions"><button className="outline-btn" type="button" onClick={() => window.location.assign("/dashboard")}>Cancel</button><button className="primary-btn" type="submit" disabled={busy || storageState !== "ready"}>{busy ? "Uploading…" : "Upload video ↗"}</button></div>
        </form>
        <section className="admin-video-csv-import">
          <div className="eyebrow">BULK CATALOGUE INGESTION</div><h2>Import up to 1,000 video metadata rows</h2>
          <p>CSV import creates draft records only. It does not upload video files, verify licences or publish content.</p>
          <form onSubmit={importCsv}><label>Metadata CSV<input type="file" accept=".csv,text/csv" required onChange={e=>setCsvFile(e.target.files?.[0]||null)}/></label><button className="outline-btn" type="submit" disabled={busy||!csvFile}>{busy?"Importing…":"Import metadata CSV"}</button></form>
          <small>Required columns: <code>title,category</code>. Optional: <code>description,language,creator_name,source_reference,duration_seconds</code>. <a download="vicehub-video-import-template.csv" href={"data:text/csv;charset=utf-8,"+encodeURIComponent("title,category,description,language,creator_name,source_reference,duration_seconds"+String.fromCharCode(10))}>Download CSV template</a>.</small>
          {importResult&&<div className="admin-status">Imported: {importResult.imported} · Rejected: {importResult.rejected}{importResult.errors?.length>0&&<ul>{importResult.errors.map((x,i)=><li key={i}>Line {x.line}: {x.reason}</li>)}</ul>}</div>}
        </section>
        <section className="admin-video-library">
          <div className="admin-video-library-head"><div><div className="eyebrow">CONTENT LIBRARY / INVENTORY</div><h2>VIDEO LIBRARY ({videos.length})</h2><p>Manage metadata, rights verification, featured status and publication state. Showing {visibleVideos.length} matching records.</p></div><button className="outline-btn" type="button" onClick={refreshLibrary} disabled={libraryBusy}>{libraryBusy?"Refreshing…":"Refresh library"}</button></div>
          <div className="admin-video-library-filters"><input aria-label="Search videos" value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)} placeholder="Search title, creator, description or source…" /><select aria-label="Filter category" value={libraryCategory} onChange={e=>setLibraryCategory(e.target.value)}><option>All</option>{["Cinematics","Gameplay","Characters","Vehicles","Locations","Missions","Shorts","Edit packs","Tutorials","Other"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Filter publication status" value={libraryStatus} onChange={e=>setLibraryStatus(e.target.value)}><option>All</option>{["draft","published","archived"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Filter rights status" value={libraryRights} onChange={e=>setLibraryRights(e.target.value)}><option>All</option>{["pending","verified","restricted"].map(x=><option key={x}>{x}</option>)}</select></div>
          {visibleVideos.length ? <div className="admin-video-library-table-wrap"><table className="admin-video-library-table"><thead><tr><th>VIDEO</th><th>CATEGORY</th><th>RIGHTS</th><th>STATUS</th><th>FEATURED</th><th>ACTIONS</th></tr></thead><tbody>{visibleVideos.map(video=><tr key={video.id}><td><b>{video.title}</b><small>{video.language?.toUpperCase()} · {video.creator_name||"Creator not set"}</small></td><td>{video.category}</td><td>{video.license_status}{video.source_reference&&<small><a href={video.source_reference} target="_blank" rel="noreferrer">Rights reference ↗</a></small>}</td><td>{video.status}</td><td>{video.is_featured?"Yes":"No"}</td><td><div className="admin-video-actions"><button type="button" className="text-btn" onClick={()=>setEditingVideo({...video})}>Edit details</button><button type="button" className="text-btn" onClick={async()=>{try{await updateAdminVideo({data:{videoId:video.id,isFeatured:!video.is_featured}});await refreshLibrary();}catch(err){setError(err?.message||"Update failed.");}}}>{video.is_featured?"Unfeature":"Feature"}</button>{video.license_status!=="verified"&&video.source_reference&&<button type="button" className="text-btn" onClick={async()=>{if(!window.confirm("Confirm that you have verified the rights and permission to distribute this video?"))return;try{await updateAdminVideo({data:{videoId:video.id,licenseStatus:"verified"}});await refreshLibrary();}catch(err){setError(err?.message||"Rights update failed.");}}}>Verify rights</button>}{video.status==="draft"&&video.license_status==="verified"&&video.storage_key&&video.watermarked_storage_key&&<button type="button" className="text-btn" onClick={async()=>{try{await publishVideo({data:{videoId:video.id}});await refreshLibrary();}catch(err){setError(err?.message||"Publish failed.");}}}>Publish</button>}<button type="button" className="text-btn" onClick={async()=>{try{await archiveAdminVideo({data:{videoId:video.id,archived:video.status!=="archived"}});await refreshLibrary();}catch(err){setError(err?.message||"Archive failed.");}}}>{video.status==="archived"?"Restore draft":"Archive"}</button></div></td></tr>)}</tbody></table></div> : <div className="platform-empty">{libraryBusy?"Loading video records…":videos.length?"No videos match these filters. Clear the search or change the filters.":"No videos have been added yet. The catalogue remains empty until real licensed footage is uploaded."}</div>}
          {editingVideo&&<div className="admin-video-edit-backdrop" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setEditingVideo(null);}}><form className="admin-video-edit-modal" onSubmit={async e=>{e.preventDefault();setEditBusy(true);setError("");try{const payload={videoId:editingVideo.id,title:editingVideo.title,description:editingVideo.description||"",category:editingVideo.category,language:editingVideo.language||"en"};if(editingVideo.source_reference)payload.sourceReference=editingVideo.source_reference;await updateAdminVideo({data:payload});setEditingVideo(null);await refreshLibrary();setMessage("Video metadata updated.");}catch(err){setError(err?.message||"Could not update video metadata.");}finally{setEditBusy(false);}}}><div className="admin-video-edit-head"><div><div className="eyebrow">CATALOGUE / METADATA</div><h3>Edit video details</h3></div><button type="button" className="text-btn" onClick={()=>setEditingVideo(null)}>Close ×</button></div><label>Title<input required maxLength={140} value={editingVideo.title||""} onChange={e=>setEditingVideo({...editingVideo,title:e.target.value})}/></label><label>Description<textarea rows={4} maxLength={3000} value={editingVideo.description||""} onChange={e=>setEditingVideo({...editingVideo,description:e.target.value})}/></label><div className="admin-form-row"><label>Category<select value={editingVideo.category||"Other"} onChange={e=>setEditingVideo({...editingVideo,category:e.target.value})}>{["Cinematics","Gameplay","Characters","Vehicles","Locations","Missions","Shorts","Edit packs","Tutorials","Other"].map(x=><option key={x}>{x}</option>)}</select></label><label>Language<select value={editingVideo.language||"en"} onChange={e=>setEditingVideo({...editingVideo,language:e.target.value})}>{["en","fr","es","pt","it","de"].map(x=><option key={x} value={x}>{x.toUpperCase()}</option>)}</select></label></div><label>Rights / source reference<input type="url" value={editingVideo.source_reference||""} onChange={e=>setEditingVideo({...editingVideo,source_reference:e.target.value})} placeholder="https://…"/></label><div className="admin-form-actions"><button type="button" className="outline-btn" onClick={()=>setEditingVideo(null)}>Cancel</button><button type="submit" className="primary-btn" disabled={editBusy}>{editBusy?"Saving…":"Save metadata"}</button></div></form></div>}
        </section>
      </section>
    </main>
  );
}
