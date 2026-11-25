import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

function requireAdmin(context) {
  if (context.user?.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
}
function db(context) { return context.getBase44().asServiceRole.entities; }
async function audit(context, action, targetType, targetId, summary, metadata = {}) {
  await db(context).AdminAuditLog.create({
    actor_user_id: context.user.id,
    actor_email: context.user.email || "",
    action, target_type: targetType, target_id: targetId || "",
    summary: String(summary || "").slice(0, 1000),
    metadata_json: JSON.stringify(metadata).slice(0, 5000),
  }).catch(() => null);
}

export const getAdminOperationsData = createServerFn({ method: "GET" }).middleware([requireUser]).handler(async ({ context }) => {
  requireAdmin(context);
  const entities = db(context);
  const [settings, tickets, privacyRequests, auditLogs, staffRoles, pages, articles, notifications] = await Promise.all([
    entities.SiteSetting.list("-updated_date", 200, 0),
    entities.SupportTicket.list("-created_date", 200, 0),
    entities.PrivacyRequest.list("-created_date", 200, 0),
    entities.AdminAuditLog.list("-created_date", 250, 0),
    entities.StaffRole.list("-created_date", 100, 0),
    entities.SitePage.list("-updated_date", 200, 0),
    entities.NewsArticle.list("-updated_date", 200, 0),\n    entities.UserNotification.list("-created_date", 250, 0),
  ]);
  return {
    settings, tickets, privacyRequests, auditLogs, staffRoles,
    seo: {
      pages: pages.map(p => ({ id:p.id,title:p.title,slug:p.slug,locale:p.locale,status:p.status,meta_title:p.meta_title||"",meta_description:p.meta_description||"" })),
      articles: articles.map(a => ({ id:a.id,title:a.title,slug:a.slug,locale:a.locale,status:a.status,meta_title:a.meta_title||"",meta_description:a.meta_description||"" })),
    },
  };
});

export const saveAdminSiteSetting = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ id:z.string().optional(), settingKey:z.string().min(2).max(120).regex(/^[a-z0-9_.-]+$/), settingValue:z.string().max(10000), isPublic:z.boolean().default(false) }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const entities = db(context);
    const safePublicKeys = new Set(["site_name","support_email","default_locale","maintenance_notice"]);
    const isPublic = safePublicKeys.has(data.settingKey) ? data.isPublic : false;
    let row;
    if (data.id) {
      row = await entities.SiteSetting.update(data.id,{ setting_key:data.settingKey,setting_value:data.settingValue,is_public:isPublic,updated_by:context.user.id });
    } else {
      const existing = await entities.SiteSetting.filter({setting_key:data.settingKey},"-updated_date",1,0);
      row = existing[0]
        ? await entities.SiteSetting.update(existing[0].id,{setting_value:data.settingValue,is_public:isPublic,updated_by:context.user.id})
        : await entities.SiteSetting.create({setting_key:data.settingKey,setting_value:data.settingValue,is_public:isPublic,updated_by:context.user.id});
    }
    await audit(context,"setting.updated","SiteSetting",row.id,"Updated site setting: "+data.settingKey);
    return row;
  });

export const updateAdminSupportTicket = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ id:z.string().min(1),status:z.enum(["open","in_progress","waiting_customer","resolved","closed"]),priority:z.enum(["low","normal","high","urgent"]),assignedTo:z.string().max(180).optional(),internalNote:z.string().max(5000).optional() }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const entities=db(context), before=await entities.SupportTicket.get(data.id);
    const row=await entities.SupportTicket.update(data.id,{status:data.status,priority:data.priority,assigned_to:data.assignedTo||"",internal_note:data.internalNote||""});
    await audit(context,"support.ticket.updated","SupportTicket",data.id,"Updated support ticket "+(before.subject||data.id),{status:data.status,priority:data.priority});
    return row;
  });

export const updateAdminPrivacyRequest = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ id:z.string().min(1),status:z.enum(["received","identity_check","in_progress","completed","rejected"]),identityVerified:z.boolean(),internalNote:z.string().max(5000).optional() }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const entities=db(context);
    const row=await entities.PrivacyRequest.update(data.id,{status:data.status,identity_verified:data.identityVerified,internal_note:data.internalNote||"",...(data.status==="completed"?{completed_at:new Date().toISOString()}:{})});
    await audit(context,"privacy.request.updated","PrivacyRequest",data.id,"Updated privacy request",{status:data.status,identityVerified:data.identityVerified});
    return row;
  });
