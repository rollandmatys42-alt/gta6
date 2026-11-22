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


async function createWatermarkedRendition(file, onProgress) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("This browser cannot create a watermarked MP4. Use an up-to-date Chrome, Edge or Safari browser on a desktop.");
  }
  const video = document.createElement("video");
  const sourceUrl = URL.createObjectURL(file);
  video.src = sourceUrl;
  video.preload = "auto";
  video.playsInline = true;
  video.muted = false;
  video.volume = 1;
  video.crossOrigin = "anonymous";
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
    const videoStream = typeof video.captureStream === "function"
      ? video.captureStream()
      : typeof video.mozCaptureStream === "function" ? video.mozCaptureStream() : null;
    if (!videoStream) throw new Error("This browser cannot capture the source video's audio track.");
    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks(), ...videoStream.getAudioTracks()];
    const combined = new MediaStream(tracks);
    const mimeType = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]
      .find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("MP4/H.264 recording is not supported by this browser. Use a browser with MP4 MediaRecorder support; no unwatermarked file will be published.");
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
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
    let raf = 0;
    const drawFrame = () => {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, width, height);
        const pad = Math.max(16, Math.round(width * 0.018));
        const fontSize = Math.max(18, Math.round(width * 0.027));
        const label = "VICEHUB";
        ctx.save();
        ctx.font = "900 " + fontSize + "px Arial, sans-serif";
        const textWidth = ctx.measureText(label).width;
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
        ctx.fillText(label, x + pad, y + boxHeight / 2);
        ctx.restore();
      }
      onProgress?.(Math.min(99, Math.round((video.currentTime / video.duration) * 100)));
      if (!video.ended && !video.error) raf = requestAnimationFrame(drawFrame);
    };
    recorder.start(1000);
    await video.play();
    drawFrame();
    await new Promise(resolve => { video.onended = resolve; });
    drawFrame();
    await new Promise(resolve => setTimeout(resolve, 150));
    if (recorder.state !== "inactive") recorder.stop();
    const output = await result;
    onProgress?.(100);
    return output;
  } finally {
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

  if (user?.role !== "admin") return <main className="account-page"><section className="account-content"><h1>ACCESS DENIED.</h1><p className="account-intro">Administrator permissions are required to manage video content.</p><button className="outline-btn" onClick={() => window.location.assign("/dashboard")}>Back to account</button></section></main>;

  const submit = async (event) => {
    event.preventDefault();
    setError(""); setMessage("");
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
        <div className="admin-warning"><b>Automatic watermark protection</b><span>VICEHUB generates a permanent MP4 watermark in your browser. The clean master and watermarked copy are stored separately in private storage. Free downloads receive the branded copy; paid access follows the active plan entitlement.</span></div>
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
            <label>Original video (.mp4 / .mov)<input required type="file" accept="video/mp4,video/quicktime" onChange={(e) => { setOriginalFile(e.target.files?.[0] || null); setWatermarkProgress(0); }} /><small>{originalFile?.name || "Choose the clean master video"}</small></label>
          </div>
          {originalFile && <div className="watermark-progress-panel"><div><b>AUTOMATIC WATERMARK</b><span>{watermarkProgress > 0 ? watermarkProgress + "% processed" : "Generated when you upload this video"}</span></div><div className="quota-track"><i style={{ width: watermarkProgress + "%" }} /></div><small>The watermark is burned into every frame. Processing runs locally in this browser before either file is uploaded.</small></div>}
          <label className="license-check"><input type="checkbox" checked={licenseVerified} onChange={(e) => setLicenseVerified(e.target.checked)} /> I have checked and documented the rights needed to distribute this footage.</label>
          {error && <div className="account-error" role="alert">{error}</div>}
          {message && <div className="admin-status" role="status">{message}</div>}
          <div className="admin-form-actions"><button className="outline-btn" type="button" onClick={() => window.location.assign("/dashboard")}>Cancel</button><button className="primary-btn" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload video ↗"}</button></div>
        </form>
      </section>
    </main>
  );
}
