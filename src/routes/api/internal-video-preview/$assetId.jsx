import {createFileRoute} from "@tanstack/react-router";
import {requireUserRoute} from "@/lib/auth-middleware";
import {streamGoogleDriveMedia} from "@/lib/google-drive-api";
export const Route=createFileRoute("/api/internal-video-preview/$assetId")({
 server:{middleware:[requireUserRoute],handlers:{GET:async({params,request,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const asset=await db.InternalVideoAsset.get(params.assetId).catch(()=>null);
  if(!asset||asset.asset_type!=="clip"||asset.status!=="ready"||asset.review_status!=="approved"||asset.public_video_status!=="published"||!["authorised","not_applicable"].includes(asset.rights_status)||!asset.google_drive_file_id)return Response.json({error:"Clip preview unavailable."},{status:404,headers:{"cache-control":"no-store"}});
  try{return await streamGoogleDriveMedia(context.getBase44(),asset.google_drive_file_id,request);}
  catch(error){return Response.json({error:error?.message||"Clip preview failed."},{status:error?.status||502,headers:{"cache-control":"no-store"}});}
 }}}
});
