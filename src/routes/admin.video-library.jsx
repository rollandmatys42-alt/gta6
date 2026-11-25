import {createFileRoute,Link} from "@tanstack/react-router";
export const Route=createFileRoute("/admin/video-library-legacy")({ssr:false,head:()=>({meta:[{title:"Legacy video library — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:LegacyVideoLibraryRedirect});
function LegacyVideoLibraryRedirect(){return <main style={{padding:40}}><h1>Legacy video library</h1><p>The VICEHUB internal clip library has moved.</p><Link to="/admin/video-library">Open the new VICEHUB clip library →</Link></main>}
