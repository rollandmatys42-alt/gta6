import { useEffect,useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getShopProducts } from "@/lib/server-fns";
import {useLocale,translate} from "@/lib/i18n";
export const Route=createFileRoute("/shop")({head:()=>({meta:[{title:"VICEHUB Shop"},{name:"description",content:"Browse VICEHUB creator tools, digital products and platform merchandise."},{property:"og:title",content:"VICEHUB Shop"},{property:"og:description",content:"Browse VICEHUB creator tools, digital products and platform merchandise."}]}),component:ShopPage});
function ShopPage(){
 const [items,setItems]=useState([]),[cart,setCart]=useState([]),[error,setError]=useState("");
 useEffect(()=>{getShopProducts().then(setItems).catch(e=>setError(e.message));},[]);
 const money=x=>new Intl.NumberFormat("en-US",{style:"currency",currency:x.currency||"USD"}).format((x.price_cents||0)/100);
 return <SiteFrame eyebrow="VICEHUB / OFFICIAL CREATOR SHOP">
  <div className="platform-hero"><div><div className="eyebrow">{tx("shop.kicker")}</div><h1>{tx("shop.title")}</h1><p>{tx("shop.desc")}</p></div><div className="cart-count">{tx("shop.bag")} <b>{cart.length.toString().padStart(2,"0")}</b></div></div>
  {error&&<div className="platform-alert">{error}</div>}
  <div className="shop-grid">{items.map(p=><article className="shop-card" key={p.id}><div className="shop-art">{p.image_url?<img src={p.image_url} alt={p.title}/>:<span>VICE<br/>SUPPLY</span>}</div><div className="shop-info"><div className="eyebrow">{p.product_type} / {p.sku||"LIMITED DROP"}</div><h2>{p.title}</h2><p>{p.description}</p><div className="shop-buy"><b>{money(p)}</b><button className="outline-btn" onClick={()=>setCart(c=>[...c,p])}>{tx("shop.add")} +</button></div></div></article>)}</div>
  {!items.length&&<div className="platform-empty">{tx("shop.empty")}</div>}
  {cart.length>0&&<div className="cart-panel"><div><b>{cart.length} item(s) in your bag</b><small>{tx("shop.checkout")}</small></div><button className="outline-btn" onClick={()=>setCart([])}>CLEAR BAG</button></div>}
 </SiteFrame>;
}
