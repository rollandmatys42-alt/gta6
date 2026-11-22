import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";

export const Route = createFileRoute("/marketplace")({
  head: () => ({ meta: [{ title: "MARKETPLACE — VICEHUB" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: ComingSoonPage,
});

function ComingSoonPage() {
  return <SiteFrame eyebrow="VICEHUB / FUTURE RELEASE">
    <section className="platform-hero future-module-hero">
      <div><div className="eyebrow">FUTURE PLATFORM MODULE</div><h1>MARKETPLACE<br/><em>COMING LATER.</em></h1><p>The creator marketplace is planned for a later opening, once the VICEHUB creator network has reached critical mass. The video library, downloads, memberships and social publishing remain the priority.</p><a className="primary-btn" href="/">RETURN TO VIDEO LIBRARY ↗</a></div>
      <div className="hero-stamp">PHASE<br/>TWO</div>
    </section>
  </SiteFrame>;
}
