import {createFileRoute} from "@tanstack/react-router";
import {requireUserRoute} from "@/lib/auth-middleware";
import {streamGoogleDriveMedia} from "@/lib/google-drive-api";
import {proxyStorageAsset} from "@/lib/storage-fns";

export const Route=createFileRoute("/api/internal-video-preview/$assetId")({
 server:{middleware:[requireUserRoute],handlers:{GET:async({params,request,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const asset=await db.InternalVideoAsset.get(params.assetId).catch(()=>null);
  if(!asset||asset.asset_type!=="source"||asset.status!=="ready"||asset.review_status!=="approved"||asset.public_video_status!=="published"||!["authorised","not_applicable"].includes(asset.rights_status)){
   return Response.json({error:"Video preview unavailable."},{status:404,headers:{"cache-control":"no-store"}});
  }
  // Administrators can preview published, rights-cleared clips for quality control.
  // Members still need an active paid subscription.
  if(context.user?.role!=="admin"){
   const subscriptions=await db.UserSubscription.filter({user_id:context.user.id},"-created_date",1,0);
   const subscription=subscriptions[0];
   const active=subscription?.status==="active"||(subscription?.status==="past_due"&&subscription?.grace_period_ends_at&&new Date(subscription.grace_period_ends_at)>new Date());
   if(!active||!subscription?.tier_code||subscription.tier_code==="free"){
    return Response.json({error:"An active paid VICEHUB membership is required to preview videos."},{status:403,headers:{"cache-control":"no-store"}});
   }
  }
  try{
   if(asset.storage_provider==="google_drive"&&(asset.preview_drive_file_id||asset.google_drive_file_id)){
    return await streamGoogleDriveMedia(context.getBase44(),asset.preview_drive_file_id||asset.google_drive_file_id,request);
   }
   const objectKey=asset.preview_storage_key||asset.storage_key;
   const connectionId=asset.preview_storage_connection_id||asset.storage_connection_id;
   if(objectKey&&connectionId&&objectKey.startsWith("videos/")&&!objectKey.split("/").includes("..")){
    return await proxyStorageAsset({entities:db,connectionId,objectKey,request});
   }
   return Response.json({error:"This storage provider does not yet support private VICEHUB streaming."},{status:503,headers:{"cache-control":"no-store"}});
  }catch(error){
   return Response.json({error:error?.message||"Video preview failed."},{status:error?.status||502,headers:{"cache-control":"no-store"}});
  }
 }}}
});
