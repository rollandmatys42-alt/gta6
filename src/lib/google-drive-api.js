const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export async function getGoogleDriveAccessToken(base44) {
  try {
    const connection = await base44.asServiceRole.connectors.getConnection("googledrive");
    if (!connection?.accessToken) throw new Error("Google Drive is not connected.");
    return connection.accessToken;
  } catch {
    throw Object.assign(
      new Error("Connect the Google Drive account in VICEHUB integrations before using Drive storage."),
      { status: 503, code: "GOOGLE_DRIVE_NOT_CONNECTED" },
    );
  }
}

async function driveRequest(accessToken, url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", "Bearer " + accessToken);
  const response = await fetch(url, { ...init, headers, redirect: "follow" });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw Object.assign(
      new Error("Google Drive API request failed (HTTP " + response.status + "). " + details.slice(0, 300)),
      { status: response.status >= 500 ? 502 : response.status, code: "GOOGLE_DRIVE_API_ERROR" },
    );
  }
  return response;
}

export async function getGoogleDriveFileMetadata(base44, fileId) {
  if (typeof fileId !== "string" || !fileId.trim() || fileId.length > 512) {
    throw Object.assign(new Error("Invalid Google Drive file ID."), { status: 400 });
  }
  const token = await getGoogleDriveAccessToken(base44);
  const fields = "id,name,mimeType,size,md5Checksum,modifiedTime,parents,webViewLink,description,capabilities(canDownload)";
  const url = DRIVE_API + "/files/" + encodeURIComponent(fileId) + "?" + new URLSearchParams({
    fields,
    supportsAllDrives: "true",
  });
  const response = await driveRequest(token, url);
  return response.json();
}

export async function listGoogleDriveVideoFiles(base44, { query = "", pageToken = "", parentId = "" } = {}) {
  const token = await getGoogleDriveAccessToken(base44);
  const q = ["trashed = false", "mimeType contains 'video/'"];
  if (parentId) {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(parentId)) throw Object.assign(new Error("Invalid Google Drive folder ID."), { status: 400 });
    q.push("'" + parentId + "' in parents");
  }
  const term = String(query || "").trim().slice(0, 100);
  if (term) {
    const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    q.push("name contains '" + escaped + "'");
  }
  const params = new URLSearchParams({
    q: q.join(" and "), pageSize: "50", orderBy: "modifiedTime desc",
    fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink,capabilities(canDownload))",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const response = await driveRequest(token, DRIVE_API + "/files?" + params.toString());
  const payload = await response.json();
  return { files: Array.isArray(payload.files) ? payload.files : [], nextPageToken: payload.nextPageToken || null };
}

export async function listGoogleDriveDigitalFiles(base44, { query = "", pageToken = "", parentId = "" } = {}) {
  const token = await getGoogleDriveAccessToken(base44);
  const q = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (parentId) {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(parentId)) throw Object.assign(new Error("Invalid Google Drive folder ID."), { status: 400 });
    q.push("'" + parentId + "' in parents");
  }
  const term = String(query || "").trim().slice(0, 100);
  if (term) {
    const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    q.push("name contains '" + escaped + "'");
  }
  const params = new URLSearchParams({
    q: q.join(" and "), pageSize: "100", orderBy: "modifiedTime desc",
    fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink,capabilities(canDownload))",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const response = await driveRequest(token, DRIVE_API + "/files?" + params.toString());
  const payload = await response.json();
  const allowed = new Set(["application/pdf", "application/zip", "application/x-zip-compressed", "image/png", "image/jpeg", "image/webp", "video/mp4", "audio/mpeg", "audio/wav", "text/plain", "text/csv"]);
  const files = (Array.isArray(payload.files) ? payload.files : []).filter(file => allowed.has(file.mimeType) && file.capabilities?.canDownload !== false && Number(file.size || 0) > 0 && Number(file.size || 0) <= 1000000000);
  return { files, nextPageToken: payload.nextPageToken || null };
}

