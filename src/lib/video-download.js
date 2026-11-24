import { requestVideoDownload } from "@/lib/server-fns";
import { getAccessToken } from "@base44/sdk";
import { cleanVideoBlob } from "@/lib/video-cleaner";

const EXTENSION_BY_MIME = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function getExtension(downloadUrl, contentType) {
  try {
    const pathname = decodeURIComponent(new URL(downloadUrl).pathname);
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match) return match[1].toLowerCase();
  } catch {}
  return EXTENSION_BY_MIME[(contentType || "").split(";")[0].trim().toLowerCase()] || "";
}

function safeBaseName(value) {
  return String(value || "vicehub-video")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "vicehub-video";
}

export async function downloadCleanVideo({ videoId, title, onProgress = () => {} }) {
  onProgress("Authorising your VICEHUB download…");
  const authorised = await requestVideoDownload({ data: { videoId } });
  let response;
  try {
    response = await fetch(authorised.downloadUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: getAccessToken() ? { Authorization: "Bearer " + getAccessToken() } : {},
      cache: "no-store",
    });
  } catch {
    throw new Error("The browser cannot read the private video file. The video-storage bucket must allow CORS GET requests from the VICEHUB website.");
  }
  if (!response.ok) throw new Error("The private video could not be retrieved (HTTP " + response.status + ").");

  const sourceBlob = await response.blob();
  const extension = getExtension(authorised.downloadUrl, response.headers.get("content-type"));
  if (!["mp4", "mov", "webm"].includes(extension)) {
    throw new Error("This file is not MP4, MOV or WebM. No uncleaned file has been downloaded.");
  }

  const cleaned = await cleanVideoBlob(sourceBlob, extension, onProgress, { title });
  const fileName = safeBaseName(title) + "-cleaned." + extension;
  const objectUrl = URL.createObjectURL(cleaned.blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

  return {
    fileName,
    downloadsRemaining: authorised.downloadsRemaining,
    watermarkApplied: authorised.watermarkApplied,
    cleaned: true,
  };
}
