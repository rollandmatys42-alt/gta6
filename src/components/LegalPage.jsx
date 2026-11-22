import {useEffect,useState} from "react";
import {createFileRoute} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {getSitePage} from "@/lib/server-fns";
import {useLocale,translate} from "@/lib/i18n";
export default function LegalPage({slug,title}) {
 const [page,setPage]=useState(null),[error,setError]=useState("");
 useEffect(()=>{getSitePage({data:{slug,locale}}).then(setPage).catch(e=>setError(e.message));},[slug,locale]);
 return <SiteFrame eyebrow={"VICEHUB / LEGAL / "+slug.toUpperCase()}><div className="legal-page"><div className="eyebrow">{tx("legal.platform")}</div><h1>{page?.title||tx("legal."+slug)||title}</h1>{error&&<div className="platform-alert">{error}</div>}{page?<div className="legal-content">{page.content}</div>:<div className="platform-empty">{tx("legal.preparing")}</div>}</div></SiteFrame>;
}
