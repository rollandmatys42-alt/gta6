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
} from "@/lib/internal-video-fns";
import { getStorageConnections } from "@/lib/server-fns";

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
        <div className="ivl-topline"><div><div className="eyebrow">VICEHUB / INTERNAL PRODUCTION</div><h1>VIDEO <em>LIBRARY.</em></h1><p className="account-intro">Private storage for original footage, generated clips and working assets. No public catalogue, subscriptions or watermarking.</p></div><div className="ivl-count"><b>{assets.length}</b><span>ASSETS LOADED</span></div></div>
        <div className="ivl-notice"><b>PROCESSING ENGINE / WORKER BRIDGE</b><span>The queue and secure worker endpoints are installed. Jobs remain queued until the separate FFmpeg / Whisper worker is deployed and its private token is configured. Current enabled tasks: media analysis and transcription. Clip selection and rendering are not yet enabled.</span></div>
        {jobs.length > 0 && <section className="ivl-library-panel ivl-jobs-panel">
          <div className="ivl-section-heading"><div><span className="admin-kicker">WORKER / ASYNC TASKS</span><h2>PROCESSING QUEUE</h2><p>Jobs are private and linked to their original source asset.</p></div><button className="outline-btn" type="button" onClick={() => refresh(true)} disabled={loading}>REFRESH QUEUE ↻</button></div>
          <div className="ivl-jobs-list">{jobs.map(job => <div className="ivl-job-row" key={job.id}>
            <div><b>{job.job_type === "transcribe" ? "WHISPER TRANSCRIPTION" : "MEDIA ANALYSIS"}</b><small>{job.asset_id} · {job.stage || job.status}</small></div>
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
              <div className="ivl-card-actions"><button type="button" className="text-btn" onClick={() => setPreview(asset)}>PREVIEW ▶</button>{["authorised", "not_applicable"].includes(asset.rights_status) && asset.status !== "archived" && <><button type="button" className="text-btn" onClick={() => queueJob(asset, "analyse")}>ANALYSE</button><button type="button" className="text-btn" onClick={() => queueJob(asset, "transcribe")}>TRANSCRIBE</button></>}{asset.status !== "archived" && <button type="button" className="text-btn" onClick={() => archive(asset)}>ARCHIVE</button>}</div>
            </div>
          </article>)}</div> : <div className="ivl-empty">{loading ? "Loading internal assets…" : "No internal video assets yet. Upload a source video or a clip to start building the library."}</div>}
          {hasMore && <div className="ivl-load-more"><button className="outline-btn" type="button" onClick={() => refresh(false)} disabled={loading}>{loading ? "LOADING…" : "LOAD MORE ASSETS"}</button></div>}
        </section>
      </section>
      {preview && <div className="ivl-preview-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setPreview(null); }}><section className="ivl-preview-modal" role="dialog" aria-modal="true" aria-label={preview.title}><header><div><small>PRIVATE ASSET PREVIEW</small><h2>{preview.title}</h2></div><button type="button" className="text-btn" onClick={() => setPreview(null)}>CLOSE ×</button></header><video controls playsInline preload="metadata" src={"/api/internal-video-assets/" + encodeURIComponent(preview.id)} /></section></div>}
    </main>
  );
}
