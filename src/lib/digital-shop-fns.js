import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireUser} from "@/lib/auth-middleware";
import {createStorageAssetUrl,issueDigitalProductUploadUrl,recordStorageUsage} from "@/lib/storage-fns";
import {getGoogleDriveFileMetadata,listGoogleDriveDigitalFiles as fetchGoogleDriveDigitalFiles} from "@/lib/google-drive-api";
import {signDigitalDownload} from "@/lib/digital-shop-security";

const allowedDownloadStates=["paid","paid_stock_issue","processing","shipped","delivered"];
const fileTypes=["application/pdf","application/zip","application/x-zip-compressed","image/png","image/jpeg","image/webp","video/mp4","audio/mpeg","audio/wav","text/plain","text/csv"];
function requireAdmin(context){
 if(context.user?.role!=="admin")throw Object.assign(new Error("Administrator access required."),{status:403,code:"ADMIN_REQUIRED"});
}
export const listGoogleDriveDigitalFiles=createServerFn({method:"GET"}).middleware([requireUser]).validator(z.object({
 query:z.string().trim().max(100).default(""),pageToken:z.string().max(2000).optional(),parentId:z.string().max(512).optional()
})).handler(async({data,context})=>{
 requireAdmin(context);
 return {...await fetchGoogleDriveDigitalFiles(context.getBase44(),data),connected:true};
});
export const createDigitalProductUploadUrl=createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({fileName:z.string().min(1).max(180),contentType:z.enum(fileTypes),fileSize:z.number().int().min(1).max(1000000000)})).handler(async({data,context})=>{
 requireAdmin(context);
 return issueDigitalProductUploadUrl({entities:context.getBase44().asServiceRole.entities,...data});
});
export const saveDigitalShopProduct=createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({
 id:z.string().optional(),title:z.string().min(2).max(160),description:z.string().max(5000),priceCents:z.number().int().min(0),currency:z.enum(["GBP","EUR","USD"]),status:z.enum(["draft","published","archived"]),sku:z.string().max(80).optional(),category:z.enum(["Digital","Creator Gear","Other","Collectibles","Accessories","Apparel"]),imageUrl:z.string().url().max(1000).optional(),isFeatured:z.boolean(),rightsStatus:z.enum(["original","licensed"]),rightsEvidenceUrl:z.string().url().max(1000).optional(),rightsNote:z.string().min(5).max(1000),
 digitalStorageProvider:z.enum(["private_storage","google_drive"]).default("private_storage"),digitalGoogleDriveFileId:z.string().min(5).max(512).optional(),digitalStorageKey:z.string().max(500).optional(),digitalStorageConnectionId:z.string().max(128).optional(),digitalFileName:z.string().max(180).optional(),digitalContentType:z.enum(fileTypes).optional(),digitalFileSizeBytes:z.number().int().min(1).max(1000000000).optional()
})).handler(async({data,context})=>{
 requireAdmin(context);
 if(data.status==="published"&&data.rightsStatus==="licensed"&&!data.rightsEvidenceUrl)throw Object.assign(new Error("A licence evidence URL is required before publishing a licensed product."),{status:400,code:"SHOP_LICENCE_EVIDENCE_REQUIRED"});
 const entities=context.getBase44().asServiceRole.entities,db=entities.ShopProduct,existing=data.id?await db.get(data.id).catch(()=>null):null;
 if(data.id&&!existing)throw Object.assign(new Error("Product not found."),{status:404});
 let asset;
 if(data.digitalStorageProvider==="google_drive"){
  if(!data.digitalGoogleDriveFileId)throw Object.assign(new Error("Choose a file from the connected Google Drive first."),{status:400,code:"SHOP_DRIVE_FILE_REQUIRED"});
  const file=await getGoogleDriveFileMetadata(context.getBase44(),data.digitalGoogleDriveFileId);
  if(!fileTypes.includes(file.mimeType))throw Object.assign(new Error("This Google Drive file type is not supported by the digital shop."),{status:415,code:"SHOP_DRIVE_FILE_TYPE_UNSUPPORTED"});
  if(file.capabilities?.canDownload===false)throw Object.assign(new Error("Google Drive does not allow this file to be downloaded by the connected account."),{status:403,code:"SHOP_DRIVE_DOWNLOAD_BLOCKED"});
  const bytes=Number(file.size||0);
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>1000000000)throw Object.assign(new Error("Google Drive file must be between 1 byte and 1 GB."),{status:400,code:"SHOP_DRIVE_FILE_SIZE_INVALID"});
  asset={digital_storage_provider:"google_drive",digital_google_drive_file_id:file.id,digital_storage_key:"digital-products/drive-"+file.id,digital_storage_connection_id:"google-drive",digital_file_name:String(file.name||"Digital product").slice(0,180),digital_content_type:file.mimeType,digital_file_size_bytes:bytes};
 }else{
  if(!data.digitalStorageKey||!/^digital-products\/[a-zA-Z0-9._-]+$/.test(data.digitalStorageKey)||!data.digitalStorageConnectionId||data.digitalStorageConnectionId==="google-drive"||!data.digitalFileName||!data.digitalContentType||!data.digitalFileSizeBytes)throw Object.assign(new Error("Upload the digital file to private storage before saving the product."),{status:400,code:"SHOP_PRIVATE_FILE_REQUIRED"});
  asset={digital_storage_provider:"private_storage",digital_storage_key:data.digitalStorageKey,digital_storage_connection_id:data.digitalStorageConnectionId,digital_file_name:data.digitalFileName,digital_content_type:data.digitalContentType,digital_file_size_bytes:data.digitalFileSizeBytes};
 }
 const payload={title:data.title,description:data.description,product_type:"digital",price_cents:data.priceCents,currency:data.currency,status:data.status,sku:data.sku||"",category:data.category,vendor_type:data.rightsStatus==="licensed"?"licensed_partner":"vicehub",rights_status:data.rightsStatus,rights_note:data.rightsNote,rights_evidence_url:data.rightsEvidenceUrl||"",shipping_required:false,shipping_price_cents:0,size_options:[],color_options:[],is_featured:data.isFeatured,...asset,...(data.imageUrl?{image_url:data.imageUrl}:{})};
 const saved=data.id?await db.update(data.id,payload):await db.create(payload);
 if(asset.digital_storage_provider==="private_storage"&&(!existing||existing.digital_storage_key!==asset.digital_storage_key))await recordStorageUsage({entities,connectionId:asset.digital_storage_connection_id,bytes:asset.digital_file_size_bytes});
 return saved;
});
export const getShopDigitalDownloadUrl=createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({orderId:z.string().min(1).max(128),productId:z.string().min(1).max(128)})).handler(async({data,context})=>{
 const entities=context.getBase44().asServiceRole.entities,order=await entities.ShopOrder.get(data.orderId).catch(()=>null);
 if(!order||order.user_id!==context.user.id)throw Object.assign(new Error("Order not found for this account."),{status:404});
 if(!allowedDownloadStates.includes(order.status))throw Object.assign(new Error("Digital downloads unlock only after verified payment."),{status:409,code:"SHOP_ORDER_NOT_PAID"});
 if(!(order.items||[]).some(x=>x.product_id===data.productId&&x.product_type==="digital"))throw Object.assign(new Error("This digital product is not part of the selected order."),{status:403,code:"SHOP_ITEM_NOT_PURCHASED"});
 const product=await entities.ShopProduct.get(data.productId).catch(()=>null);
 if(!product||product.product_type!=="digital"||!product.digital_storage_key||!String(product.digital_storage_key).startsWith("digital-products/"))throw Object.assign(new Error("The purchased digital file is not available yet. Contact VICEHUB support."),{status:409,code:"SHOP_DIGITAL_FILE_NOT_READY"});
 if(product.digital_storage_provider==="google_drive"){
  if(!product.digital_google_drive_file_id)throw Object.assign(new Error("The Google Drive file reference is missing."),{status:409});
  const expiresAt=Date.now()+120000,signature=await signDigitalDownload(order.id,product.id,expiresAt);
  const url="/api/shop/digital-download/"+encodeURIComponent(product.id)+"?"+new URLSearchParams({orderId:order.id,expires:String(expiresAt),signature});
  return {url,expiresInSeconds:120,fileName:product.digital_file_name||product.title};
 }
 if(!product.digital_storage_connection_id||product.digital_storage_connection_id==="google-drive")throw Object.assign(new Error("Private storage is unavailable. Contact VICEHUB support."),{status:503});
 const url=await createStorageAssetUrl({entities,connectionId:product.digital_storage_connection_id,objectKey:product.digital_storage_key,expiresIn:120});
 if(!url)throw Object.assign(new Error("Private storage is unavailable. Contact VICEHUB support."),{status:503});
 return {url,expiresInSeconds:120,fileName:product.digital_file_name||product.title};
});
