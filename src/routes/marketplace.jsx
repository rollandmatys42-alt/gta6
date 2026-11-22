import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import { getMarketplaceListings, createMarketplaceInquiry, createContentReport, getMyListings, saveMarketplaceListing, getMyMarketplaceInquiries, replyMarketplaceInquiry } from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/marketplace")({
  head: () => ({ meta: [
    { title: "Creator Marketplace — VICEHUB" },
    { name: "description", content: "Discover creator-made GTA VI editing packs and contact independent sellers on VICEHUB." },
    { property: "og:title", content: "Creator Marketplace — VICEHUB" },
    { property: "og:description", content: "Discover creator-made GTA VI editing packs and contact independent sellers on VICEHUB." },
  ]}),
  component: MarketplacePage,
});

const CATEGORIES = ["All categories", "Video pack", "Editing preset", "Template", "Creator bundle", "Other"];
const EMPTY_LISTING = { title: "", description: "", category: "Video pack", price: "0", currency: "USD", licenseTerms: "", previewUrl: "" };
const money = item => new Intl.NumberFormat("en-US", { style: "currency", currency: item.currency || "USD" }).format((Number(item.price_cents) || 0) / 100);

function MarketplacePage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [items, setItems] = useState([]), [myItems, setMyItems] = useState([]);
  const [inquiries, setInquiries] = useState({ buyer: [], seller: [] });
  const [selected, setSelected] = useState(null), [message, setMessage] = useState("");
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [showSeller, setShowSeller] = useState(false), [editingId, setEditingId] = useState(null);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [query, setQuery] = useState(""), [category, setCategory] = useState("All categories");
  const [currency, setCurrency] = useState("All"), [sort, setSort] = useState("newest"), [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(EMPTY_LISTING);

  const load = async () => {
    setError("");
    const [publicRows, ownRows, inquiryRows] = await Promise.allSettled([
      getMarketplaceListings({ data: category === "All categories" ? {} : { category } }),
      isAuthenticated ? getMyListings() : Promise.resolve([]),
      isAuthenticated ? getMyMarketplaceInquiries() : Promise.resolve({ buyer: [], seller: [] }),
    ]);
    if (publicRows.status === "fulfilled") setItems(publicRows.value || []);
    else setError(publicRows.reason?.message || "Could not load marketplace listings.");
    setMyItems(ownRows.status === "fulfilled" ? ownRows.value || [] : []);
    setInquiries(inquiryRows.status === "fulfilled" ? inquiryRows.value : { buyer: [], seller: [] });
  };

  useEffect(() => { load(); }, [isAuthenticated, category]);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = items.filter(item => {
      const textMatch = !needle || [item.title,item.description,item.seller_name,item.category].some(v => String(v || "").toLowerCase().includes(needle));
      return textMatch && (currency === "All" || item.currency === currency);
    });
    return rows.sort((a,b) => {
      if (sort === "price-low") return String(a.currency).localeCompare(String(b.currency)) || (a.price_cents || 0) - (b.price_cents || 0);
      if (sort === "price-high") return String(a.currency).localeCompare(String(b.currency)) || (b.price_cents || 0) - (a.price_cents || 0);
      return new Date(b.created_date || 0) - new Date(a.created_date || 0);
    });
  }, [items, query, currency, sort]);

  const resetForm = () => { setEditingId(null); setListing(EMPTY_LISTING); setShowSeller(false); };
  const editListing = item => {
    setEditingId(item.id);
    setListing({ title: item.title || "", description: item.description || "", category: item.category || "Other",
      price: ((Number(item.price_cents) || 0) / 100).toFixed(2), currency: item.currency || "USD",
      licenseTerms: item.license_terms || "", previewUrl: item.preview_url || "" });
    setShowSeller(true); setSelected(null); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitListing = async event => {
    event.preventDefault();
    if (!isAuthenticated) { navigateToLogin(); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await saveMarketplaceListing({ data: {
        ...(editingId ? { id: editingId } : {}), title: listing.title.trim(), description: listing.description.trim(),
        category: listing.category, priceCents: Math.round(Number(listing.price) * 100), currency: listing.currency,
        licenseTerms: listing.licenseTerms.trim(), ...(listing.previewUrl ? { previewUrl: listing.previewUrl } : {}),
      }});
      setNotice(saved.status === "pending_review" ? "Listing submitted for moderation." : "Listing saved as a draft. Premium membership is required for publication.");
      resetForm(); await load();
    } catch (err) { setError(err?.message || "Could not save this listing."); }
    finally { setBusy(false); }
  };

  const sendInquiry = async event => {
    event.preventDefault();
    if (!isAuthenticated) { navigateToLogin(); return; }
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await createMarketplaceInquiry({ data: { listingId: selected.id, message: message.trim() } });
      setNotice("Your enquiry has been sent to the creator. VICEHUB does not process payment or create an order.");
      setMessage(""); setSelected(null); await load();
    } catch (err) { setError(err?.message || "Could not send your enquiry."); }
    finally { setBusy(false); }
  };

  const report = async item => {
    if (!isAuthenticated) { navigateToLogin(); return; }
    try {
      await createContentReport({ data: { targetType: "listing", targetId: item.id, reason: "other", details: "User-submitted marketplace report." } });
      setNotice("Listing sent to the moderation queue.");
    } catch (err) { setError(err?.message || "Could not report this listing."); }
  };

  const reply = async (event, inquiry) => {
    event.preventDefault();
    const text = (replyDrafts[inquiry.id] || "").trim();
    if (!text) return;
    try {
      await replyMarketplaceInquiry({ data: { inquiryId: inquiry.id, reply: text } });
      setNotice("Reply sent to the buyer.");
      setReplyDrafts(current => ({ ...current, [inquiry.id]: "" }));
      await load();
    } catch (err) { setError(err?.message || "Could not send this reply."); }
  };

  return <SiteFrame eyebrow="VICEHUB / CREATOR MARKETPLACE">
    <section className="platform-hero"><div><div className="eyebrow">MADE BY THE COMMUNITY</div><h1>CREATOR<br/><em>TO CREATOR.</em></h1><p>Discover editing packs, creator bundles, presets and original GTA VI content from independent creators.</p></div><div className="hero-stamp">SELL<br/>YOUR<br/>WORK</div></section>
    <section className="marketplace-intro-bar"><div><b>THE CREATOR EXCHANGE</b><p>Discover community-made assets, contact sellers and manage your own listings.</p></div>
      <button className="primary-btn" onClick={() => isAuthenticated ? setShowSeller(v => !v) : navigateToLogin()}>{showSeller ? "CLOSE SELLER DESK" : "OPEN SELLER DESK ↗"}</button>
    </section>
    {notice && <div className="platform-success" role="status">{notice}</div>}
    {error && <div className="platform-alert" role="alert">{error}</div>}

    {showSeller && <form className="platform-form marketplace-editor" onSubmit={submitListing}>
      <div className="section-head"><div><div className="eyebrow">SELLER WORKSPACE</div><h2>{editingId ? "EDIT YOUR LISTING" : "CREATE A LISTING"}</h2></div>{editingId && <span className="source-pill">EDIT MODE</span>}</div>
      <label>Listing title<input required minLength={3} maxLength={160} value={listing.title} onChange={e => setListing({ ...listing, title: e.target.value })}/></label>
      <label>Description<textarea required rows={4} maxLength={5000} value={listing.description} onChange={e => setListing({ ...listing, description: e.target.value })}/></label>
      <div className="form-two"><label>Category<select value={listing.category} onChange={e => setListing({ ...listing, category: e.target.value })}>{CATEGORIES.slice(1).map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Currency<select value={listing.currency} onChange={e => setListing({ ...listing, currency: e.target.value })}>{["USD","EUR","GBP"].map(value => <option key={value}>{value}</option>)}</select></label></div>
      <label>Price<input required type="number" min="0" step="0.01" value={listing.price} onChange={e => setListing({ ...listing, price: e.target.value })}/></label>
      <label>Licence terms<textarea rows={3} maxLength={2000} value={listing.licenseTerms} onChange={e => setListing({ ...listing, licenseTerms: e.target.value })} placeholder="State exactly what the buyer may use, modify and redistribute."/></label>
      <label>Preview URL (optional)<input type="url" value={listing.previewUrl} onChange={e => setListing({ ...listing, previewUrl: e.target.value })} placeholder="https://…"/></label>
      <div className="form-actions"><button className="primary-btn" disabled={busy}>{busy ? "SAVING…" : editingId ? "UPDATE LISTING" : "SAVE LISTING"}</button><button type="button" className="outline-btn" onClick={resetForm}>CANCEL</button></div>
      <p className="account-muted">Listings are moderated. An active Premium membership is required to submit a listing for publication. Payment and seller payouts are not active.</p>
    </form>}

    {selected && <form className="platform-form marketplace-inquiry-form" onSubmit={sendInquiry}>
      <button type="button" className="text-btn" onClick={() => setSelected(null)}>← BACK TO LISTINGS</button>
      <div className="eyebrow">CONTACT THE CREATOR</div><h2>{selected.title}</h2><p>{selected.seller_name} · {money(selected)}</p>
      {selected.license_terms && <div className="market-license"><b>LICENCE TERMS</b><p>{selected.license_terms}</p></div>}
      <label>Your enquiry<textarea required minLength={5} maxLength={2000} rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="Ask about compatibility, licence terms or the product…"/></label>
      <button className="primary-btn" disabled={busy}>{busy ? "SENDING…" : "SEND ENQUIRY ↗"}</button>
    </form>}

    <section className="marketplace-browser">
      <div className="section-head"><div><div className="eyebrow">DISCOVER INDEPENDENT CREATORS</div><h2>MARKETPLACE CATALOGUE</h2></div><span className="source-pill">{visibleItems.length} LISTINGS</span></div>
      <div className="marketplace-filters"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search packs, presets, creators…"/>
        <select value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select>
        <select value={currency} onChange={e => setCurrency(e.target.value)}><option value="All">All currencies</option>{["USD","EUR","GBP"].map(value => <option key={value}>{value}</option>)}</select>
        <select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="price-low">Price: low to high (grouped by currency)</option><option value="price-high">Price: high to low (grouped by currency)</option></select>
      </div>
      <div className="market-grid">{visibleItems.map(item => <article className="market-card" key={item.id}>
        <div className="market-art"><span>{item.category}</span><b>V</b></div><div className="market-card-content">
          <div className="eyebrow">{item.seller_name || "VICEHUB CREATOR"}</div><h2>{item.title}</h2><p>{item.description}</p>
          {item.preview_url && <a className="market-preview-link" href={item.preview_url} target="_blank" rel="noreferrer">VIEW PREVIEW ↗</a>}
          <div className="market-price">{money(item)}</div><div className="market-actions"><button className="outline-btn" onClick={() => setSelected(item)}>CONTACT CREATOR ↗</button><button className="text-btn" onClick={() => report(item)}>REPORT</button></div>
        </div></article>)}</div>
      {!visibleItems.length && <div className="platform-empty">{items.length ? "No listings match your search and filters." : "No approved listings are available yet. Creator listings appear here after moderation."}</div>}
    </section>

    {isAuthenticated && <section className="marketplace-seller-workspace">
      <div className="section-head"><div><div className="eyebrow">YOUR CREATOR BUSINESS</div><h2>SELLER DASHBOARD</h2></div><span className="source-pill">{myItems.length} YOUR LISTINGS</span></div>
      <div className="seller-listing-list">{myItems.map(item => <article className="seller-listing-row" key={item.id}>
        <div><b>{item.title}</b><small>{item.category} · {money(item)}</small></div><span className={"listing-status listing-status-" + item.status}>{item.status.replace("_"," ")}</span>
        <button className="outline-btn" onClick={() => editListing(item)}>EDIT</button>
      </article>)}</div>
      {!myItems.length && <div className="platform-empty">You have not created a listing yet. Open the Seller Desk to start.</div>}
      <div className="marketplace-inquiry-columns">
        <section className="admin-panel"><h3>INCOMING ENQUIRIES ({inquiries.seller?.length || 0})</h3>
          {(inquiries.seller || []).map(item => <article className="inquiry-card" key={item.id}><div className="eyebrow">{item.status} · {new Date(item.created_date).toLocaleDateString("en-GB")}</div><p>{item.message}</p>{item.seller_reply && <small>Your last reply: {item.seller_reply}</small>}
            <form onSubmit={event => reply(event,item)}><textarea required minLength={2} maxLength={2000} rows={2} value={replyDrafts[item.id] || ""} onChange={e => setReplyDrafts({ ...replyDrafts, [item.id]: e.target.value })} placeholder="Reply to this buyer…"/><button className="text-btn">SEND REPLY ↗</button></form>
          </article>)}
          {!inquiries.seller?.length && <div className="platform-empty">No buyer enquiries received.</div>}
        </section>
        <section className="admin-panel"><h3>ENQUIRIES YOU SENT ({inquiries.buyer?.length || 0})</h3>
          {(inquiries.buyer || []).map(item => <article className="inquiry-card" key={item.id}><div className="eyebrow">{item.status}</div><p>{item.message}</p>{item.seller_reply ? <small>Creator reply: {item.seller_reply}</small> : <small>Waiting for the creator to reply.</small>}</article>)}
          {!inquiries.buyer?.length && <div className="platform-empty">You have not contacted a seller yet.</div>}
        </section>
      </div>
    </section>}
    <div className="platform-note">VICEHUB currently supports discovery, moderated listings and enquiries only. It does not take payments, hold buyer funds, create orders or pay sellers. Do not send payment details through marketplace messages.</div>
  </SiteFrame>;
}
