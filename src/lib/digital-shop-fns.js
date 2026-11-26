import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireUser} from "@/lib/auth-middleware";
import {createStorageAssetUrl,issueDigitalProductUploadUrl,recordStorageUsage} from "@/lib/storage-fns";
const allowedDownloadStates=["paid","paid_stock_issue","processing","shipped","delivered"];
const fileTypes=["application/pdf","application/zip","application/x-zip-compressed","image/png","image/jpeg","image/webp","video/mp4","audio/mpeg","audio/wav","text/plain","text/csv"];
export const createDigitalProductUploadUrl=createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({fileName:z.string().min(1).max(180),contentType:z.enum(fileTypes),fileSize:z.number().int().min(1).max(1000000000)})).handler(async({data,context})=>{
 if(context.user.role!=="admin")throw Object.assign(new Error("Administrator access required."),{status:403,code:"ADMIN_REQUIRED"});
 return issueDigitalProductUploadUrl({entities:context.getBase44().asServiceRole.entities,...data});
});
export const saveDigitalShopProduct=createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({
 id:z.string().optional(),title:z.string().min(2).max(160),description:z.string().max(5000),priceCents:z.number().int().min(0),currency:z.enum(["GBP","EUR","USD"]),status:z.enum(["draft","published","archived"]),sku:z.string().max(80).optional(),category:z.enum(["Digital","Creator Gear","Other","Collectibles","Accessories","Apparel"]),imageUrl:z.string().url().max(1000).optional(),isFeatured:z.boolean(),rightsStatus:z.enum(["original","licensed"]),rightsEvidenceUrl:z.string().url().max(1000).optional(),rightsNote:z.string().min(5).max(1000),digitalStorageKey:z.string().min(1).max(500).regex(/^digital-products\/[a-zA-Z0-9._-]+$/),digitalStorageConnectionId:z.string().min(1).max(128),digitalFileName:z.string().min(1).max(180),digitalContentType:z.enum(fileTypes),digitalFileSizeBytes:z.number().int().min(1).max(1000000000)
})).handler(async({data,context})=>{
 if(context.user.role!=="admin")throw Object.assign(new Error("Administrator access required."),{status:403,code:"ADMIN_REQUIRED"});
 if(data.status==="published"&&data.rightsStatus==="licensed"&&!data.rightsEvidenceUrl)throw Object.assign(new Error("A licence evidence URL is required before publishing a licensed product."),{status:400,code:"SHOP_LICENCE_EVIDENCE_REQUIRED"});
 const entities=context.getBase44().asServiceRole.entities,db=entities.ShopProduct,existing=data.id?await db.get(data.id).catch(()=>null):null;
 if(data.id&&!existing)throw Object.assign(new Error("Product not found."),{status:404});
 const payload={title:data.title,description:data.description,product_type:"digital",price_cents:data.priceCents,currency:data.currency,status:data.status,sku:data.sku||"",category:data.category,vendor_type:data.rightsStatus==="licensed"?"licensed_partner":"vicehub",rights_status:data.rightsStatus,rights_note:data.rightsNote,rights_evidence_url:data.rightsEvidenceUrl||"",shipping_required:false,shipping_price_cents:0,size_options:[],color_options:[],is_featured:data.isFeatured,digital_storage_key:data.digitalStorageKey,digital_storage_connection_id:data.digitalStorageConnectionId,digital_file_name:data.digitalFileName,digital_content_type:data.digitalContentType,digital_file_size_bytes:data.digitalFileSizeBytes,...(data.imageUrl?{image_url:data.imageUrl}:{})};
 const saved=data.id?await db.update(data.id,payload):await db.create(payload);
 if(!existing||existing.digital_storage_key!==data.digitalStorageKey)await recordStorageUsage({entities,connectionId:data.digitalStorageConnectionId,bytes:data.digitalFileSizeBytes});
 return saved;
});
export const getShopDigitalDownloadUrl=createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({orderId:z.string().min(1).max(128),productId:z.string().min(1).max(128)})).handler(async({data,context})=>{
 const entities=context.getBase44().asServiceRole.entities,order=await entities.ShopOrder.get(data.orderId).catch(()=>null);
 if(!order||order.user_id!==context.user.id)throw Object.assign(new Error("Order not found for this account."),{status:404});
 if(!allowedDownloadStates.includes(order.status))throw Object.assign(new Error("Digital downloads unlock only after Stripe confirms payment."),{status:409,code:"SHOP_ORDER_NOT_PAID"});
 if(!(order.items||[]).some(x=>x.product_id===data.productId&&x.product_type==="digital"))throw Object.assign(new Error("This digital product is not part of the selected order."),{status:403,code:"SHOP_ITEM_NOT_PURCHASED"});
 const product=await entities.ShopProduct.get(data.productId).catch(()=>null);
 if(!product||product.product_type!=="digital"||!product.digital_storage_key||!product.digital_storage_connection_id)throw Object.assign(new Error("The purchased digital file is not available yet. Contact VICEHUB support."),{status:409,code:"SHOP_DIGITAL_FILE_NOT_READY"});
 if(!product.digital_storage_key.startsWith("digital-products/"))throw Object.assign(new Error("The digital asset reference is invalid."),{status:409});
 const url=await createStorageAssetUrl({entities,connectionId:product.digital_storage_connection_id,objectKey:product.digital_storage_key,expiresIn:120});
 if(!url)throw Object.assign(new Error("Private storage is unavailable. Contact VICEHUB support."),{status:503});
 return {url,expiresInSeconds:120,fileName:product.digital_file_name||product.title};
});