export async function listGoogleDriveFolders(base44, { parentId = "root" } = {}) {
  const token = await getGoogleDriveAccessToken(base44);
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(parentId)) throw Object.assign(new Error("Invalid Google Drive folder ID."), { status: 400 });
  const q = ["trashed = false", "mimeType = 'application/vnd.google-apps.folder'", "'" + parentId + "' in parents"];
  const params = new URLSearchParams({
    q: q.join(" and "), pageSize: "100", orderBy: "name",
    fields: "files(id,name,mimeType,modifiedTime,parents,webViewLink)",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  const response = await driveRequest(token, DRIVE_API + "/files?" + params.toString());
  const payload = await response.json();
  return { folders: Array.isArray(payload.files) ? payload.files : [] };
}

async function findOrCreateDriveFolder(accessToken, name, parentId) {
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = ["trashed = false", "mimeType = 'application/vnd.google-apps.folder'", "name = '" + escaped + "'", "'" + parentId + "' in parents"].join(" and ");
  const params = new URLSearchParams({ q, pageSize: "10", fields: "files(id,name,mimeType,parents)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const found = await (await driveRequest(accessToken, DRIVE_API + "/files?" + params.toString())).json();
  if (found.files?.length) return found.files[0];
  const created = await driveRequest(accessToken, DRIVE_API + "/files?supportsAllDrives=true&fields=id,name,mimeType,parents", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  return created.json();
}

export async function ensureGoogleDriveLibraryFolders(base44) {
  const token = await getGoogleDriveAccessToken(base44);
  const root = await findOrCreateDriveFolder(token, "VICEHUB", "root");
  const [originals, published] = await Promise.all([
    findOrCreateDriveFolder(token, "01 - ORIGINALS", root.id),
    findOrCreateDriveFolder(token, "02 - PUBLISHED", root.id),
  ]);
  return { root, originals, published };
}

export async function streamGoogleDriveMedia(base44, fileId, request) {
  const token = await getGoogleDriveAccessToken(base44);
  const url = DRIVE_API + "/files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true";
  const headers = new Headers();
  headers.set("Authorization", "Bearer " + token);
  const range = request?.headers?.get("range");
  const ifRange = request?.headers?.get("if-range");
  if (range) headers.set("Range", range);
  if (ifRange) headers.set("If-Range", ifRange);

  const upstream = await fetch(url, { method: "GET", headers, redirect: "follow" });
  if (!upstream.ok && upstream.status !== 206) {
    throw Object.assign(new Error("Google Drive could not provide this video (HTTP " + upstream.status + ")."), {
      status: upstream.status === 404 ? 404 : 502,
      code: "GOOGLE_DRIVE_DOWNLOAD_FAILED",
    });
  }
  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "private, no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  if (!responseHeaders.has("accept-ranges")) responseHeaders.set("accept-ranges", "bytes");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export async function createGoogleDriveResumableUpload(base44, { fileName, fileSizeBytes, parentFolderId }) {
  const token = await getGoogleDriveAccessToken(base44);
  const safeName = String(fileName || "VICEHUB-clip.mp4")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .trim()
    .slice(0, 180) || "VICEHUB-clip.mp4";
  const size = Number(fileSizeBytes);
  if (!Number.isSafeInteger(size) || size <= 0 || size > 5 * 1024 ** 4) {
    throw Object.assign(new Error("The clip file size is invalid for Google Drive upload."), { status: 400 });
  }
  const metadata = { name: safeName, mimeType: "video/mp4" };
  if (parentFolderId && /^[A-Za-z0-9_-]{5,256}$/.test(parentFolderId)) {
    metadata.parents = [parentFolderId];
  }
  const response = await fetch(DRIVE_UPLOAD_API + "/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,md5Checksum,parents,webViewLink", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(metadata),
    redirect: "manual",
  });
  if (response.status !== 200) {
    const details = await response.text().catch(() => "");
    throw Object.assign(new Error("Google Drive could not start the resumable upload (HTTP " + response.status + "). " + details.slice(0, 250)), {
      status: response.status >= 500 ? 502 : response.status,
      code: "GOOGLE_DRIVE_UPLOAD_INIT_FAILED",
    });
  }
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive did not return a resumable upload session URL.");
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== "https:" || !(parsed.hostname === "www.googleapis.com" || parsed.hostname.endsWith(".googleapis.com")) ||
      !parsed.pathname.startsWith("/upload/drive/v3/files")) {
    throw new Error("Google Drive returned an unexpected resumable upload URL.");
  }
  return { uploadUrl, fileName: safeName, expiresIn: "Google Drive resumable sessions expire after one week." };
}
