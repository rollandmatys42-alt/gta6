import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";

export const Route = createFileRoute("/community")({
  head: () => ({ meta: [{ title: "COMMUNITY — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: ComingSoonPage,
});

function ComingSoonPage() {
  return <SiteFrame eyebrow="VICEHUB / FUTURE RELEASE">
    <section className="platform-hero future-module-hero">
      <div><div className="eyebrow">FUTURE PLATFORM MODULE</div><h1>COMMUNITY<br/><em>COMING LATER.</em></h1><p>The forum and community features are planned for a later opening. We are focusing first on video discovery, downloads, memberships and creator publishing tools.</p><a className="primary-btn" href="/">RETURN TO VIDEO LIBRARY ↗</a></div>
      <div className="hero-stamp">PHASE<br/>TWO</div>
    </section>
  </SiteFrame>;
}
