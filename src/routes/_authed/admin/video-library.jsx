import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import "@/styles/fan-admin.css";
import "@/styles/internal-video-library.css";
import {
  archiveInternalVideoAsset,
  cancelInternalVideoJob,
  createInternalVideoAsset,
  createInternalVideoUploadUrl,
  enqueueInternalVideoJob,
  listInternalVideoAssets,
  listInternalVideoJobs,
  listGoogleDriveVideoFiles,
  importGoogleDriveVideo,
} from "@/lib/internal-video-fns";
import { getStorageConnections, createVideoUploadUrl, publishInternalAssetToCatalogue } from "@/lib/server-fns";

export const Route = createFileRoute("/_authed/admin/video-library")({
  ssr: false,
  head: () => ({ meta: [{ title: "Internal Video Library — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: InternalVideoLibraryPage,
});

const formatBytes = value => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes, index = -1;
  do { size /= 1024; index += 1; } while (size >= 1024 && index < units.length - 1);
  return size.toFixed(size >= 100 ? 0 : 1) + " " + units[index];
};

async function readVideoMetadata(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("The source video metadata could not be read."));
      video.src = url;
      video.load();
    });
    return {
      durationSeconds: Math.max(0, Math.round(video.duration || 0)),
      width: Math.max(0, Number(video.videoWidth) || 0),
      height: Math.max(0, Number(video.videoHeight) || 0),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function createWatermarkedRendition(file, onProgress) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("This browser cannot create a watermarked MP4. Use current Chrome or Edge on desktop.");
  }
  const video = document.createElement("video");
  const sourceUrl = URL.createObjectURL(file);
  let recorder = null, raf = 0, videoStream = null, canvasStream = null;
  video.preload = "auto";
  video.playsInline = true;
  video.muted = false;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("The source video could not be decoded."));
      video.src = sourceUrl;
      video.load();
    });
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) throw new Error("The source video has invalid dimensions or duration.");
    const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
    const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
    const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not initialise the watermark renderer.");
    const capture = typeof video.captureStream === "function" ? video.captureStream.bind(video)
      : typeof video.mozCaptureStream === "function" ? video.mozCaptureStream.bind(video) : null;
    if (!capture) throw new Error("This browser cannot capture source audio. Use Chrome or Edge on desktop.");
    videoStream = capture();
    canvasStream = canvas.captureStream(30);
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...videoStream.getAudioTracks()]);
    const mimeType = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("MP4/H.264 recording is not supported by this browser.");
    recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
    const chunks = [];
    const result = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("The browser stopped while creating the protected rendition."));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/mp4" });
        if (!blob.size) reject(new Error("The watermark renderer produced an empty file."));
        else resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + "-vicehub-watermarked.mp4", { type: "video/mp4" }));
      };
    });
    let lastProgress = -1;
    const drawFrame = () => {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, width, height);
        const pad = Math.max(16, Math.round(width * 0.018));
        const fontSize = Math.max(18, Math.round(width * 0.027));
        ctx.save(); ctx.font = "900 " + fontSize + "px Arial, sans-serif";
        const boxWidth = ctx.measureText("VICEHUB").width + pad * 2;
        const boxHeight = fontSize + pad * 1.25;
        const x = width - boxWidth - pad, y = height - boxHeight - pad;
        ctx.fillStyle = "rgba(8, 9, 16, 0.62)"; ctx.fillRect(x, y, boxWidth, boxHeight);
        ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(0,0,0,.75)"; ctx.shadowBlur = 5;
        ctx.textBaseline = "middle"; ctx.fillText("VICEHUB", x + pad, y + boxHeight / 2); ctx.restore();
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
    video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(sourceUrl);
  }
}

