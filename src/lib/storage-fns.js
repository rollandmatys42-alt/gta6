import { secrets } from "base44:runtime";

const enc = new TextEncoder();
const PREFIX = "vicehub_storage_conn_";
const b64 = bytes => { let binary = ""; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary); };
const unb64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
async function encryptionKey() {
  const masterSecret = secrets.get("SOCIAL_TOKEN_ENCRYPTION_KEY");
  if (!masterSecret || masterSecret.length < 32) throw Object.assign(new Error("The platform encryption key is not configured. Contact the VICEHUB administrator."), { status: 503, code: "STORAGE_ENCRYPTION_NOT_CONFIGURED" });
  const material = await crypto.subtle.importKey("raw", enc.encode(masterSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("VICEHUB_STORAGE"), info: enc.encode("STORAGE_CONNECTIONS_V1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function encrypt(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), enc.encode(JSON.stringify(value)));
  return b64(new Uint8Array([...iv, ...new Uint8Array(cipher)]));
}
async function decrypt(value) {
  const bytes = unb64(value);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await encryptionKey(), bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
function awsEncode(value) { return encodeURIComponent(value).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()); }
function hex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""); }
async function hash(value) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(value))); }
async function hmac(key, value) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, enc.encode(value)));
}
async function signKey(secret, date, region) {
  let key = await hmac(enc.encode("AWS4" + secret), date);
  key = await hmac(key, region); key = await hmac(key, "s3"); return hmac(key, "aws4_request");
}
async function signUrl(connection, method, objectKey, contentType, expiresIn = 180) {
  const endpoint = new URL(connection.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("Storage endpoints must use HTTPS.");
  if (!/^[a-zA-Z0-9/_ .-]+$/.test(objectKey) || objectKey.split("/").some(part => part === "..")) throw new Error("Invalid storage object key.");
  const region = connection.region || "auto";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8), scope = date + "/" + region + "/s3/aws4_request";
  const uri = (endpoint.pathname.replace(/\/$/, "") + "/" + awsEncode(connection.bucket) + "/" + objectKey.split("/").map(awsEncode).join("/")).replace(/\/+/g, "/");
  const headers = contentType ? "content-type:" + contentType.trim() + "\nhost:" + endpoint.host + "\n" : "host:" + endpoint.host + "\n";
  const signedHeaders = contentType ? "content-type;host" : "host";
  const params = [["X-Amz-Algorithm","AWS4-HMAC-SHA256"],["X-Amz-Credential",connection.accessKey + "/" + scope],["X-Amz-Date",amzDate],["X-Amz-Expires",String(expiresIn)],["X-Amz-SignedHeaders",signedHeaders]]
    .map(([k,v]) => awsEncode(k) + "=" + awsEncode(v)).sort().join("&");
  const canonical = [method, uri, params, headers, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await hash(canonical)].join("\n");
  const signature = hex(await hmac(await signKey(connection.secretKey, date, region), toSign));
  return endpoint.origin + uri + "?" + params + "&X-Amz-Signature=" + signature;
}
async function verifyCredentials(connection) {
  const key = "system/connection-check-" + crypto.randomUUID() + ".txt", marker = "VICEHUB_STORAGE_CONNECTION_CHECK";
  const put = await fetch(await signUrl(connection, "PUT", key, "text/plain", 60), { method: "PUT", headers: { "Content-Type": "text/plain" }, body: marker });
  if (!put.ok) throw new Error("Storage write test failed (HTTP " + put.status + "). Check endpoint, bucket and write permissions.");
  try {
    const get = await fetch(await signUrl(connection, "GET", key, null, 60));
    if (!get.ok || await get.text() !== marker) throw new Error("Storage read-back test failed. Check read permissions.");
  } finally {
    const del = await fetch(await signUrl(connection, "DELETE", key, null, 60), { method: "DELETE" });
    if (!del.ok) throw new Error("Storage cleanup test failed (HTTP " + del.status + "). Check delete permissions.");
  }
  return true;
}
async function allConnectionRows(entities) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const page = await entities.SiteSetting.list("-created_date", 500, offset);
    rows.push(...page.filter(row => String(row.setting_key || "").startsWith(PREFIX)));
    if (page.length < 500) break;
  }
  return rows;
}
async function readConnection(row) {
  const parsed = JSON.parse(row.setting_value || "{}");
  return { ...parsed.public, ...(await decrypt(parsed.credentials)), rowId: row.id };
}
function publicConnection(c) {
  return { id:c.id, provider:c.provider, name:c.name, bucket:c.bucket, endpointHost:(()=>{try{return new URL(c.endpoint).host;}catch{return "Invalid endpoint";}})(), region:c.region, capacityGb:c.capacityGb||null, usedBytes:c.usedBytes||0, enabled:c.enabled!==false, verifiedAt:c.verifiedAt||null };
}
export async function listStorageConnections(entities) {
  const rows = await allConnectionRows(entities);
  const connections = await Promise.all(rows.map(readConnection));
  return connections.map(publicConnection);
}
export async function addStorageConnection({ entities, data, userId }) {
  const endpoint = new URL(data.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("The storage endpoint must use HTTPS.");
  const credentials = { accessKey: data.accessKey, secretKey: data.secretKey };
  const endpointPath = endpoint.pathname.endsWith("/") ? endpoint.pathname.slice(0, -1) : endpoint.pathname;
  const connection = { ...data, endpoint: endpoint.origin + endpointPath };
  await verifyCredentials({ ...connection, ...credentials });
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const publicData = { id, provider: data.provider, name: data.name, endpoint: connection.endpoint, bucket: data.bucket, region: data.region, capacityGb: data.capacityGb || null, usedBytes: 0, enabled: true, verifiedAt: now, createdAt: now };
  const row = await entities.SiteSetting.create({
    setting_key: PREFIX + id,
    setting_value: JSON.stringify({ public: publicData, credentials: await encrypt(credentials) }),
    is_public: false, updated_by: userId,
  });
  return { ...publicConnection(publicData), saved: !!row.id };
}
export async function verifyStorageConnection({ entities, connectionId, userId }) {
  const row = (await allConnectionRows(entities)).find(item => item.setting_key === PREFIX + connectionId);
  if (!row) throw Object.assign(new Error("Storage connection not found."), { status: 404 });
  const connection = await readConnection(row);
  try {
    await verifyCredentials(connection);
  } catch (error) {
    const parsed = JSON.parse(row.setting_value || "{}");
    parsed.public.verifiedAt = null;
    parsed.public.lastCheckFailedAt = new Date().toISOString();
    await entities.SiteSetting.update(row.id, { setting_value: JSON.stringify(parsed), updated_by: userId });
    throw error;
  }
  const parsed = JSON.parse(row.setting_value || "{}");
  parsed.public.verifiedAt = new Date().toISOString();
  parsed.public.lastCheckFailedAt = null;
  await entities.SiteSetting.update(row.id, { setting_value: JSON.stringify(parsed), updated_by: userId });
  return { ok: true, verifiedAt: parsed.public.verifiedAt };
}
export async function turnOffStorageConnection({ entities, connectionId, userId }) {
  const row = (await allConnectionRows(entities)).find(item => item.setting_key === PREFIX + connectionId);
  if (!row) throw Object.assign(new Error("Storage connection not found."), { status: 404 });
  const parsed = JSON.parse(row.setting_value || "{}");
  parsed.public.enabled = false;
  await entities.SiteSetting.update(row.id, { setting_value: JSON.stringify(parsed), updated_by: userId });
  return { ok: true };
}
export async function issueStorageUploadUrl({entities,contentType,fileSize,reservedBytes=0,assetVariant,connectionId}) {
  const rows=await allConnectionRows(entities), connections=await Promise.all(rows.map(readConnection));
  let connection=connectionId?connections.find(item=>item.id===connectionId):null;
  if(connectionId&&!connection)throw new Error("The selected storage connection no longer exists.");
  const candidates=connections.filter(item=>item.enabled!==false&&item.verifiedAt).sort((a,b)=>(a.usedBytes||0)-(b.usedBytes||0));
  if(!connection)connection=candidates.find(item=>!item.capacityGb||(Number(item.usedBytes||0)+Number(fileSize||0)+Number(reservedBytes||0))<=item.capacityGb*1000000000);
  if(!connection&&candidates.length)throw new Error("No connected storage space has enough configured capacity for this upload.");
  if(!connection)return null;
  if(connection.enabled===false||!connection.verifiedAt)throw new Error("This storage connection is disabled or has not passed its connection test.");
  if(connection.capacityGb&&(Number(connection.usedBytes||0)+Number(fileSize||0)+Number(reservedBytes||0))>connection.capacityGb*1000000000)throw new Error("This storage space has reached its configured capacity. Connect another space or increase its authorised capacity.");
  const extension=contentType==="video/quicktime"?"mov":"mp4";
  const objectKey="videos/"+assetVariant+"/"+crypto.randomUUID()+"."+extension;
  return {uploadUrl:await signUrl(connection,"PUT",objectKey,contentType,300),objectKey,storageConnectionId:connection.id,storageProvider:connection.provider,expiresInSeconds:300};
}
export async function createStorageAssetUrl({entities,connectionId,objectKey,expiresIn=180}) {
  if(!connectionId)return null;
  const row=(await allConnectionRows(entities)).find(item=>item.setting_key===PREFIX+connectionId);
  if(!row)throw new Error("The video storage connection is no longer available.");
  const connection=await readConnection(row);
  if(connection.enabled===false)throw new Error("The video storage connection is disabled.");
  return signUrl(connection,"GET",objectKey,null,expiresIn);
}
export async function recordStorageUsage({entities,connectionId,bytes}) {
  if(!connectionId||!bytes)return;
  const row=(await allConnectionRows(entities)).find(item=>item.setting_key===PREFIX+connectionId);
  if(!row)return;
  const parsed=JSON.parse(row.setting_value||"{}"); parsed.public.usedBytes=Number(parsed.public.usedBytes||0)+Number(bytes||0);
  await entities.SiteSetting.update(row.id,{setting_value:JSON.stringify(parsed)});
}

async function legacyR2Connection() {
  const endpoint=secrets.get("VIDEO_STORAGE_ENDPOINT"),bucket=secrets.get("VIDEO_STORAGE_BUCKET"),accessKey=secrets.get("VIDEO_STORAGE_ACCESS_KEY_ID"),secretKey=secrets.get("VIDEO_STORAGE_SECRET_ACCESS_KEY");
  if(!endpoint||!bucket||!accessKey||!secretKey)throw Object.assign(new Error("Private video storage is not configured."),{status:503});
  return {endpoint,bucket,accessKey,secretKey,region:secrets.get("VIDEO_STORAGE_REGION")||"auto"};
}
export async function proxyStorageAsset({entities,connectionId,objectKey,request}) {
  let connection;
  if(connectionId){
    const row=(await allConnectionRows(entities)).find(item=>item.setting_key===PREFIX+connectionId);
    if(!row)throw Object.assign(new Error("The video storage connection is no longer available."),{status:404});
    connection=await readConnection(row);
    if(connection.enabled===false)throw Object.assign(new Error("The video storage connection is disabled."),{status:503});
  } else connection=await legacyR2Connection();
  const url=await signUrl(connection,"GET",objectKey,null,300);
  const upstreamHeaders=new Headers();
  for(const name of ["range","if-range"]) { const value=request.headers.get(name); if(value)upstreamHeaders.set(name,value); }
  const upstream=await fetch(url,{method:"GET",headers:upstreamHeaders,redirect:"follow"});
  if(!upstream.ok&&upstream.status!==206){
    const status=upstream.status===404?404:upstream.status===416?416:502;
    throw Object.assign(new Error("Private storage could not provide this video (HTTP "+upstream.status+")."),{status});
  }
  const responseHeaders=new Headers();
  for(const name of ["content-type","content-length","content-range","accept-ranges","etag","last-modified"]) {
    const value=upstream.headers.get(name); if(value)responseHeaders.set(name,value);
  }
  if(!responseHeaders.has("accept-ranges"))responseHeaders.set("accept-ranges","bytes");
  responseHeaders.set("cache-control","private, no-store");
  responseHeaders.set("x-content-type-options","nosniff");
  return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
}

export async function issueDigitalProductUploadUrl({entities,fileName,contentType,fileSize}) {
 const extensions={"application/pdf":"pdf","application/zip":"zip","application/x-zip-compressed":"zip","image/png":"png","image/jpeg":"jpg","image/webp":"webp","video/mp4":"mp4","audio/mpeg":"mp3","audio/wav":"wav","text/plain":"txt","text/csv":"csv"};
 if(!extensions[contentType])throw Object.assign(new Error("Unsupported digital file type."),{status:400,code:"DIGITAL_FILE_TYPE_NOT_ALLOWED"});
 if(!Number.isInteger(fileSize)||fileSize<1||fileSize>1000000000)throw Object.assign(new Error("Digital files must be between 1 byte and 1 GB."),{status:400,code:"DIGITAL_FILE_SIZE_INVALID"});
 if(!fileName||fileName.length>180||/[\\/]/.test(fileName))throw Object.assign(new Error("Invalid digital file name."),{status:400,code:"DIGITAL_FILE_NAME_INVALID"});
 const rows=await allConnectionRows(entities),connections=await Promise.all(rows.map(readConnection));
 const candidates=connections.filter(x=>x.enabled!==false&&x.verifiedAt).sort((a,b)=>(a.usedBytes||0)-(b.usedBytes||0));
 const connection=candidates.find(x=>!x.capacityGb||(Number(x.usedBytes||0)+fileSize)<=x.capacityGb*1000000000);
 if(!connection)throw Object.assign(new Error("No verified private storage connection has enough capacity. Configure and test private storage in VICEHUB administration first."),{status:503,code:"DIGITAL_STORAGE_NOT_READY"});
 const objectKey="digital-products/"+crypto.randomUUID()+"."+extensions[contentType];
 return {uploadUrl:await signUrl(connection,"PUT",objectKey,contentType,300),objectKey,storageConnectionId:connection.id,expiresInSeconds:300};
}
