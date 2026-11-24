import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getNewsArticleBySlug } from "@/lib/server-fns";
import "@/styles/newsroom.css";

export const Route = createFileRoute("/news/$slug")({
  loader: ({ params }) => getNewsArticleBySlug({ data: { slug: params.slug } }),
  head: ({ loaderData }) => {
    const article = loaderData;
    const title = article?.title ? article.title + " — VICEHUB" : "GTA VI News — VICEHUB";
    const description = article?.summary || "Sourced GTA VI reporting from the VICEHUB newsroom.";
    const canonical = "https://gta6-creator-hub-c26cc578.base44.app/news/" + (article?.slug || "");
    return {
      meta: [
        { title }, { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(article?.image_url ? [{ property: "og:image", content: article.image_url }] : []),
        { property: "og:url", content: canonical },
        { name: "twitter:card", content: article?.image_url ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: NewsArticlePage,
});

function NewsArticlePage() {
  const article = Route.useLoaderData();
  const paragraphs = String(article.body || "").split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  const label = ({official:"OFFICIAL",confirmed:"CONFIRMED",reported:"REPORTED",rumour:"RUMOUR",theory:"THEORY",opinion:"OPINION"})[article.confidence] || "NEWS";
  return <SiteFrame eyebrow="VICEHUB / THE LEONIDA DISPATCH">
    <article className="nr-article-page">
      <div className="nr-article-page-kicker">{article.source_type?.toUpperCase() || "EDITORIAL"} / {label}</div>
      <h1>{article.title}</h1>
      <p className="nr-article-page-summary">{article.summary}</p>
      <div className="nr-article-page-meta"><span>{article.source_name}</span><time dateTime={article.published_at}>{article.published_at ? new Date(article.published_at).toLocaleString("en-GB",{dateStyle:"long",timeStyle:"short",timeZone:"UTC"})+" UTC" : "VICEHUB NEWS DESK"}</time></div>
      <figure className="nr-article-page-cover"><img src={article.image_url || "/vicehub-news-placeholder.svg"} alt={article.image_alt || article.title}/>{article.image_url && <figcaption>{article.image_alt || article.title}</figcaption>}</figure>
      <div className="nr-article-page-body">{paragraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
      <aside className="nr-article-page-source"><small>ORIGINAL SOURCE / PRIMARY REFERENCE</small><b>{article.source_name}</b><a href={article.source_url} target="_blank" rel="noopener noreferrer">Read the original source ↗</a></aside>
      <p className="nr-article-page-disclaimer">VICEHUB is an independent fan publication and is not affiliated with Rockstar Games or Take-Two Interactive. Reporting is labelled by source and confidence; rumours are not presented as confirmed facts.</p>
      <a className="nr-back" href="/news">← BACK TO THE NEWSROOM</a>
    </article>
  </SiteFrame>;
}
