import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createVideoRecord, createVideoUploadUrl, publishVideo } from "@/lib/server-fns";

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
  const [watermarkedFile, setWatermarkedFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (user?.role !== "admin") return <main className="account-page"><section className="account-content"><h1>ACCESS DENIED.</h1><p className="account-intro">Administrator permissions are required to manage video content.</p><button className="outline-btn" onClick={() => window.location.assign("/dashboard")}>Back to account</button></section></main>;

  const submit = async (event) => {
    event.preventDefault();
    setError(""); setMessage("");
    if (!originalFile || !watermarkedFile) {
      setError("Upload both the original video and a separately watermarked rendition.");
      return;
    }
    if (licenseVerified && !sourceReference.trim()) {
      setError("Add a source or rights reference before marking the licence as verified.");
      return;
    }
    setBusy(true);
    try {
      setMessage("1/3 — Uploading the clean original to private storage…");
      const originalStorageKey = await uploadAsset(originalFile, "original");
      setMessage("2/3 — Uploading the watermarked rendition…");
      const watermarkedStorageKey = await uploadAsset(watermarkedFile, "watermarked");
      setMessage("3/3 — Saving video metadata…");
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
      setDurationSeconds(""); setLicenseVerified(false); setOriginalFile(null); setWatermarkedFile(null);
      event.target.reset();
    } catch (err) {
      setError(err?.message || "Video upload failed.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

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
        <div className="admin-warning"><b>Watermark requirement</b><span>The Free tier receives a separate watermarked file. This version does not generate watermarks automatically: prepare the watermarked export before uploading it.</span></div>
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
          <label>Rights / source reference<input type="url" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="https://…" /></label>
          <label className="license-check"><input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} /> Feature as “Video of the Moment”</label>
          <div className="admin-form-row upload-pair">
            <label>Original video (.mp4 / .mov)<input required type="file" accept="video/mp4,video/quicktime" onChange={(e) => setOriginalFile(e.target.files?.[0] || null)} /><small>{originalFile?.name || "Private clean master"}</small></label>
            <label>Watermarked video (.mp4 / .mov)<input required type="file" accept="video/mp4,video/quicktime" onChange={(e) => setWatermarkedFile(e.target.files?.[0] || null)} /><small>{watermarkedFile?.name || "Private Free-tier rendition"}</small></label>
          </div>
          <label className="license-check"><input type="checkbox" checked={licenseVerified} onChange={(e) => setLicenseVerified(e.target.checked)} /> I have checked and documented the rights needed to distribute this footage.</label>
          {error && <div className="account-error" role="alert">{error}</div>}
          {message && <div className="admin-status" role="status">{message}</div>}
          <div className="admin-form-actions"><button className="outline-btn" type="button" onClick={() => window.location.assign("/dashboard")}>Cancel</button><button className="primary-btn" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload video ↗"}</button></div>
        </form>
      </section>
    </main>
  );
}
