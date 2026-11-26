import {createFileRoute} from "@tanstack/react-router";
import {requireUserRoute} from "@/lib/auth-middleware";
import {streamGoogleDriveMedia} from "@/lib/google-drive-api";
import {verifyDigitalDownload} from "@/lib/digital-shop-security";

const allowedStates=["paid","paid_stock_issue","processing","shipped","delivered"];
export const Route=createFileRoute("/api/shop/digital-download/$productId")({
 server:{middleware:[requireUserRoute],handlers:{GET:async({params,request,context})=>{
  const query=new URL(request.url).searchParams,orderId=query.get("orderId")||"",expires=query.get("expires")||"",signature=query.get("signature")||"";
  if(!orderId||!await verifyDigitalDownload(orderId,params.productId,expires,signature))return Response.json({error:"This download link has expired or is invalid."},{status:403,headers:{"cache-control":"no-store"}});
  const db=context.getBase44().asServiceRole.entities;
  const order=await db.ShopOrder.get(orderId).catch(()=>null);
  if(!order||order.user_id!==context.user.id||!allowedStates.includes(order.status))return Response.json({error:"A verified paid order is required."},{status:403,headers:{"cache-control":"no-store"}});
  if(!(order.items||[]).some(item=>item.product_id===params.productId&&item.product_type==="digital"))return Response.json({error:"This product is not part of the order."},{status:403,headers:{"cache-control":"no-store"}});
  const product=await db.ShopProduct.get(params.productId).catch(()=>null);
  if(!product||product.product_type!=="digital"||product.digital_storage_provider!=="google_drive"||!product.digital_google_drive_file_id)return Response.json({error:"The digital file is unavailable."},{status:404,headers:{"cache-control":"no-store"}});
  try{
   const response=await streamGoogleDriveMedia(context.getBase44(),product.digital_google_drive_file_id,request);
   const headers=new Headers(response.headers);
   const name=String(product.digital_file_name||product.title||"digital-download").replaceAll("/","_").replaceAll("\\","_").replaceAll("\r","_").replaceAll("\n","_").replaceAll("\"","_").slice(0,160)||"digital-download";
   headers.set("content-disposition","attachment; filename*=UTF-8''"+encodeURIComponent(name));
   headers.set("cache-control","private, no-store");
   headers.set("x-content-type-options","nosniff");
   return new Response(response.body,{status:response.status,headers});
  }catch(error){
   return Response.json({error:error?.message||"Google Drive download failed."},{status:error?.status||502,headers:{"cache-control":"no-store"}});
  }
 }}}
});
