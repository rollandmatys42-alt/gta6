import {createFileRoute} from "@tanstack/react-router";
import {requireUserRoute} from "@/lib/auth-middleware";
import {streamGoogleDriveMedia} from "@/lib/google-drive-api";
export const Route=createFileRoute("/api/internal-video-download/$assetId")({
 server:{middleware:[requireUserRoute],handlers:{GET:async({params,request,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const asset=await db.InternalVideoAsset.get(params.assetId).catch(()=>null);
  if(!asset||asset.asset_type!=="clip"||asset.status!=="ready"||asset.review_status!=="approved"||asset.public_video_status!=="published"||!["authorised","not_applicable"].includes(asset.rights_status)||!asset.google_drive_file_id)return Response.json({error:"Clip download unavailable."},{status:404,headers:{"cache-control":"no-store"}});
  const events=await db.DownloadEvent.filter({user_id:context.user.id,video_id:asset.id,status:"signed"},"-created_date",10,0);
  const event=events.find(item=>item.delivery_expires_at&&new Date(item.delivery_expires_at).getTime()>Date.now());
  if(!event)return Response.json({error:"Download authorisation expired or unavailable."},{status:403,headers:{"cache-control":"no-store"}});
  const consumed=await db.DownloadEvent.updateMany({id:event.id,status:"signed"},{$set:{status:"delivered"}});
  if(!consumed?.updated)return Response.json({error:"Download authorisation has already been used."},{status:403,headers:{"cache-control":"no-store"}});
  try{return await streamGoogleDriveMedia(context.getBase44(),asset.google_drive_file_id,request);}
  catch(error){await db.DownloadEvent.update(event.id,{status:"failed"}).catch(()=>null);return Response.json({error:error?.message||"Clip download failed."},{status:error?.status||502,headers:{"cache-control":"no-store"}});}
 }}}
});
