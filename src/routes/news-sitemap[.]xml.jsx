import { createFileRoute } from "@tanstack/react-router";

const xml = value => String(value || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");

export const Route = createFileRoute("/news-sitemap.xml")({
  server: { handlers: { GET: async ({ context }) => {
    try {
      const rows = await context.getBase44().asServiceRole.entities.NewsArticle.filter({status:"published"},"-published_at",1000,0);
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      const recent = rows.filter(row => row.published_at && new Date(row.published_at).getTime() >= cutoff);
      const entries = recent.map(row => `<url><loc>https://gta6-creator-hub-c26cc578.base44.app/news/${xml(row.slug)}</loc><news:news><news:publication><news:name>VICEHUB</news:name><news:language>${xml(row.locale || "en")}</news:language></news:publication><news:publication_date>${new Date(row.published_at).toISOString()}</news:publication_date><news:title>${xml(row.title)}</news:title></news:news></url>`).join("");
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${entries}</urlset>`,{headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public, max-age=300"}});
    } catch {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"></urlset>',{headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public, max-age=60"}});
    }
  }}},
  component: () => null,
});
