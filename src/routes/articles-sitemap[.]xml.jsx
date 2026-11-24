import { createFileRoute } from "@tanstack/react-router";

const xml=value=>String(value||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");

export const Route=createFileRoute("/articles-sitemap.xml")({
  server:{handlers:{GET:async({context})=>{
    try{
      const rows=await context.getBase44().asServiceRole.entities.NewsArticle.filter({status:"published"},"-published_at",1000,0,["slug","published_at"]);
      const entries=rows.filter(row=>row.slug).map(row=>{
        const lastmod=row.published_at&&Number.isFinite(new Date(row.published_at).getTime())?"<lastmod>"+new Date(row.published_at).toISOString()+"</lastmod>":"";
        return "<url><loc>https://gta6-creator-hub-c26cc578.base44.app/news/"+xml(row.slug)+"</loc>"+lastmod+"</url>";
      }).join("");
      return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+entries+"</urlset>",{headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public, max-age=300"}});
    }catch{
      return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',{headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public, max-age=60"}});
    }
  }}},
  component:()=>null,
});
