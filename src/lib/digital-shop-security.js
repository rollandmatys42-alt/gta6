import { secrets } from "base44:runtime";

const encoder = new TextEncoder();
function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function signatureFor(orderId, productId, expiresAt) {
  const secret = secrets.get("SOCIAL_TOKEN_ENCRYPTION_KEY");
  if (!secret || secret.length < 32) throw Object.assign(new Error("Secure download signing is not configured."), { status: 503 });
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = orderId + ":" + productId + ":" + String(expiresAt);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}
export async function signDigitalDownload(orderId, productId, expiresAt) {
  return signatureFor(orderId, productId, expiresAt);
}
export async function verifyDigitalDownload(orderId, productId, expiresAt, signature) {
  const expiry = Number(expiresAt);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry > Date.now() + 3 * 60 * 1000 || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = await signatureFor(orderId, productId, expiry);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}
