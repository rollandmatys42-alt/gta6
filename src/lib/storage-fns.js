import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { secrets } from "base44:runtime";
import { requireUser } from "@/lib/auth-middleware";

const enc = new TextEncoder();
const PREFIX = "vicehub_storage_conn_";
const safeAdmin = context => {
  if (context.user?.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
};
const b64 = bytes => { let binary = ""; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary); };
const unb64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
async function encryptionKey() {
  const secret = secrets.get("VIDEO_STORAGE_ENCRYPTION_KEY");
  if (!secret) throw Object.assign(new Error("Storage encryption is not configured. Contact the VICEHUB administrator."), { status: 503, code: "STORAGE_ENCRYPTION_NOT_CONFIGURED" });
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
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
export const getStorageConnections = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
  safeAdmin(context); const rows=await allConnectionRows(context.getBase44().asServiceRole.entities);
  return Promise.all(rows.map(readConnection)).then(list=>list.map(publicConnection));
});
export const saveStorageConnection = createServerFn({method:"POST"}).middleware([requireUser])
.validator(z.object({name:z.string().trim().min(2).max(80),provider:z.enum(["cloudflare-r2","s3-compatible"]),endpoint:z.string().url().max(300),bucket:z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/),region:z.string().trim().min(1).max(40).default("auto"),accessKey:z.string().trim().min(4).max(300),secretKey:z.string().min(8).max(500),capacityGb:z.number().positive().max(1000000).optional()}))
.handler(async({data,context})=>{
  safeAdmin(context); const endpoint=new URL(data.endpoint); if(endpoint.protocol!=="https:")throw new Error("The storage endpoint must use HTTPS.");
  const credentials={accessKey:data.accessKey,secretKey:data.secretKey};
  const connection={...data,endpoint:endpoint.origin+endpoint.pathname.replace(/\/$/,"")};
  await verifyCredentials({...connection,...credentials});
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const publicData={id,provider:data.provider,name:data.name,endpoint:connection.endpoint,bucket:data.bucket,region:data.region,capacityGb:data.capacityGb||null,usedBytes:0,enabled:true,verifiedAt:now,createdAt:now};
  const row=await context.getBase44().asServiceRole.entities.SiteSetting.create({setting_key:PREFIX+id,setting_value:JSON.stringify({public:publicData,credentials:await encrypt(credentials)}),is_public:false,updated_by:context.user.id});
  return {...publicConnection(publicData),saved:!!row.id};
});
export const testStorageConnection = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({connectionId:z.string().min(1)})).handler(async({data,context})=>{
  safeAdmin(context); const entities=context.getBase44().asServiceRole.entities;
  const row=(await allConnectionRows(entities)).find(item=>item.setting_key===PREFIX+data.connectionId);
  if(!row)throw Object.assign(new Error("Storage connection not found."),{status:404});
  const connection=await readConnection(row); await verifyCredentials(connection);
  const parsed=JSON.parse(row.setting_value||"{}"); parsed.public.verifiedAt=new Date().toISOString();
  await entities.SiteSetting.update(row.id,{setting_value:JSON.stringify(parsed),updated_by:context.user.id});
  return {ok:true,verifiedAt:parsed.public.verifiedAt};
});
export const disableStorageConnection = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({connectionId:z.string().min(1)})).handler(async({data,context})=>{
  safeAdmin(context); const entities=context.getBase44().asServiceRole.entities;
  const row=(await allConnectionRows(entities)).find(item=>item.setting_key===PREFIX+data.connectionId);
  if(!row)throw Object.assign(new Error("Storage connection not found."),{status:404});
  const parsed=JSON.parse(row.setting_value||"{}"); parsed.public.enabled=false;
  await entities.SiteSetting.update(row.id,{setting_value:JSON.stringify(parsed),updated_by:context.user.id}); return {ok:true};
});
export async function issueStorageUploadUrl({entities,fileName,contentType,fileSize,reservedBytes=0,assetVariant,connectionId}) {
  const rows=await allConnectionRows(entities), connections=await Promise.all(rows.map(readConnection));
  let connection=connectionId?connections.find(item=>item.id===connectionId):null;
  if(connectionId&&!connection)throw new Error("The selected storage connection no longer exists.");
  const candidates=connections.filter(item=>item.enabled!==false&&item.verifiedAt).sort((a,b)=>(a.usedBytes||0)-(b.usedBytes||0));
  if(!connection)connection=candidates.find(item=>!item.capacityGb||(Number(item.usedBytes||0)+Number(fileSize||0)+Number(reservedBytes||0))<=item.capacityGb*1000000000);
  if(!connection&&connections.length)throw new Error("No connected storage space has enough configured capacity for this upload.");
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
