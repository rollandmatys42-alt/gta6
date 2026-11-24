import { createClientFromRequest } from "npm:@base44/sdk";
import webpush from "npm:web-push@3.6.7";

const safeEqual=(a:string,b:string)=>{if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};

Deno.serve(async req=>{
  try{
    const input=await req.json();
    const expected=Deno.env.get("PUSH_DISPATCH_SECRET")||"";
    if(expected.length<32||!safeEqual(expected,String(input?.dispatchSecret||"")))return Response.json({error:"Unauthorized"},{status:401});
    const publicKey=Deno.env.get("VAPID_PUBLIC_KEY")||"",privateKey=Deno.env.get("VAPID_PRIVATE_KEY")||"",subject=Deno.env.get("VAPID_SUBJECT")||"";
    if(!publicKey||!privateKey||!subject)return Response.json({error:"VAPID is not configured"},{status:503});
    const userIds=Array.isArray(input.userIds)?input.userIds.filter((id:string)=>typeof id==="string").slice(0,100):[];
    if(!userIds.length)return Response.json({sent:0,removed:0});
    const base44=createClientFromRequest(req),db=base44.asServiceRole.entities;
    const subscriptions=await db.PushSubscription.filter({user_id:{$in:userIds}},"-created_date",500,0);
    webpush.setVapidDetails(subject,publicKey,privateKey);
    const payload=JSON.stringify({title:String(input.title||"VICEHUB update").slice(0,120),body:String(input.body||"A new GTA VI update is available.").slice(0,240),url:String(input.url||"/notifications").slice(0,300),tag:"vicehub-content"});
    let sent=0,removed=0,failed=0;
    for(const row of subscriptions){
      try{
        await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth},expirationTime:row.expiration_time||null},payload,{TTL:3600});
        sent++;
        await db.PushSubscription.update(row.id,{last_success_at:new Date().toISOString(),last_error:""}).catch(()=>null);
      }catch(error){
        const status=Number((error as any)?.statusCode||0);
        if(status===404||status===410){await db.PushSubscription.delete(row.id).catch(()=>null);removed++;}
        else{failed++;await db.PushSubscription.update(row.id,{last_error:String((error as any)?.message||error).slice(0,280)}).catch(()=>null);}
      }
    }
    return Response.json({sent,removed,failed,subscriptions:subscriptions.length});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:String(error)},{status:500});
  }
});
