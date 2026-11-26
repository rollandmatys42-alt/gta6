import {createFileRoute} from "@tanstack/react-router";
import {requireUserRoute} from "@/lib/auth-middleware";
import {streamGoogleDriveMedia} from "@/lib/google-drive-api";
import {proxyStorageAsset} from "@/lib/storage-fns";

export const Route=createFileRoute("/api/internal-video-download/$assetId")({
 server:{middleware:[requireUserRoute],handlers:{GET:async({params,request,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const asset=await db.InternalVideoAsset.get(params.assetId).catch(()=>null);
  if(!asset||asset.asset_type!=="source"||asset.status!=="ready"||asset.review_status!=="approved"||asset.public_video_status!=="published"||!["authorised","not_applicable"].includes(asset.rights_status)||
    !((asset.storage_provider==="google_drive"&&asset.google_drive_file_id)||(asset.storage_key&&asset.storage_connection_id))){
   return Response.json({error:"Video download unavailable."},{status:404,headers:{"cache-control":"no-store"}});
  }
  const subscriptions=await db.UserSubscription.filter({user_id:context.user.id},"-created_date",1,0);
  const subscription=subscriptions[0];
  const active=subscription?.status==="active"||(subscription?.status==="past_due"&&subscription?.grace_period_ends_at&&new Date(subscription.grace_period_ends_at)>new Date());
  if(!active||!subscription?.tier_code||subscription.tier_code==="free"){
   return Response.json({error:"An active paid VICEHUB membership is required to download videos."},{status:403,headers:{"cache-control":"no-store"}});
  }
  const events=await db.DownloadEvent.filter({user_id:context.user.id,video_id:asset.id,status:"signed"},"-created_date",10,0);
  const event=events.find(item=>item.delivery_expires_at&&new Date(item.delivery_expires_at).getTime()>Date.now());
  if(!event)return Response.json({error:"Download authorisation expired or unavailable."},{status:403,headers:{"cache-control":"no-store"}});
  const consumed=await db.DownloadEvent.updateMany({id:event.id,status:"signed"},{$set:{status:"delivered"}});
  if(!consumed?.updated)return Response.json({error:"Download authorisation has already been used."},{status:403,headers:{"cache-control":"no-store"}});
  try{
   const response=asset.storage_provider==="google_drive"
    ?await streamGoogleDriveMedia(context.getBase44(),asset.google_drive_file_id,request)
    :await proxyStorageAsset({entities:db,connectionId:asset.storage_connection_id,objectKey:asset.storage_key,request});
   const headers=new Headers(response.headers);
   const safeName=String(asset.title||"VICEHUB-video").replace(/[^A-Za-z0-9._-]+/g,"_").slice(0,140)||"VICEHUB-clip";
   headers.set("content-disposition",'attachment; filename="'+safeName+'.mp4"');
   headers.set("cache-control","private, no-store");
   return new Response(response.body,{status:response.status,headers});
  }catch(error){
   await db.DownloadEvent.update(event.id,{status:"failed"}).catch(()=>null);
   return Response.json({error:error?.message||"Video download failed."},{status:error?.status||502,headers:{"cache-control":"no-store"}});
  }
 }}}
});
