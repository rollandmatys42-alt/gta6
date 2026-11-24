import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";
import { runScheduledGrowthAgents } from "@/lib/server-fns";

const safeEqual=(a,b)=>{if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};

export const Route=createFileRoute("/api/agents/growth/cron")({
  server:{handlers:{POST:async({request,context})=>{
    const expected=secrets.get("GTA_NEWS_SYNC_CRON_SECRET")||"";
    const header=request.headers.get("authorization")||"";
    const supplied=header.startsWith("Bearer ")?header.slice(7):"";
    if(expected.length<32||!safeEqual(expected,supplied))return Response.json({error:"Unauthorized"},{status:401});
    try{
      const result=await runScheduledGrowthAgents({data:{cronSecret:expected}});
      const settings=context.getBase44().asServiceRole.entities.SiteSetting;
      const key="github_growth_cron_last_seen",now=new Date().toISOString();
      const rows=await settings.filter({setting_key:key},"-updated_date",1,0);
      if(rows[0])await settings.update(rows[0].id,{setting_value:now,is_public:false,updated_by:"system"});
      else await settings.create({setting_key:key,setting_value:now,is_public:false,updated_by:"system"});
      return Response.json(result);
    }catch(error){
      return Response.json({error:error instanceof Error?error.message:"Growth agent scheduler failed."},{status:500});
    }
  }}},
  component:()=>null,
});
