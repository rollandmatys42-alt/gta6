import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import "@/styles/fan-admin.css";
import { createVideoRecord, createVideoUploadUrl, publishVideo, testVideoStorage, getAdminVideoLibrary, updateAdminVideo, archiveAdminVideo, importAdminVideoMetadataCsv, getAdminFreeSamplePack, lockFreeSamplePack, getVideoPreviewUrl } from "@/lib/server-fns";
import { getStorageConnections, saveStorageConnection, testStorageConnection, disableStorageConnection } from "@/lib/server-fns";

export const Route = createFileRoute("/_authed/admin/videos")({
  ssr: false,
  head: () => ({ meta: [{ title: "Video administration — VICEHUB" }] }),
  component: AdminVideosPage,
});

async function uploadAsset(file, assetVariant, storageConnectionId, reservedBytes = 0) {
  const signed = await createVideoUploadUrl({
    data: { fileName: file.name, contentType: file.type, assetVariant, fileSize: file.size, reservedBytes, ...(storageConnectionId ? { storageConnectionId } : {}) },
  });
  const response = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) throw new Error("Private storage rejected the " + assetVariant + " upload (HTTP " + response.status + "). Check R2 CORS and bucket permissions.");
  return { objectKey: signed.objectKey, storageConnectionId: signed.storageConnectionId || null };
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
  const [samplePackConfig,setSamplePackConfig]=useState({locked:false,selectedCount:0,selected:[]});
  const [samplePackBusy,setSamplePackBusy]=useState(false);
  const [storageConnections,setStorageConnections]=useState([]);
  const [storageName,setStorageName]=useState("");
  const [storageProvider,setStorageProvider]=useState("cloudflare-r2");
  const [storageEndpoint,setStorageEndpoint]=useState("");
  const [storageBucket,setStorageBucket]=useState("");
  const [storageRegion,setStorageRegion]=useState("auto");
  const [storageAccessKey,setStorageAccessKey]=useState("");
  const [storageSecretKey,setStorageSecretKey]=useState("");
  const [storageCapacity,setStorageCapacity]=useState("");
  const [storageSaveBusy,setStorageSaveBusy]=useState(false);
  const [adminPreview,setAdminPreview]=useState(null);
  const [libraryOffset,setLibraryOffset]=useState(0);
  const [libraryHasMore,setLibraryHasMore]=useState(false);
  const refreshLibrary = async () => { setLibraryBusy(true); try { const [rows,pack,connections]=await Promise.all([getAdminVideoLibrary({data:{offset:0,limit:48}}),getAdminFreeSamplePack(),getStorageConnections()]);setVideos(rows.videos);setLibraryOffset(rows.nextOffset);setLibraryHasMore(rows.hasMore);setSamplePackConfig(pack);setStorageConnections(connections); } catch (err) { setError(err?.message || "Could not load the video library."); } finally { setLibraryBusy(false); } };
  const loadMoreVideos = async () => { setLibraryBusy(true); try { const result=await getAdminVideoLibrary({data:{offset:libraryOffset,limit:48}}); setVideos(current=>[...current,...result.videos]); setLibraryOffset(result.nextOffset); setLibraryHasMore(result.hasMore); } catch(err) { setError(err?.message || "Could not load more videos."); } finally { setLibraryBusy(false); } };
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
      const originalUpload = await uploadAsset(originalFile, "original");
      setMessage("3/4 — Uploading the generated watermarked rendition…");
      const watermarkedUpload = await uploadAsset(watermarkedFile, "watermarked", originalUpload.storageConnectionId, originalFile.size);
      setMessage("4/4 — Saving video metadata…");
      const video = await createVideoRecord({ data: {
        title, description, category, language, isFeatured, creatorName,
        ...(thumbnailUrl.trim() ? { thumbnailUrl: thumbnailUrl.trim() } : {}),
        ...(sourceReference.trim() ? { sourceReference: sourceReference.trim() } : {}),
        ...(durationSeconds ? { durationSeconds: Number(durationSeconds) } : {}),
        licenseVerified, originalStorageKey: originalUpload.objectKey, watermarkedStorageKey: watermarkedUpload.objectKey,
        originalStorageConnectionId: originalUpload.storageConnectionId, watermarkedStorageConnectionId: watermarkedUpload.storageConnectionId,
        originalBytes: originalFile.size, watermarkedBytes: watermarkedFile.size,
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
        <h1>ADD FOOTAGE.</h1><p className="admin-sample-pack-status">FREE TRIAL PACK · {videos.filter(v=>v.is_free_sample&&v.status==="published"&&v.license_status==="verified").length} / 3 SELECTED</p>
        <p className="account-intro">Upload licensed content into private storage. Videos remain drafts until rights and both renditions are ready.</p>
        <div className="admin-warning"><b>Automatic watermark protection</b><span>VICEHUB generates a permanent MP4 watermark in your browser. The clean master and watermarked copy are stored separately in private storage. Free downloads receive the branded copy; paid access follows the active plan entitlement. Browser-side rendering is not a server-side transcoding pipeline: keep this tab open and use a desktop browser for ingestion.</span></div>
        <section className="admin-warning" aria-live="polite">
          <b>PRIVATE STORAGE READINESS</b>
          <span>{storageState === "ready" ? storageDetails : storageState === "checking" ? "Testing private storage permissions…" : storageState === "failed" ? storageDetails : "Storage has not yet been tested in this session. Uploads are locked until a real write, read-back and cleanup test succeeds."}</span>
          <div className="admin-form-actions"><button className="outline-btn" type="button" onClick={checkStorage} disabled={storageBusy || busy}>{storageBusy ? "Checking…" : storageState === "ready" ? "Recheck storage" : "Test private storage"}</button><span>{storageState === "ready" ? "READY" : storageState === "failed" ? "NOT READY" : "NOT CHECKED"}</span></div>
        </section>
        <details className="admin-warning admin-storage-setup">
          <summary><b>R2 PRIVATE STORAGE — SETUP INSTRUCTIONS</b></summary>
          <span>Uploads remain disabled until the real private-storage test succeeds. Create a private Cloudflare R2 bucket, then add these values in the VICEHUB app's Base44 Secrets. Do not put credentials in source code or send them in chat.</span>
          <ul>
            <li><code>VIDEO_STORAGE_ENDPOINT</code> — your HTTPS R2 S3 endpoint: <code>https://ACCOUNT_ID.r2.cloudflarestorage.com</code></li>
            <li><code>VIDEO_STORAGE_BUCKET</code> — the exact bucket name</li>
            <li><code>VIDEO_STORAGE_ACCESS_KEY_ID</code> — an R2 access key limited to this bucket</li>
            <li><code>VIDEO_STORAGE_SECRET_ACCESS_KEY</code> — the matching secret access key</li>
            <li><code>VIDEO_STORAGE_REGION</code> — optional; use <code>auto</code></li>
          </ul>
          <span>Configure bucket CORS to allow the published VICEHUB origin <code>https://gta6-creator-hub-c26cc578.base44.app</code>, methods <code>PUT</code>, <code>GET</code> and <code>DELETE</code>, and header <code>Content-Type</code>. Keep the bucket private; do not enable public bucket access or public object URLs.</span>
          <span>Create an R2 token with only the object permissions needed for this bucket. After saving the secrets, return here and run the private-storage test. It writes a temporary health-check object, reads it back, then deletes it.</span>
        </details>
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
        <section className="admin-panel admin-storage-network" style={{margin:"24px 0",padding:"22px"}}>
          <div className="admin-module-head"><div><span className="admin-kicker">VICEHUB / STORAGE NETWORK</span><h3>CONNECTED STORAGE SPACES</h3><p>Add multiple Cloudflare R2 or S3-compatible accounts. Credentials are encrypted before being saved and never sent to the client library.</p></div><span className="admin-status-pill">{storageConnections.filter(connection=>connection.enabled).length} CONNECTED</span></div>
          {storageConnections.length ? <div className="admin-list">{storageConnections.map(connection=><div className="admin-list-row" key={connection.id}><div><b>{connection.name}</b><small>{connection.provider} · {connection.endpointHost} · {connection.bucket} · {connection.capacityGb ? connection.capacityGb+" GB capacity" : "Capacity not specified"}</small></div><div className="admin-video-actions"><span className="admin-muted">{connection.enabled ? "ENABLED" : "DISABLED"}</span><button type="button" className="text-btn" disabled={!connection.enabled} onClick={async()=>{try{await testStorageConnection({data:{connectionId:connection.id}});await refreshLibrary();setMessage("Storage connection verified.");}catch(err){setError(err?.message||"Storage test failed.");}}}>Test</button><button type="button" className="text-btn" disabled={!connection.enabled} onClick={async()=>{if(!window.confirm("Disable this storage connection? Existing videos will remain assigned to it."))return;try{await disableStorageConnection({data:{connectionId:connection.id}});await refreshLibrary();}catch(err){setError(err?.message||"Could not disable connection.");}}}>Disable</button></div></div>)}</div> : <div className="platform-empty">No storage spaces connected yet. Connect your first private storage account before uploading videos.</div>}
          <form className="admin-video-form" onSubmit={async e=>{e.preventDefault();setStorageSaveBusy(true);setError("");setMessage("");try{await saveStorageConnection({data:{name:storageName,provider:storageProvider,endpoint:storageEndpoint,bucket:storageBucket,region:storageRegion,accessKey:storageAccessKey,secretKey:storageSecretKey,...(storageCapacity?{capacityGb:Number(storageCapacity)}:{})}});setStorageName("");setStorageEndpoint("");setStorageBucket("");setStorageAccessKey("");setStorageSecretKey("");setStorageCapacity("");await refreshLibrary();setMessage("Storage account connected and write/read/delete tests passed.");}catch(err){setError(err?.message||"Could not connect storage account.");}finally{setStorageSaveBusy(false);}}}>
            <div className="admin-form-row"><label>Account label<input required value={storageName} onChange={e=>setStorageName(e.target.value)} placeholder="e.g. R2 Main / B2 Archive"/></label><label>Provider<select value={storageProvider} onChange={e=>setStorageProvider(e.target.value)}><option value="cloudflare-r2">Cloudflare R2</option><option value="s3-compatible">Other S3-compatible</option></select></label></div>
            <div className="admin-form-row"><label>HTTPS endpoint<input required type="url" value={storageEndpoint} onChange={e=>setStorageEndpoint(e.target.value)} placeholder="https://ACCOUNT.r2.cloudflarestorage.com"/></label><label>Bucket<input required value={storageBucket} onChange={e=>setStorageBucket(e.target.value)} placeholder="Private bucket name"/></label></div>
            <div className="admin-form-row"><label>Region<input required value={storageRegion} onChange={e=>setStorageRegion(e.target.value)} placeholder="auto"/></label><label>Capacity limit (GB)<input type="number" min="1" value={storageCapacity} onChange={e=>setStorageCapacity(e.target.value)} placeholder="Optional"/></label></div>
            <div className="admin-form-row"><label>Access key ID<input required autoComplete="off" value={storageAccessKey} onChange={e=>setStorageAccessKey(e.target.value)} /></label><label>Secret access key<input required type="password" autoComplete="new-password" value={storageSecretKey} onChange={e=>setStorageSecretKey(e.target.value)} /></label></div>
            <small>Only S3-compatible object storage can be connected in this first release. Google Drive, OneDrive, MEGA and TeraBox require separate official API/OAuth adapters. VICEHUB never initiates a storage payment, but the provider may bill you if its free quota is exceeded; only connect accounts with billing controls you have checked.</small>
            <div className="admin-form-actions"><button className="primary-btn" type="submit" disabled={storageSaveBusy}>{storageSaveBusy?"Testing and connecting…":"Connect and test storage"}</button></div>
          </form>
        </section>
        <section className="admin-video-library">
          <div className="admin-video-library-head"><div><div className="eyebrow">CONTENT LIBRARY / INVENTORY</div><h2>VIDEO LIBRARY ({videos.length} LOADED)</h2><p>Manage metadata, rights verification, featured status and publication state. Showing {visibleVideos.length} matching records.</p></div><button className="outline-btn" type="button" onClick={refreshLibrary} disabled={libraryBusy}>{libraryBusy?"Refreshing…":"Refresh library"}</button></div>
          <div className="admin-panel" style={{margin:"18px 0",padding:"18px"}}>
            <div className="admin-module-head"><div><span className="admin-kicker">ACQUISITION / FREE MEMBER TRIAL</span><h3>THE FIXED 3-VIDEO SAMPLE PACK</h3><p>Choose exactly three published, rights-verified videos. Locking stores their IDs globally so every new account receives the identical pack. Each can be downloaded once per account, with watermark.</p></div><span className={"admin-status-pill"+(samplePackConfig.locked?" ready":"")}>{samplePackConfig.locked?"GLOBALLY LOCKED":samplePackConfig.selectedCount+" / 3 SELECTED"}</span></div>
            {samplePackConfig.selected?.length>0&&<div className="admin-list">{samplePackConfig.selected.map((video,index)=><div className="admin-list-row" key={video.id}><b>{index+1}. {video.title}</b><small>{video.id}</small></div>)}</div>}
            {samplePackConfig.locked?<p role="status">The sample pack is permanently fixed for all members. No video can be swapped or archived from this pack.</p>:<div className="admin-form-actions"><button type="button" className="primary-btn" disabled={samplePackBusy||samplePackConfig.selectedCount!==3} onClick={async()=>{if(!window.confirm("Lock these exact three videos for every VICEHUB account? This action is permanent and cannot be reversed."))return;setSamplePackBusy(true);setError("");try{const result=await lockFreeSamplePack({data:{confirmation:"LOCK_VICEHUB_SAMPLE_PACK_V1"}});setMessage("Global sample pack locked: "+result.videos.join(" · "));await refreshLibrary();}catch(err){setError(err?.message||"Could not lock the sample pack.");}finally{setSamplePackBusy(false);}}}>{samplePackBusy?"LOCKING…":"LOCK THE SAME 3 VIDEOS FOR EVERY ACCOUNT"}</button><span className="admin-muted">Select videos through Edit details → Include in fixed pack.</span></div>}
          </div>
          <div className="admin-video-library-filters"><input aria-label="Search videos" value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)} placeholder="Search title, creator, description or source…" /><select aria-label="Filter category" value={libraryCategory} onChange={e=>setLibraryCategory(e.target.value)}><option>All</option>{["Cinematics","Gameplay","Characters","Vehicles","Locations","Missions","Shorts","Edit packs","Tutorials","Other"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Filter publication status" value={libraryStatus} onChange={e=>setLibraryStatus(e.target.value)}><option>All</option>{["draft","published","archived"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Filter rights status" value={libraryRights} onChange={e=>setLibraryRights(e.target.value)}><option>All</option>{["pending","verified","restricted"].map(x=><option key={x}>{x}</option>)}</select></div>
          {visibleVideos.length ? <div className="admin-video-library-table-wrap"><table className="admin-video-library-table"><thead><tr><th>VIDEO</th><th>CATEGORY</th><th>RIGHTS</th><th>STATUS</th><th>FEATURED</th><th>ACTIONS</th></tr></thead><tbody>{visibleVideos.map(video=><tr key={video.id}><td><b>{video.title}</b><small>{video.language?.toUpperCase()} · {video.creator_name||"Creator not set"}</small>{video.status==="published"&&video.license_status==="verified"&&<button type="button" className="text-btn" onClick={async()=>{setAdminPreview({video,loading:true,url:""});try{const result=await getVideoPreviewUrl({data:{videoId:video.id}});setAdminPreview({video,loading:false,url:result.previewUrl});}catch(err){setAdminPreview({video,loading:false,error:err?.message||"Preview unavailable."});}}}>Preview video ▶</button>}</td><td>{video.category}</td><td>{video.license_status}{video.source_reference&&<small><a href={video.source_reference} target="_blank" rel="noreferrer">Rights reference ↗</a></small>}</td><td>{video.status}</td><td>{video.is_featured?"Yes":"No"}</td><td><div className="admin-video-actions"><button type="button" className="text-btn" onClick={()=>setEditingVideo({...video})}>Edit details</button><button type="button" className="text-btn" onClick={async()=>{try{await updateAdminVideo({data:{videoId:video.id,isFeatured:!video.is_featured}});await refreshLibrary();}catch(err){setError(err?.message||"Update failed.");}}}>{video.is_featured?"Unfeature":"Feature"}</button>{video.license_status!=="verified"&&video.source_reference&&<button type="button" className="text-btn" onClick={async()=>{if(!window.confirm("Confirm that you have verified the rights and permission to distribute this video?"))return;try{await updateAdminVideo({data:{videoId:video.id,licenseStatus:"verified"}});await refreshLibrary();}catch(err){setError(err?.message||"Rights update failed.");}}}>Verify rights</button>}{video.status==="draft"&&video.license_status==="verified"&&video.storage_key&&video.watermarked_storage_key&&<button type="button" className="text-btn" onClick={async()=>{try{await publishVideo({data:{videoId:video.id}});await refreshLibrary();}catch(err){setError(err?.message||"Publish failed.");}}}>Publish</button>}<button type="button" className="text-btn" onClick={async()=>{try{await archiveAdminVideo({data:{videoId:video.id,archived:video.status!=="archived"}});await refreshLibrary();}catch(err){setError(err?.message||"Archive failed.");}}}>{video.status==="archived"?"Restore draft":"Archive"}</button></div></td></tr>)}</tbody></table></div> : <div className="platform-empty">{libraryBusy?"Loading video records…":videos.length?"No videos match these filters. Clear the search or change the filters.":"No videos have been added yet. The catalogue remains empty until real licensed footage is uploaded."}</div>}
          {adminPreview&&<div className="admin-video-edit-backdrop" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setAdminPreview(null);}}><section className="admin-video-edit-modal" role="dialog" aria-modal="true"><div className="admin-video-edit-head"><div><div className="eyebrow">VIDEO PREVIEW</div><h3>{adminPreview.video.title}</h3></div><button type="button" className="text-btn" onClick={()=>setAdminPreview(null)}>Close ×</button></div>{adminPreview.url?<video controls playsInline preload="metadata" style={{width:"100%",maxHeight:"65vh",background:"#000"}} src={adminPreview.url}/>:<p>{adminPreview.loading?"Preparing secure preview…":adminPreview.error}</p>}</section></div>}
          {libraryHasMore&&<div className="admin-form-actions"><button type="button" className="outline-btn" onClick={loadMoreVideos} disabled={libraryBusy}>{libraryBusy?"Loading…":"Load next 48 videos"}</button><span className="admin-muted">Paged loading keeps the admin responsive with large catalogues.</span></div>}
          {editingVideo&&<div className="admin-video-edit-backdrop" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setEditingVideo(null);}}><form className="admin-video-edit-modal" onSubmit={async e=>{e.preventDefault();setEditBusy(true);setError("");try{const payload={videoId:editingVideo.id,title:editingVideo.title,description:editingVideo.description||"",category:editingVideo.category,language:editingVideo.language||"en",isFreeSample:!!editingVideo.is_free_sample};if(editingVideo.source_reference)payload.sourceReference=editingVideo.source_reference;await updateAdminVideo({data:payload});setEditingVideo(null);await refreshLibrary();setMessage("Video metadata updated.");}catch(err){setError(err?.message||"Could not update video metadata.");}finally{setEditBusy(false);}}}><div className="admin-video-edit-head"><div><div className="eyebrow">CATALOGUE / METADATA</div><h3>Edit video details</h3></div><button type="button" className="text-btn" onClick={()=>setEditingVideo(null)}>Close ×</button></div><label>Title<input required maxLength={140} value={editingVideo.title||""} onChange={e=>setEditingVideo({...editingVideo,title:e.target.value})}/></label><label>Description<textarea rows={4} maxLength={3000} value={editingVideo.description||""} onChange={e=>setEditingVideo({...editingVideo,description:e.target.value})}/></label><div className="admin-form-row"><label>Category<select value={editingVideo.category||"Other"} onChange={e=>setEditingVideo({...editingVideo,category:e.target.value})}>{["Cinematics","Gameplay","Characters","Vehicles","Locations","Missions","Shorts","Edit packs","Tutorials","Other"].map(x=><option key={x}>{x}</option>)}</select></label><label>Language<select value={editingVideo.language||"en"} onChange={e=>setEditingVideo({...editingVideo,language:e.target.value})}>{["en","fr","es","pt","it","de"].map(x=><option key={x} value={x}>{x.toUpperCase()}</option>)}</select></label></div><label>Rights / source reference<input type="url" value={editingVideo.source_reference||""} onChange={e=>setEditingVideo({...editingVideo,source_reference:e.target.value})} placeholder="https://…"/></label><label className="admin-inline-check"><input type="checkbox" checked={!!editingVideo.is_free_sample} disabled={samplePackConfig.locked} onChange={e=>setEditingVideo({...editingVideo,is_free_sample:e.target.checked})}/> Include in the fixed 3-video free sample pack (requires published status and verified rights)</label><div className="admin-form-actions"><button type="button" className="outline-btn" onClick={()=>setEditingVideo(null)}>Cancel</button><button type="submit" className="primary-btn" disabled={editBusy}>{editBusy?"Saving…":"Save metadata"}</button></div></form></div>}
        </section>
      </section>
    </main>
  );
}
