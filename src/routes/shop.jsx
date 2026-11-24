import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { useAuth } from "@/lib/AuthContext";
import { getShopProducts, getMyShopOrders, createShopCheckoutSession, confirmShopCheckoutSession } from "@/lib/server-fns";
import "@/styles/shop-commerce.css";

export const Route = createFileRoute("/shop")({
  head: () => ({ meta: [
    { title: "VICEHUB Supply — Visit Leonida Field Store" },
    { name: "description", content: "Explore the Leonida field store: independent creator goods, original VICEHUB designs and properly licensed collectibles." },
    { property: "og:title", content: "VICEHUB Supply — Visit Leonida Field Store" },
    { property: "og:description", content: "Independent creator gear, original designs and verified licensed collectibles." }
  ] }),
  component: ShopPage
});

const CATEGORIES = ["All", "Apparel", "Accessories", "Collectibles", "Digital", "Creator Gear", "Other"];
const money = (cents, currency, locale = "en-GB") => new Intl.NumberFormat(locale, { style: "currency", currency: currency || "GBP" }).format((Number(cents) || 0) / 100);

function ShopPage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [products, setProducts] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getShopProducts()
      .then(rows => { if (active) setProducts(Array.isArray(rows) ? rows : []); })
      .catch(error => { if (active) setMessage(error?.message || "The catalogue could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    getMyShopOrders().then(rows => setMyOrders(Array.isArray(rows) ? rows : [])).catch(() => setMyOrders([]));
  }, [isAuthenticated]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("checkout") === "cancelled") {
      setMessage("Checkout was cancelled. Your bag is still here.");
      window.history.replaceState({}, "", "/shop");
      return;
    }
    if (!sessionId) return;
    setBusy(true);
    setMessage("Confirming your payment securely with Stripe…");
    confirmShopCheckoutSession({ data: { sessionId } })
      .then(result => {
        setCart([]);
        getMyShopOrders().then(rows => setMyOrders(Array.isArray(rows) ? rows : [])).catch(() => {});
        setMessage(result.status === "paid_stock_issue"
          ? "Payment received. One item needs a stock check; our team will contact you."
          : "Payment confirmed. Your order has been recorded.");
      })
      .catch(error => setMessage(error?.message || "We could not confirm this payment. Contact support before trying again."))
      .finally(() => {
        setBusy(false);
        window.history.replaceState({}, "", "/shop");
      });
  }, []);

  const visible = useMemo(() => products.filter(product => {
    const matchesCategory = category === "All" || (product.category || "Other") === category;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [product.title, product.description, product.sku, product.category].join(" ").toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  }), [products, category, search]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartCurrency = cart[0]?.product.currency || "GBP";
  const subtotal = cart.reduce((sum, item) => sum + Number(item.product.price_cents || 0) * item.quantity, 0);
  const shipping = cart.reduce((sum, item) => sum + (item.product.product_type === "physical" && item.product.shipping_required ? Number(item.product.shipping_price_cents || 0) * item.quantity : 0), 0);
  const total = subtotal + shipping;

  const addToCart = (product, size = "", color = "") => {
    if (product.product_type === "external") {
      window.open(product.external_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (cart.length && cart[0].product.currency !== product.currency) {
      setMessage("Your bag already contains " + cart[0].product.currency + " products. Complete or clear that bag before adding a different currency.");
      return;
    }
    setCart(current => {
      const key = item => item.product.id === product.id && item.size === size && item.color === color;
      const existing = current.find(key);
      if (existing) return current.map(item => key(item) ? { ...item, quantity: Math.min(10, item.quantity + 1) } : item);
      return [...current, { product, quantity: 1, size, color }];
    });
    setSelected(null);
    setCartOpen(true);
    setMessage("");
  };

  const updateQuantity = (index, delta) => setCart(current => current.map((item, i) => i === index ? { ...item, quantity: Math.max(1, Math.min(10, item.quantity + delta)) } : item));
  const removeItem = index => setCart(current => current.filter((_, i) => i !== index));

  const checkout = async () => {
    if (!cart.length || busy) return;
    if (!isAuthenticated) { navigateToLogin(); return; }
    setBusy(true);
    setMessage("Preparing your secure checkout…");
    try {
      const result = await createShopCheckoutSession({ data: { items: cart.map(item => ({ productId: item.product.id, quantity: item.quantity, size: item.size, color: item.color })) } });
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error?.message || "Checkout could not be started.");
      setBusy(false);
    }
  };

  return <SiteFrame eyebrow="VISIT LEONIDA / FIELD SUPPLY">
    <main className="vh-shop vh-shop-leonida">
      <section className="vh-shop-hero">
        <div className="vh-shop-hero-map" aria-label="Map of Leonida">
          <img src="https://media.base44.com/images/public/6b02e11e6786e710c26cc578/b847d1c5b310ab60bc010c554deeee19_Leonida_Map_Poster.jpg" alt="Visit Leonida map showing Vice City, Vice-Dale County, Leonida and surrounding districts" />
          <div className="vh-shop-map-caption"><span>VISIT LEONIDA</span><b>THE GREAT STATE OF LEONIDA</b><small>FIELD GUIDE / MAP SERIES 001</small></div>
        </div>
        <div className="vh-shop-hero-copy">
          <span className="vh-shop-kicker">VICEHUB SUPPLY · LEONIDA COLLECTION</span>
          <h1>GO BEYOND<br/><em>VICE CITY.</em></h1>
          <p>A field store for the people exploring Leonida. Discover independent creator goods, original VICEHUB designs and properly licensed collectibles.</p>
          <a className="vh-shop-explore" href="#collection">EXPLORE THE COLLECTION <span>↓</span></a>
          <div className="vh-shop-hero-meta"><span>LEONIDA FIELD NOTES</span><i/><span>CURATED CREATOR GOODS</span></div>
        </div>
        <div className="vh-shop-hero-coordinate">27° 58' N&nbsp; / &nbsp;82° 27' W <b>LEONIDA, USA</b></div>
      </section>

      <section className="vh-shop-intro-strip">
        <span>THE LEONIDA EDITION</span><b>FROM THE KEYS TO THE NORTH COAST</b><span>VICEHUB / SUPPLY — EST. 2026</span>
      </section>

      <section className="vh-shop-toolbar" id="collection">
        <div><span className="vh-shop-section-label">THE FIELD STORE / 001</span><h2>THE COLLECTION <small>{products.length.toString().padStart(2, "0")} ITEMS</small></h2></div>
        <div className="vh-shop-controls">
          <label className="vh-shop-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find your next drop" aria-label="Search products"/></label>
          <button className={"vh-shop-bag-trigger" + (cartOpen ? " active" : "")} onClick={() => setCartOpen(v => !v)}>YOUR BAG <b>{String(cartCount).padStart(2, "0")}</b></button>
        </div>
      </section>

      <nav className="vh-shop-categories" aria-label="Product categories">
        {CATEGORIES.map(item => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
      </nav>

      {message && <div className="vh-shop-message" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss">×</button></div>}

      {loading ? <div className="vh-shop-loading"><span/> MAPPING THE COLLECTION…</div> :
        visible.length ? <div className="vh-shop-grid">
          {visible.map((product,index) => {
            const external=product.product_type==="external";
            const outOfStock=product.product_type==="physical"&&Number(product.stock_quantity||0)<1;
            return <article className={"vh-shop-product"+(product.is_featured?" featured":"")} key={product.id}>
              <button className="vh-shop-product-image" onClick={()=>{setSelected(product);setSelectedSize(product.size_options?.[0]||"");setSelectedColor(product.color_options?.[0]||"");}} aria-label={"View "+product.title}>
                {product.image_url?<img src={product.image_url} alt={product.title} loading={index>3?"lazy":"eager"}/>:<span className="vh-shop-placeholder"><b>LEONIDA</b><small>{product.category||"FIELD SUPPLY"}</small></span>}
                {product.is_featured&&<span className="vh-shop-featured">FIELD PICK</span>}
                {external&&<span className="vh-shop-external">OFFICIAL RETAILER</span>}
                {outOfStock&&<span className="vh-shop-soldout">OUT OF STOCK</span>}
              </button>
              <div className="vh-shop-product-copy">
                <div className="vh-shop-product-meta"><span>{product.category||"VICEHUB"}</span><span>{product.sku||"LEONIDA / 001"}</span></div>
                <h3>{product.title}</h3><p>{product.description}</p>
                <div className="vh-shop-product-bottom"><strong>{money(product.price_cents,product.currency)}</strong><button disabled={outOfStock} onClick={()=>{setSelected(product);setSelectedSize(product.size_options?.[0]||"");setSelectedColor(product.color_options?.[0]||"");}}>{external?"VIEW OFFICIAL STORE ↗":outOfStock?"OUT OF STOCK":"QUICK VIEW +"}</button></div>
              </div>
            </article>;
          })}
        </div> : <div className="vh-shop-empty">
          <div className="vh-shop-empty-map"><img src="https://media.base44.com/images/public/6b02e11e6786e710c26cc578/b847d1c5b310ab60bc010c554deeee19_Leonida_Map_Poster.jpg" alt="Leonida map detail"/></div>
          <div className="vh-shop-empty-copy"><span>LEONIDA / DROP 001</span><h3>{products.length?"NOTHING AT THIS COORDINATE.":"THE FIRST DROP IS BEING PREPARED."}</h3><p>{products.length?"Try another category or search term.":"Our team is preparing the first VICEHUB collection. Only real products with verified ownership or licensing will appear here."}</p><b>CHECK BACK SOON <i>✳</i></b></div>
        </div>}

      {isAuthenticated&&myOrders.length>0&&<section className="vh-shop-orders"><div className="vh-shop-orders-head"><div><span className="vh-shop-section-label">ACCOUNT / PURCHASE HISTORY</span><h2>MY ORDERS</h2></div><small>{myOrders.length} RECENT ORDERS</small></div>{myOrders.map(order=><article className="vh-shop-order-row" key={order.id}><div><b>ORDER / {order.id.slice(-8).toUpperCase()}</b><small>{(order.items||[]).map(item=>item.quantity+" × "+item.title).join(" · ")}</small></div><span className={"vh-shop-order-status "+order.status}>{order.status.replaceAll("_"," ")}</span><strong>{money(order.total_cents,order.currency)}</strong>{order.tracking_url&&<a href={order.tracking_url} target="_blank" rel="noreferrer">TRACK ↗</a>}</article>)}</section>}

      <section className="vh-shop-trust">
        <div><b>01 / CREATOR-MADE</b><p>Independent goods and original designs from the VICEHUB community.</p></div>
        <div><b>02 / RIGHTS REVIEWED</b><p>Original work and licensed products are reviewed before publication.</p></div>
        <div><b>03 / SECURE CHECKOUT</b><p>Payments, delivery details and order updates are handled securely.</p></div>
      </section>

      {selected&&<div className="vh-shop-modal-backdrop" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
        <section className="vh-shop-modal" role="dialog" aria-modal="true" aria-label={selected.title}>
          <button className="vh-shop-modal-close" onClick={()=>setSelected(null)} aria-label="Close">×</button>
          <div className="vh-shop-modal-image">{selected.image_url?<img src={selected.image_url} alt={selected.title}/>:<span className="vh-shop-placeholder"><b>LEONIDA</b></span>}</div>
          <div className="vh-shop-modal-copy"><span className="vh-shop-section-label">{selected.category||"VICEHUB SUPPLY"} / {selected.sku||"DROP 001"}</span><h2>{selected.title}</h2><p>{selected.description}</p><strong className="vh-shop-modal-price">{money(selected.price_cents,selected.currency)}</strong>
            {selected.product_type==="external"?<a className="vh-shop-checkout" href={selected.external_url} target="_blank" rel="noreferrer">SHOP OFFICIAL RETAILER ↗</a>:<>
              {!!selected.size_options?.length&&<label className="vh-shop-option">SIZE<select value={selectedSize} onChange={e=>setSelectedSize(e.target.value)}>{selected.size_options.map(v=><option key={v}>{v}</option>)}</select></label>}
              {!!selected.color_options?.length&&<label className="vh-shop-option">COLOUR<select value={selectedColor} onChange={e=>setSelectedColor(e.target.value)}>{selected.color_options.map(v=><option key={v}>{v}</option>)}</select></label>}
              {selected.product_type==="physical"&&selected.shipping_required&&<small className="vh-shop-shipping-note">Shipping: {money(selected.shipping_price_cents,selected.currency)} per item</small>}
              <button className="vh-shop-checkout" onClick={()=>addToCart(selected,selectedSize,selectedColor)}>ADD TO BAG ↗</button>
            </>}
            <small className="vh-shop-rights-note">{selected.rights_status==="licensed"?"Licensed third-party product":selected.rights_status==="official_external"?"Official retailer link — checkout takes place on the retailer's website":"VICEHUB original product"}. VICEHUB is an independent platform and is not affiliated with Rockstar Games.</small>
          </div>
        </section>
      </div>}

      {cartOpen&&<div className="vh-shop-cart-backdrop" onClick={e=>{if(e.target===e.currentTarget)setCartOpen(false);}}>
        <aside className="vh-shop-cart" aria-label="Shopping bag">
          <div className="vh-shop-cart-head"><div><span className="vh-shop-section-label">VICEHUB / FIELD SUPPLY</span><h2>YOUR BAG <small>{cartCount} ITEMS</small></h2></div><button onClick={()=>setCartOpen(false)} aria-label="Close bag">×</button></div>
          <div className="vh-shop-cart-items">{!cart.length?<p className="vh-shop-cart-empty">Your bag is empty. Find your next drop.</p>:cart.map((item,index)=><div className="vh-shop-cart-item" key={item.product.id+item.size+item.color}>
            <div className="vh-shop-cart-thumb">{item.product.image_url?<img src={item.product.image_url} alt=""/>:<b>LH</b>}</div>
            <div className="vh-shop-cart-item-copy"><b>{item.product.title}</b><small>{[item.size,item.color].filter(Boolean).join(" · ")||item.product.sku}</small><strong>{money(item.product.price_cents,item.product.currency)}</strong><div className="vh-shop-quantity"><button onClick={()=>updateQuantity(index,-1)} aria-label="Decrease quantity">−</button><span>{item.quantity}</span><button onClick={()=>updateQuantity(index,1)} aria-label="Increase quantity">+</button><button className="remove" onClick={()=>removeItem(index)}>REMOVE</button></div></div>
          </div>)}</div>
          {!!cart.length&&<div className="vh-shop-cart-footer"><div><span>SUBTOTAL</span><b>{money(subtotal,cartCurrency)}</b></div>{shipping>0&&<div><span>ESTIMATED SHIPPING</span><b>{money(shipping,cartCurrency)}</b></div>}<div className="total"><span>TOTAL BEFORE ANY APPLICABLE TAX</span><b>{money(total,cartCurrency)}</b></div><p>Final delivery details and any applicable taxes are shown in the secure payment flow.</p><button className="vh-shop-checkout" disabled={busy} onClick={checkout}>{busy?"PLEASE WAIT…":"SECURE CHECKOUT ↗"}</button><button className="vh-shop-clear" onClick={()=>setCart([])}>CLEAR BAG</button></div>}
        </aside>
      </div>}
    </main>
  </SiteFrame>;
}
