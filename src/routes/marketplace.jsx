import { useEffect,useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMarketplaceListings,createMarketplaceInquiry,createContentReport } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";
export const Route=createFileRoute("/marketplace")({head:()=>({meta:[{title:"Creator Marketplace — VICEHUB"}]}),component:MarketplacePage});
function MarketplacePage(){
 const {isAuthenticated,navigateToLogin}=useAuth();const [items,setItems]=useState([]),[selected,setSelected]=useState(null),[message,setMessage]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState("");
 useEffect(()=>{getMarketplaceListings({data:{}}).then(setItems).catch(e=>setError(e.message));},[]);
 const inquiry=async e=>{e.preventDefault();if(!isAuthenticated){navigateToLogin();return;}try{await createMarketplaceInquiry({data:{listingId:selected.id,message}});setNotice("Your enquiry has been sent to the creator. Payment is not processed on VICEHUB yet.");setMessage("");setSelected(null);}catch(e){setError(e.message);}};
 const money=x=>new Intl.NumberFormat("en-US",{style:"currency",currency:x.currency||"USD"}).format((x.price_cents||0)/100);
 return <SiteFrame eyebrow="VICEHUB / CREATOR MARKETPLACE">
  <div className="platform-hero"><div><div className="eyebrow">MADE BY THE COMMUNITY</div><h1>CREATOR<br/><em>TO CREATOR.</em></h1><p>Discover editing packs, creator bundles, presets and original GTA VI content from independent creators.</p></div><div className="hero-stamp">SELL<br/>YOUR<br/>WORK</div></div>
  {notice&&<div className="platform-success">{notice}</div>}{error&&<div className="platform-alert">{error}</div>}
  {selected&&<form className="platform-form" onSubmit={inquiry}><button type="button" className="text-btn" onClick={()=>setSelected(null)}>← BACK TO MARKETPLACE</button><h2>CONTACT THE CREATOR</h2><p>{selected.title} · {money(selected)}</p><textarea required minLength={5} maxLength={2000} rows={4} placeholder="Ask the creator about this item…" value={message} onChange={e=>setMessage(e.target.value)}/><div className="form-actions"><button className="primary-btn">SEND ENQUIRY</button></div></form>}
  <div className="market-grid">{items.map(x=><article className="market-card" key={x.id}><div className="market-art"><span>{x.category}</span><b>V</b></div><div className="market-card-content"><div className="eyebrow">{x.seller_name}</div><h2>{x.title}</h2><p>{x.description}</p><div className="market-price">{money(x)}</div><div className="market-actions"><button className="outline-btn" onClick={()=>setSelected(x)}>CONTACT CREATOR ↗</button><button className="text-btn" onClick={async()=>{try{await createContentReport({data:{targetType:"listing",targetId:x.id,reason:"other",details:"User-submitted marketplace report."}});setNotice("Listing sent to moderation.");}catch(e){setError(e.message);}}}>REPORT</button></div></div></article>)}</div>
  {!items.length&&<div className="platform-empty">The marketplace is being prepared. Approved creator listings will appear here.</div>}
  <div className="platform-note">Creator listings are moderated. Purchases and seller payouts are not enabled until the payment provider is connected. Contacting a seller does not create an order.</div>
 </SiteFrame>;
}
