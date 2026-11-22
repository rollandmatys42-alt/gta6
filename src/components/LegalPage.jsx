import {useEffect,useState} from "react";
import {createFileRoute} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {getSitePage} from "@/lib/server-fns";
export default function LegalPage({slug,title}) {
 const [page,setPage]=useState(null),[error,setError]=useState("");
 useEffect(()=>{getSitePage({data:{slug,locale:"en"}}).then(setPage).catch(e=>setError(e.message));},[slug]);
 return <SiteFrame eyebrow={"VICEHUB / LEGAL / "+slug.toUpperCase()}><div className="legal-page"><div className="eyebrow">PLATFORM INFORMATION</div><h1>{page?.title||title}</h1>{error&&<div className="platform-alert">{error}</div>}{page?<div className="legal-content">{page.content}</div>:<div className="platform-empty">This page is being prepared. Please check back later.</div>}</div></SiteFrame>;
}
