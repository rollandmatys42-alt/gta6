import { createClientFromRequest } from "npm:@base44/sdk";

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const unb64 = (value: string) => {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
};
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const sha = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
const hmac = async (keyBytes: Uint8Array, value: string) => {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
};
const awsEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
async function signKey(secret: string, date: string, region: string) {
  let key = await hmac(enc.encode("AWS4" + secret), date);
  key = await hmac(key, region); key = await hmac(key, "s3");
  return hmac(key, "aws4_request");
}
async function signedR2Get(objectKey: string, expires = 3600) {
  const endpoint = Deno.env.get("VIDEO_STORAGE_ENDPOINT") || "";
  const bucket = Deno.env.get("VIDEO_STORAGE_BUCKET") || "";
  const access = Deno.env.get("VIDEO_STORAGE_ACCESS_KEY_ID") || "";
  const secret = Deno.env.get("VIDEO_STORAGE_SECRET_ACCESS_KEY") || "";
  const region = Deno.env.get("VIDEO_STORAGE_REGION") || "auto";
  if (!endpoint || !bucket || !access || !secret) throw new Error("Private video storage is not configured.");
  if (!objectKey || objectKey.startsWith("/") || objectKey.split("/").some(p => p === "..") || !/^[a-zA-Z0-9/_ .-]+$/.test(objectKey)) throw new Error("Invalid private media key.");
  const base = new URL(endpoint);
  if (base.protocol !== "https:") throw new Error("Video storage endpoint must use HTTPS.");
  const now = new Date();
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = iso.slice(0, 8);
  const scope = date + "/" + region + "/s3/aws4_request";
  const uri = (base.pathname.replace(/\/$/, "") + "/" + awsEncode(bucket) + "/" + objectKey.split("/").map(awsEncode).join("/")).replace(/\/+/g, "/");
  const params = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", access + "/" + scope],
    ["X-Amz-Date", iso],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ].map(([k, v]) => awsEncode(k) + "=" + awsEncode(v)).sort().join("&");
  const canonical = ["GET", uri, params, "host:" + base.host + "\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", iso, scope, hex(await sha(canonical))].join("\n");
  const signature = hex(await hmac(await signKey(secret, date, region), stringToSign));
  return base.origin + uri + "?" + params + "&X-Amz-Signature=" + signature;
}
async function decryptToken(value: string) {
  if (!value) return "";
  const secret = Deno.env.get("SOCIAL_TOKEN_ENCRYPTION_KEY") || "";
  if (secret.length < 32) throw new Error("Social token encryption key is not configured.");
  const [iv, data] = value.split(".");
  const key = await crypto.subtle.importKey("raw", await sha(secret), { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(data)));
}
async function encryptToken(value: string) {
  const secret = Deno.env.get("SOCIAL_TOKEN_ENCRYPTION_KEY") || "";
  if (secret.length < 32) throw new Error("Social token encryption key is not configured.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", await sha(secret), { name: "AES-GCM" }, false, ["encrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value));
  return b64url(iv) + "." + b64url(new Uint8Array(data));
}
async function tokenRequest(url: string, body: URLSearchParams, clientId?: string, clientSecret?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(clientId && clientSecret ? { Authorization: "Basic " + btoa(clientId + ":" + clientSecret) } : {}) },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error?.message || "OAuth token refresh failed (HTTP " + response.status + ").");
  return payload;
}
async function apiJson(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: "Bearer " + token, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error_description || payload.message || "Social provider returned HTTP " + response.status + ".");
  return payload;
}
async function getAccessToken(db: any, account: any) {
  if (!account.encrypted_access_token) throw new Error("Social account has no stored access token.");
  let token = await decryptToken(account.encrypted_access_token);
  const expires = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (expires && expires < Date.now() + 120000) {
    if (!account.encrypted_refresh_token || !["TikTok", "YouTube", "X"].includes(account.provider)) throw new Error("Social account token expired. Reconnect this account.");
    const refresh = await decryptToken(account.encrypted_refresh_token);
    let payload: any;
    if (account.provider === "TikTok") {
      payload = await tokenRequest("https://open.tiktokapis.com/v2/oauth/token/", new URLSearchParams({ client_key: Deno.env.get("TIKTOK_CLIENT_KEY") || "", client_secret: Deno.env.get("TIKTOK_CLIENT_SECRET") || "", grant_type: "refresh_token", refresh_token: refresh }));
    } else if (account.provider === "YouTube") {
      payload = await tokenRequest("https://oauth2.googleapis.com/token", new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "", grant_type: "refresh_token", refresh_token: refresh }));
    } else {
      payload = await tokenRequest("https://api.x.com/2/oauth2/token", new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }), Deno.env.get("X_CLIENT_ID") || "", Deno.env.get("X_CLIENT_SECRET") || "");
    }
    token = payload.access_token;
    account = await db.SocialAccount.update(account.id, {
      encrypted_access_token: await encryptToken(token),
      ...(payload.refresh_token ? { encrypted_refresh_token: await encryptToken(payload.refresh_token) } : {}),
      token_expires_at: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(),
      status: "connected", last_error: "",
    });
  }
  return token;
}
async function publish(post: any, account: any, token: string, mediaUrl: string) {
  let externalId = "";
  if (post.platform === "Instagram") {
    if (!mediaUrl) throw new Error("Instagram Reels require a video.");
    const form = new URLSearchParams({ media_type: "REELS", video_url: mediaUrl, caption: post.caption, access_token: token });
    const create = await fetch("https://graph.facebook.com/v22.0/" + encodeURIComponent(account.provider_account_id) + "/media", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const container = await create.json();
    if (!create.ok || !container.id) throw new Error(container.error?.message || "Instagram container creation failed.");
    let ready = false;
    for (let i = 0; i < 8; i++) {
      const status = await fetch("https://graph.facebook.com/v22.0/" + container.id + "?fields=status_code&access_token=" + encodeURIComponent(token)).then(r => r.json());
      if (status.status_code === "FINISHED") { ready = true; break; }
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error("Instagram could not process this video.");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!ready) throw new Error("Instagram video processing has not completed. Retry later.");
    const done = await fetch("https://graph.facebook.com/v22.0/" + account.provider_account_id + "/media_publish", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: container.id, access_token: token }) });
    const result = await done.json();
    if (!done.ok) throw new Error(result.error?.message || "Instagram publication failed.");
    externalId = result.id;
  } else if (post.platform === "Facebook") {
    if (!mediaUrl) throw new Error("Facebook Page video publishing requires a video.");
    const response = await fetch("https://graph.facebook.com/v22.0/" + account.provider_account_id + "/videos", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ file_url: mediaUrl, description: post.caption, access_token: token }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "Facebook publication failed.");
    externalId = result.id;
  } else if (post.platform === "TikTok") {
    if (!mediaUrl) throw new Error("TikTok video publishing requires a video.");
    const creator = await apiJson("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const privacy = creator.data?.privacy_level_options?.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : creator.data?.privacy_level_options?.[0];
    if (!privacy) throw new Error("TikTok did not return a privacy option for this account.");
    const response = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ post_info: { title: post.caption.slice(0, 150), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: "PULL_FROM_URL", video_url: mediaUrl } }) });
    const result = await response.json();
    if (!response.ok || (result.error?.code && result.error.code !== "ok")) throw new Error(result.error?.message || "TikTok publication request failed.");
    externalId = result.data?.publish_id || "";
    return { status: "publishing", externalId };
  } else if (post.platform === "YouTube") {
    if (!mediaUrl) throw new Error("YouTube publishing requires a video.");
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) throw new Error("Could not retrieve the video for YouTube.");
    const media = await mediaResponse.arrayBuffer();
    if (media.byteLength > 250 * 1024 * 1024) throw new Error("YouTube upload is limited to 250 MB per post in this release.");
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(media.byteLength) }, body: JSON.stringify({ snippet: { title: post.caption.slice(0, 100), description: post.caption, categoryId: "20" }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } }) });
    if (!init.ok) throw new Error("YouTube upload initialisation failed (HTTP " + init.status + ").");
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL.");
    const upload = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(media.byteLength) }, body: media });
    const result = await upload.json().catch(() => ({}));
    if (!upload.ok) throw new Error(result.error?.message || "YouTube upload failed.");
    externalId = result.id || "";
  } else if (post.platform === "X") {
    const result = await apiJson("https://api.x.com/2/tweets", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: post.caption }) });
    externalId = result.data?.id || "";
  }
  return { status: "published", externalId };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // This worker processes the entire platform queue, so only an authenticated app administrator may invoke it.
    const caller = await base44.auth.me();
    if (!caller || caller.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const db = base44.asServiceRole.entities;
    const now = new Date().toISOString();
    const due = await db.SocialPost.filter({ status: "scheduled", scheduled_at: { $lte: now } }, "scheduled_at", 25, 0);
    const results: any[] = [];
    for (const post of due) {
      try {
        const account = await db.SocialAccount.get(post.account_id);
        if (!account || account.user_id !== post.user_id || account.provider !== post.platform || account.status !== "connected") throw new Error("The selected social account is no longer connected to this user.");
        let mediaUrl = post.media_reference || "";
        if (post.media_type === "video" && mediaUrl.startsWith("social/" + post.user_id + "/")) mediaUrl = await signedR2Get(mediaUrl);
        if (post.media_type === "video" && !mediaUrl.startsWith("https://")) throw new Error("Video source is not a valid HTTPS URL.");
        const token = await getAccessToken(db, account);
        const claim = await db.SocialPost.updateMany({ id: post.id, status: "scheduled" }, { $set: { status: "publishing", last_attempt_at: new Date().toISOString(), error_message: "" } });
        if (!claim?.updated) { results.push({ postId: post.id, status: "skipped_already_claimed" }); continue; }
        const result = await publish(post, account, token, mediaUrl);
        await db.SocialPost.update(post.id, { status: result.status, external_post_id: result.externalId || "", ...(result.status === "published" ? { published_at: new Date().toISOString() } : {}), error_message: "" });
        await db.SocialAccount.update(account.id, { last_used_at: new Date().toISOString(), last_error: "" });
        results.push({ postId: post.id, status: result.status });
      } catch (error) {
        await db.SocialPost.update(post.id, { status: "failed", error_message: (error instanceof Error ? error.message : String(error)).slice(0, 500) }).catch(() => null);
        results.push({ postId: post.id, status: "failed", error: (error instanceof Error ? error.message : String(error)) });
      }
    }
    return Response.json({ success: true, processed: results.length, results, ranAt: now });
  } catch (error) {
    return Response.json({ success: false, error: (error instanceof Error ? error.message : String(error)) }, { status: 500 });
  }
});