function InternalVideoLibraryPage() {
  const { user } = Route.useRouteContext();
  const [assets, setAssets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [storageConnections, setStorageConnections] = useState([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [file, setFile] = useState(null);
  const [assetType, setAssetType] = useState("source");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("en");
  const [tags, setTags] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rightsStatus, setRightsStatus] = useState("pending");
  const [rightsEvidenceUrl, setRightsEvidenceUrl] = useState("");
  const [storageConnectionId, setStorageConnectionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [publishAsset, setPublishAsset] = useState(null);
  const [publishCategory, setPublishCategory] = useState("Other");
  const [publishLanguage, setPublishLanguage] = useState("en");
  const [publishCreatorName, setPublishCreatorName] = useState("VICEHUB");
  const [publishFeatured, setPublishFeatured] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishProgress, setPublishProgress] = useState("");
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveQuery, setDriveQuery] = useState("");
  const [driveNextPage, setDriveNextPage] = useState("");
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveRightsStatus, setDriveRightsStatus] = useState("pending");
  const [driveRightsEvidenceUrl, setDriveRightsEvidenceUrl] = useState("");
  const [cutAsset, setCutAsset] = useState(null);
  const [cutStartSeconds, setCutStartSeconds] = useState("0");
  const [cutEndSeconds, setCutEndSeconds] = useState("15");
  const [cutTitle, setCutTitle] = useState("");
  const [cutBusy, setCutBusy] = useState(false);

  const refresh = async (reset = true) => {
    setLoading(true);
    setError("");
    try {
      const nextOffset = reset ? 0 : offset;
      const [result, connections, jobRows] = await Promise.all([
        listInternalVideoAssets({
          data: {
            limit: 50,
            offset: nextOffset,
            ...(statusFilter !== "all" ? { status: statusFilter } : {}),
            ...(typeFilter !== "all" ? { assetType: typeFilter } : {}),
          },
        }),
        getStorageConnections(),
        listInternalVideoJobs({ data: { limit: 20 } }),
      ]);
      setAssets(current => reset ? result.assets : [...current, ...result.assets]);
      setOffset(result.nextOffset);
      setHasMore(result.hasMore);
      setStorageConnections(connections);
      setJobs(jobRows);
      if (!storageConnectionId && connections.length) {
        const preferred = connections.find(item => item.enabled && item.verifiedAt);
        if (preferred) setStorageConnectionId(preferred.id);
      }
    } catch (err) {
      setError(err?.message || "The internal library could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") refresh(true);
  }, [user?.id, user?.role, typeFilter, statusFilter]);

  const visibleAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter(asset => [
      asset.title, asset.description, asset.category, asset.original_filename,
      asset.source_url, asset.rights_status, ...(asset.tags || []),
    ].filter(Boolean).join(" ").toLowerCase().includes(term));
  }, [assets, search]);

  const queueJob = async (asset, jobType) => {
    setError("");
    setMessage("");
    try {
      const result = await enqueueInternalVideoJob({ data: { assetId: asset.id, jobType } });
      setMessage(result.message);
      await refresh(true);
    } catch (err) {
      setError(err?.message || "The processing job could not be queued.");
    }
  };

  const searchDrive = async (loadMore = false) => {
    setDriveLoading(true);
    setError("");
    try {
      const result = await listGoogleDriveVideoFiles({
        data: {
          query: driveQuery,
          ...(loadMore && driveNextPage ? { pageToken: driveNextPage } : {}),
        },
      });
      setDriveFiles(current => loadMore ? [...current, ...result.files] : result.files);
      setDriveNextPage(result.nextPageToken || "");
      setMessage("Google Drive returned " + result.files.length + " video file(s) on this page.");
    } catch (err) {
      setError(err?.message || "Google Drive videos could not be listed. Check the connected Drive integration.");
    } finally {
      setDriveLoading(false);
    }
  };

  const importDriveFile = async driveFile => {
    setError("");
    setMessage("");
    try {
      const result = await importGoogleDriveVideo({
        data: {
          fileId: driveFile.id,
          rightsStatus: driveRightsStatus,
          ...(driveRightsEvidenceUrl.trim() ? { rightsEvidenceUrl: driveRightsEvidenceUrl.trim() } : {}),
        },
      });
      setMessage(result.alreadyImported
        ? "This Google Drive video is already in the VICEHUB library."
        : "Google Drive video imported into the VICEHUB library. The original remains in Drive.");
      await refresh(true);
    } catch (err) {
      setError(err?.message || "The Google Drive video could not be imported.");
    }
  };

  const openCut = asset => {
    setCutAsset(asset);
    setCutStartSeconds("0");
    setCutEndSeconds(String(Math.min(30, Number(asset.duration_seconds) || 15)));
    setCutTitle(asset.title + " - clip");
    setError("");
    setMessage("");
  };

  const submitCut = async event => {
    event.preventDefault();
    if (!cutAsset) return;
    const startSeconds = Number(cutStartSeconds);
    const endSeconds = Number(cutEndSeconds);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 ||
        endSeconds <= startSeconds || endSeconds > Number(cutAsset.duration_seconds || 0) ||
        endSeconds - startSeconds > 900) {
      setError("Choose a valid clip range within the source video. The initial worker limit is 15 minutes per clip.");
      return;
    }
    setCutBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await enqueueInternalVideoJob({
        data: {
          assetId: cutAsset.id,
          jobType: "cut_clip",
          startSeconds,
          endSeconds,
          outputTitle: cutTitle.trim() || (cutAsset.title + " - clip"),
        },
      });
      setCutAsset(null);
      setMessage(result.message);
      await refresh(true);
    } catch (err) {
      setError(err?.message || "The clip job could not be queued.");
    } finally {
      setCutBusy(false);
    }
  };

  const cancelJob = async job => {
    try {
      await cancelInternalVideoJob({ data: { jobId: job.id } });
      await refresh(true);
    } catch (err) {
      setError(err?.message || "The queued job could not be cancelled.");
    }
  };

  const submitUpload = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setMessage("");
    if (!file) {
      setError("Choose an MP4 or MOV file first.");
      return;
    }
    if (rightsStatus === "authorised" && !rightsEvidenceUrl.trim()) {
      setError("Written rights evidence is required before marking this asset authorised.");
      return;
    }
    const mimeType = file.type || (file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
    if (!["video/mp4", "video/quicktime"].includes(mimeType)) {
      setError("This first upload path accepts MP4 and MOV files.");
      return;
    }
    setBusy(true);
    try {
      setMessage("Reading video metadata…");
      const mediaMetadata = await readVideoMetadata(file);
      setMessage("1/3 — Requesting a private upload URL…");
      const signed = await createInternalVideoUploadUrl({
        data: {
          fileName: file.name,
          contentType: mimeType,
          fileSize: file.size,
          ...(storageConnectionId ? { storageConnectionId } : {}),
        },
      });
      setMessage("2/3 — Uploading the original file to private storage…");
      const response = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      if (!response.ok) throw new Error("The storage provider rejected the upload (HTTP " + response.status + "). Check the bucket CORS and account permissions.");
      setMessage("3/3 — Saving the library record…");
      const saved = await createInternalVideoAsset({
        data: {
          title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
          description,
          assetType,
          category,
          language,
          tags: tags.split(",").map(item => item.trim()).filter(Boolean).slice(0, 30),
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
          rightsStatus,
          ...(rightsEvidenceUrl.trim() ? { rightsEvidenceUrl: rightsEvidenceUrl.trim() } : {}),
          storageKey: signed.objectKey,
          storageConnectionId: signed.storageConnectionId,
          originalFilename: file.name,
          mimeType,
          fileSizeBytes: file.size,
          ...mediaMetadata,
        },
      });
      setMessage("Original stored in the private VICEHUB library. No watermark was applied." + (saved.usageRecorded ? "" : " Storage usage counters need a refresh."));
      setFile(null);
      setTitle("");
      setDescription("");
      setCategory("");
      setTags("");
      setSourceUrl("");
      setRightsStatus("pending");
      setRightsEvidenceUrl("");
      form.reset();
      await refresh(true);
    } catch (err) {
      setError(err?.message || "The video could not be added to the internal library.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const openPublish = asset => {
    const categories = ["Cinematics", "Gameplay", "Characters", "Vehicles", "Locations", "Missions", "Shorts", "Edit packs", "Tutorials", "Other"];
    setPublishAsset(asset);
    setPublishCategory(categories.find(value => value.toLowerCase() === String(asset.category || "").toLowerCase()) || "Other");
    setPublishLanguage(["en", "fr", "es", "pt", "it", "de"].includes(asset.language) ? asset.language : "en");
    setPublishCreatorName("VICEHUB");
    setPublishFeatured(false);
    setPublishProgress("");
    setError("");
  };

  const submitPublish = async event => {
    event.preventDefault();
    if (!publishAsset) return;
    setPublishBusy(true);
    setError("");
    setMessage("");
    try {
      setPublishProgress("1/4 — Retrieving the private source video…");
      const response = await fetch("/api/internal-video-assets/" + encodeURIComponent(publishAsset.id), { credentials: "same-origin" });
      if (!response.ok) throw new Error("The private source video could not be retrieved (HTTP " + response.status + ").");
      const blob = await response.blob();
      const originalFile = new File([blob], publishAsset.original_filename || (publishAsset.title + ".mp4"), { type: publishAsset.mime_type || blob.type || "video/mp4" });
      setPublishProgress("2/4 — Creating the permanent VICEHUB watermark in your browser…");
      const watermarkedFile = await createWatermarkedRendition(originalFile, value => setPublishProgress("2/4 — Watermarking source video: " + value + "%"));
      setPublishProgress("3/4 — Uploading the protected rendition to private storage…");
      const signed = await createVideoUploadUrl({ data: {
        fileName: watermarkedFile.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 170),
        contentType: "video/mp4",
        assetVariant: "watermarked",
        fileSize: watermarkedFile.size,
      } });
      const uploaded = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: watermarkedFile });
      if (!uploaded.ok) throw new Error("Private storage rejected the protected rendition (HTTP " + uploaded.status + ").");
      setPublishProgress("4/4 — Publishing the video to the client catalogue…");
      const result = await publishInternalAssetToCatalogue({ data: {
        assetId: publishAsset.id,
        category: publishCategory,
        language: publishLanguage,
        isFeatured: publishFeatured,
        creatorName: publishCreatorName.trim() || "VICEHUB",
        watermarkedStorageKey: signed.objectKey,
        watermarkedStorageConnectionId: signed.storageConnectionId,
        watermarkedBytes: watermarkedFile.size,
      } });
      setMessage(result.message || "Video published to the client catalogue.");
      setPublishAsset(null);
      await refresh(true);
    } catch (err) {
      setError(err?.message || "The internal asset could not be published.");
      setPublishProgress("");
    } finally {
      setPublishBusy(false);
    }
  };

  const archive = async asset => {
    if (!window.confirm("Archive this library record? The private source file will remain in storage.")) return;
    setError("");
    try {
      await archiveInternalVideoAsset({ data: { assetId: asset.id } });
      setAssets(current => current.map(item => item.id === asset.id ? { ...item, status: "archived" } : item));
      await refresh(true);
    } catch (err) {
      setError(err?.message || "The asset could not be archived.");
    }
  };

  if (user?.role !== "admin") {
    return <main className="account-page"><section className="account-content"><h1>ACCESS DENIED.</h1><p className="account-intro">Administrator permissions are required to access the internal video library.</p><Link className="outline-btn" to="/dashboard">Back to account</Link></section></main>;
  }

  const readyConnections = storageConnections.filter(item => item.enabled && item.verifiedAt);

  return (
    <main className="account-page internal-library-page">
      <header className="account-header">
        <Link to="/" className="brand"><span className="brand-mark">V</span><span>VICE<span className="brand-accent">HUB</span><small>INTERNAL MEDIA WORKSPACE</small></span></Link>
        <div className="account-header-actions"><span>Administrator</span><Link to="/admin/videos" className="outline-btn">Public catalogue ↗</Link><Link to="/dashboard" className="outline-btn">My account</Link></div>
      </header>
      <section className="account-content internal-library-content">
        <div className="ivl-topline"><div><div className="eyebrow">VICEHUB / INTERNAL PRODUCTION</div><h1>VIDEO <em>LIBRARY.</em></h1><p className="account-intro">Private storage for original footage, generated clips and working assets. Select an authorised asset to create its protected rendition and publish it to the client catalogue.</p></div><div className="ivl-count"><b>{assets.length}</b><span>ASSETS LOADED</span></div></div>
        <div className="ivl-notice"><b>PROCESSING ENGINE / WORKER BRIDGE</b><span>Google Drive import and the FFmpeg clip-export flow are prepared in the application code. Jobs will remain queued until the VPS worker is deployed and its private token is configured. Original videos stay in Drive; the worker uses temporary disk only and exports completed clips back to Drive.</span></div>
        <section className="ivl-library-panel">
          <div className="ivl-section-heading"><div><span className="admin-kicker">INGEST / GOOGLE DRIVE</span><h2>IMPORT FROM GOOGLE DRIVE</h2><p>Search videos in the currently connected Google Drive account. Importing a video adds its reference and metadata to VICEHUB; it does not copy the original onto the VPS.</p></div><button className="outline-btn" type="button" onClick={() => searchDrive(false)} disabled={driveLoading}>{driveLoading ? "SEARCHING…" : "SEARCH DRIVE ↻"}</button></div>
          <div className="ivl-filters"><input value={driveQuery} onChange={e => setDriveQuery(e.target.value)} placeholder="Search Drive video filenames…" aria-label="Search Google Drive video filenames" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchDrive(false); } }} /></div>
          <div className="ivl-form-grid">
            <label>Rights status for imported videos<select value={driveRightsStatus} onChange={e => setDriveRightsStatus(e.target.value)}><option value="pending">Pending verification</option><option value="authorised">Authorised (evidence required)</option><option value="not_applicable">Not applicable</option><option value="restricted">Restricted</option></select></label>
            <label>Rights evidence URL (required for Authorised)<input type="url" value={driveRightsEvidenceUrl} onChange={e => setDriveRightsEvidenceUrl(e.target.value)} placeholder="https://… written permission or licence" /></label>
          </div>
          {driveFiles.length > 0 && <div className="ivl-jobs-list">{driveFiles.map(driveFile => <div className="ivl-job-row" key={driveFile.id}>
            <div><b>{driveFile.name || "Untitled video"}</b><small>{driveFile.mimeType || "Video"} · {formatBytes(driveFile.size)} · {driveFile.modifiedTime ? new Date(driveFile.modifiedTime).toLocaleDateString() : "Drive"}</small></div>
            <div className="ivl-job-status"><span>{driveFile.capabilities?.canDownload === false ? "NOT DOWNLOADABLE" : "GOOGLE DRIVE"}</span></div>
            <button className="text-btn" type="button" disabled={driveLoading || driveFile.capabilities?.canDownload === false} onClick={() => importDriveFile(driveFile)}>IMPORT ↗</button>
          </div>)}</div>}
          {!driveFiles.length && <div className="ivl-empty">{driveLoading ? "Searching connected Google Drive…" : "Search Google Drive to list video files available to the connected account."}</div>}
          {driveNextPage && <div className="ivl-load-more"><button className="outline-btn" type="button" onClick={() => searchDrive(true)} disabled={driveLoading}>{driveLoading ? "LOADING…" : "LOAD MORE DRIVE VIDEOS"}</button></div>}
          <p className="account-intro">The current Base44 Google Drive connector exposes one app-wide connected account. Separate Google accounts per user are not yet enabled.</p>
        </section>
        {jobs.length > 0 && <section className="ivl-library-panel ivl-jobs-panel">
          <div className="ivl-section-heading"><div><span className="admin-kicker">WORKER / ASYNC TASKS</span><h2>PROCESSING QUEUE</h2><p>Jobs are private and linked to their original source asset.</p></div><button className="outline-btn" type="button" onClick={() => refresh(true)} disabled={loading}>REFRESH QUEUE ↻</button></div>
          <div className="ivl-jobs-list">{jobs.map(job => <div className="ivl-job-row" key={job.id}>
            <div><b>{job.job_type === "transcribe" ? "WHISPER TRANSCRIPTION" : job.job_type === "cut_clip" ? "FFMPEG CLIP EXPORT" : "MEDIA ANALYSIS"}</b><small>{job.asset_id} · {job.stage || job.status}</small></div>
            <div className="ivl-job-status"><span>{job.status.toUpperCase()}</span><small>{Number(job.progress_percent || 0)}%</small></div>
            {job.status === "queued" && <button className="text-btn" type="button" onClick={() => cancelJob(job)}>CANCEL</button>}
            {job.error_message && <small className="ivl-job-error">{job.error_message}</small>}
          </div>)}</div>
        </section>}
        <section className="ivl-upload-panel">
          <div className="ivl-section-heading"><div><span className="admin-kicker">INGEST / PRIVATE MASTER</span><h2>ADD VIDEO ASSET</h2><p>Upload a source video or a clip. Files are stored privately and are not sent to the public member catalogue.</p></div><span className={"ivl-storage-pill" + (readyConnections.length ? " ready" : "")}>{readyConnections.length} STORAGE ACCOUNTS READY</span></div>
          {!readyConnections.length && <div className="ivl-warning">No verified storage account is ready. <Link to="/admin/videos">Connect a private S3-compatible storage account in Video administration ↗</Link></div>}
          <form className="ivl-form" onSubmit={submitUpload}>
            <div className="ivl-form-grid">
              <label>Asset title<input value={title} onChange={e => setTitle(e.target.value)} maxLength={180} placeholder="e.g. Vice City night drive — source master" /></label>
              <label>Asset type<select value={assetType} onChange={e => setAssetType(e.target.value)}><option value="source">Original source</option><option value="clip">Generated / selected clip</option><option value="derivative">Other derivative</option></select></label>
              <label>Category<input value={category} onChange={e => setCategory(e.target.value)} maxLength={80} placeholder="Gameplay, cinematic, interview…" /></label>
              <label>Language<select value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="fr">French</option><option value="es">Spanish</option><option value="pt">Portuguese</option><option value="it">Italian</option><option value="de">German</option><option value="und">Unknown</option></select></label>
              <label>Storage destination<select value={storageConnectionId} onChange={e => setStorageConnectionId(e.target.value)}><option value="">Automatic distribution</option>{readyConnections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.provider}</option>)}</select></label>
              <label>Tags<input value={tags} onChange={e => setTags(e.target.value)} placeholder="podcast, interview, funny moment" /></label>
              <label className="ivl-wide">Source URL / provenance<input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://… (reference only; not downloaded)" /></label>
              <label>Rights status<select value={rightsStatus} onChange={e => setRightsStatus(e.target.value)}><option value="pending">Pending verification</option><option value="authorised">Authorised</option><option value="restricted">Restricted</option><option value="not_applicable">Not applicable</option></select></label>
              <label>Rights evidence URL<input type="url" value={rightsEvidenceUrl} onChange={e => setRightsEvidenceUrl(e.target.value)} placeholder="https://… written permission or licence" /></label>
              <label className="ivl-wide">Description<textarea rows={3} maxLength={5000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Notes about the footage, source and intended use…" /></label>
              <label className="ivl-wide ivl-file-input">Video file (.mp4 / .mov)<input required type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={e => setFile(e.target.files?.[0] || null)} /><small>{file ? file.name + " · " + formatBytes(file.size) : "Original file uploaded without a watermark."}</small></label>
            </div>
            <div className="ivl-form-footer"><p>Multiple S3-compatible accounts are supported. Leave the storage destination on Automatic distribution to select an available verified account. Provider quotas and upload/API limits still apply; VICEHUB does not impose a library item quota.</p><button className="primary-btn" type="submit" disabled={busy || !file || !readyConnections.length}>{busy ? "UPLOADING…" : "ADD TO PRIVATE LIBRARY ↗"}</button></div>
          </form>
          {error && <div className="ivl-error" role="alert">{error}</div>}
          {message && <div className="ivl-message" role="status">{message}</div>}
        </section>
        <section className="ivl-library-panel">
          <div className="ivl-section-heading"><div><span className="admin-kicker">CATALOGUE / PRIVATE ASSETS</span><h2>YOUR VIDEO LIBRARY</h2><p>Originals and clips remain private until you explicitly export or share them.</p></div><button className="outline-btn" type="button" onClick={() => refresh(true)} disabled={loading}>{loading ? "REFRESHING…" : "REFRESH ↻"}</button></div>
          <div className="ivl-filters"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, source, tags…" aria-label="Search internal videos" /><select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter asset type"><option value="all">All types</option><option value="source">Original sources</option><option value="clip">Clips</option><option value="derivative">Other derivatives</option></select><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter status"><option value="all">All statuses</option><option value="stored">Stored</option><option value="processing">Processing</option><option value="ready">Ready</option><option value="archived">Archived</option></select></div>
          {visibleAssets.length ? <div className="ivl-grid">{visibleAssets.map(asset => <article className="ivl-card" key={asset.id}>
            <div className="ivl-card-media"><video src={"/api/internal-video-assets/" + encodeURIComponent(asset.id)} preload="metadata" muted playsInline onClick={() => setPreview(asset)} /><span>{asset.asset_type === "source" ? "SOURCE" : asset.asset_type.toUpperCase()}</span></div>
            <div className="ivl-card-body"><div className="ivl-card-title"><h3>{asset.title}</h3><small>{asset.status.toUpperCase()}</small></div><p>{asset.description || asset.category || "No description added."}</p><div className="ivl-card-meta"><span>{formatBytes(asset.file_size_bytes)}</span><span>{asset.language?.toUpperCase() || "—"}</span><span>{asset.rights_status?.replace("_", " ").toUpperCase()}</span></div>{asset.source_url && <a href={asset.source_url} target="_blank" rel="noreferrer">SOURCE REFERENCE ↗</a>}
              {asset.public_video_status === "published" && <span className="ivl-published-label">PUBLISHED IN CLIENT LIBRARY</span>}
              <div className="ivl-card-actions"><button type="button" className="text-btn" onClick={() => setPreview(asset)}>PREVIEW ▶</button>{asset.rights_status === "authorised" && asset.rights_evidence_url && asset.status !== "archived" && asset.public_video_status !== "published" && <button type="button" className="text-btn" onClick={() => openPublish(asset)}>PUBLISH TO CLIENT LIBRARY ↗</button>}{["authorised", "not_applicable"].includes(asset.rights_status) && asset.status !== "archived" && <><button type="button" className="text-btn" onClick={() => queueJob(asset, "analyse")}>ANALYSE</button><button type="button" className="text-btn" onClick={() => queueJob(asset, "transcribe")}>TRANSCRIBE</button>{Number(asset.duration_seconds) > 0 && <button type="button" className="text-btn" onClick={() => openCut(asset)}>CUT CLIP ✂</button>}</>}{asset.status !== "archived" && <button type="button" className="text-btn" onClick={() => archive(asset)}>ARCHIVE</button>}</div>
            </div>
          </article>)}</div> : <div className="ivl-empty">{loading ? "Loading internal assets…" : "No internal video assets yet. Upload a source video or a clip to start building the library."}</div>}
          {hasMore && <div className="ivl-load-more"><button className="outline-btn" type="button" onClick={() => refresh(false)} disabled={loading}>{loading ? "LOADING…" : "LOAD MORE ASSETS"}</button></div>}
        </section>
      </section>
      {cutAsset && <div className="ivl-preview-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget && !cutBusy) setCutAsset(null); }}><form className="ivl-preview-modal ivl-publish-modal" onSubmit={submitCut}>
        <header><div><small>FFMPEG / CLIP EXPORT</small><h2>Cut: {cutAsset.title}</h2></div><button type="button" className="text-btn" disabled={cutBusy} onClick={() => setCutAsset(null)}>CLOSE ×</button></header>
        <p>The original remains in its current storage location. VICEHUB will render the selected range and save the MP4 to the connected Google Drive account, preferably alongside the source video.</p>
        <label>Clip title<input value={cutTitle} maxLength={180} onChange={e => setCutTitle(e.target.value)} required /></label>
        <div className="ivl-form-grid">
          <label>Start time (seconds)<input type="number" min="0" max={Math.max(0, Number(cutAsset.duration_seconds) - 0.01)} step="0.01" value={cutStartSeconds} onChange={e => setCutStartSeconds(e.target.value)} required /></label>
          <label>End time (seconds)<input type="number" min="0.01" max={Number(cutAsset.duration_seconds)} step="0.01" value={cutEndSeconds} onChange={e => setCutEndSeconds(e.target.value)} required /></label>
        </div>
        <p>Source duration: {Number(cutAsset.duration_seconds || 0)} seconds. Maximum clip duration in this first worker version: 900 seconds. Rendering uses H.264/AAC re-encoding for accurate cut points.</p>
        <div className="ivl-form-footer"><p>The job starts when the VPS worker is online. Completed clips appear as separate assets in the private library.</p><button className="primary-btn" type="submit" disabled={cutBusy}>{cutBusy ? "ADDING JOB…" : "ADD CLIP TO PROCESSING QUEUE ↗"}</button></div>
      </form></div>}
      {publishAsset && <div className="ivl-preview-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget && !publishBusy) setPublishAsset(null); }}><form className="ivl-preview-modal ivl-publish-modal" onSubmit={submitPublish}>
        <header><div><small>PUBLIC CATALOGUE / RIGHTS CLEARED</small><h2>Publish: {publishAsset.title}</h2></div><button type="button" className="text-btn" disabled={publishBusy} onClick={() => setPublishAsset(null)}>CLOSE ×</button></header>
        <p>This keeps the original master in private storage, creates a permanent VICEHUB-watermarked MP4, and publishes the video to the client library. The rights evidence already recorded for this asset will be attached to the public video record.</p>
        <label>Client category<select value={publishCategory} onChange={e => setPublishCategory(e.target.value)}>{["Cinematics", "Gameplay", "Characters", "Vehicles", "Locations", "Missions", "Shorts", "Edit packs", "Tutorials", "Other"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Language<select value={publishLanguage} onChange={e => setPublishLanguage(e.target.value)}>{[["en","English"],["fr","French"],["es","Spanish"],["pt","Portuguese"],["it","Italian"],["de","German"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Creator name<input value={publishCreatorName} maxLength={80} onChange={e => setPublishCreatorName(e.target.value)} /></label>
        <label className="ivl-publish-check"><input type="checkbox" checked={publishFeatured} onChange={e => setPublishFeatured(e.target.checked)} /> Feature this video in the client library</label>
        {publishProgress && <div className="ivl-message" role="status">{publishProgress}</div>}
        <div className="ivl-form-footer"><p>Publishing is allowed only for assets marked Authorised with a rights-evidence URL. The browser tab must remain open while the watermarked copy is generated.</p><button className="primary-btn" type="submit" disabled={publishBusy}>{publishBusy ? "PUBLISHING…" : "CREATE PROTECTED COPY & PUBLISH ↗"}</button></div>
      </form></div>}
      {preview && <div className="ivl-preview-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setPreview(null); }}><section className="ivl-preview-modal" role="dialog" aria-modal="true" aria-label={preview.title}><header><div><small>PRIVATE ASSET PREVIEW</small><h2>{preview.title}</h2></div><button type="button" className="text-btn" onClick={() => setPreview(null)}>CLOSE ×</button></header><video controls playsInline preload="metadata" src={"/api/internal-video-assets/" + encodeURIComponent(preview.id)} /></section></div>}
    </main>
  );
}
import "@/styles/vicehub-admin-2026.css";
