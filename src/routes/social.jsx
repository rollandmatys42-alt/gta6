import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import "@/styles/social-publishing.css";
import {
  beginSocialOAuth, completeSocialOAuth, getMySocialAccounts, getMySocialPosts,
  saveSocialPost, deleteSocialPost, disconnectSocialAccount, publishSocialPost,
  processMyDueSocialPosts, generateStudioDraft,
} from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/social")({
  ssr: false,
  head: () => ({ meta: [{ title: "Social Publishing — VICEHUB" }, { name: "description", content: "Connect your own social accounts, plan and publish creator content." }] }),
  component: SocialPublishingPage,
});

const platforms = ["TikTok", "Instagram", "Facebook", "YouTube", "X"];
const platformNotes = {
  TikTok: "Video publishing. Public posting depends on TikTok app review and account permissions.",
  Instagram: "Instagram Reels publishing requires an Instagram professional account linked to a Facebook Page.",
  Facebook: "Video publishing to Facebook Pages. Personal profile publishing is not supported.",
  YouTube: "Video upload to your selected YouTube channel. Google may require app verification.",
  X: "Text publishing is enabled. Video upload is not included in this release.",
};

function localDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function statusLabel(status) {
  return ({ draft: "DRAFT", scheduled: "SCHEDULED", publishing: "PROCESSING", published: "PUBLISHED", failed: "FAILED" })[status] || String(status || "").toUpperCase();
}

function SocialPublishingPage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [posts, setPosts] = useState([]);
  const [platform, setPlatform] = useState("TikTok");
  const [accountId, setAccountId] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [editingId, setEditingId] = useState("");
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [connected, savedPosts] = await Promise.all([getMySocialAccounts(), getMySocialPosts()]);
      setAccounts(connected || []);
      setPosts(savedPosts || []);
    } catch (err) {
      setError(err?.message || "Could not load your social workspace.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    refresh();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const providerError = params.get("error_description") || params.get("error");
    if (providerError) {
      setError("Social authorisation was cancelled or refused: " + providerError);
      window.history.replaceState({}, "", "/social");
      return;
    }
    if (!code || !state) return;
    let active = true;
    setBusy(true);
    setError("");
    completeSocialOAuth({ data: { code, state } })
      .then(result => {
        if (!active) return;
        setNotice(result.count + " social account(s) connected successfully.");
        window.history.replaceState({}, "", "/social");
        return refresh();
      })
      .catch(err => {
        if (active) {
          setError(err?.message || "The social account could not be connected.");
          window.history.replaceState({}, "", "/social");
        }
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const accountOptions = accounts.filter(account => account.provider === platform);
  const visiblePosts = useMemo(() => posts.filter(post => filter === "All" || post.platform === filter), [posts, filter]);
  const resetForm = () => {
    setEditingId(""); setPlatform("TikTok"); setAccountId(""); setCaption(""); setMediaUrl(""); setScheduledAt("");
  };
  const connect = async provider => {
    if (!isAuthenticated) { navigateToLogin(); return; }
    setConnecting(provider); setError(""); setNotice("");
    try {
      const result = await beginSocialOAuth({ data: { provider } });
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(err?.message || "Could not start the secure connection.");
      setConnecting("");
    }
  };
  const disconnect = async account => {
    if (!window.confirm("Disconnect " + account.accountName + " from VICEHUB?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await disconnectSocialAccount({ data: { accountId: account.id } });
      setNotice("Social account disconnected. Its stored credentials have been erased.");
      await refresh();
    } catch (err) { setError(err?.message || "Could not disconnect this account."); }
    finally { setBusy(false); }
  };
  const generateCaption = async () => {
    if (caption.trim().length < 5) { setError("Write a short subject or video brief first. OmniRoute will turn it into a platform caption."); return; }
    setAiBusy(true); setError(""); setNotice("");
    try {
      const result = await generateStudioDraft({ data: { platform, contentType: "Caption", topic: caption.trim(), tone: "Energetic", language: "English" } });
      setCaption(result.output || "");
      setNotice("Caption generated through OmniRoute. Review and edit it before publishing.");
    } catch (err) { setError(err?.message || "OmniRoute could not generate this caption."); }
    finally { setAiBusy(false); }
  };
  const save = async event => {
    event.preventDefault();
    if (!isAuthenticated) { navigateToLogin(); return; }
    if (!accountId) { setError("Connect and select the destination account before saving a publishable post."); return; }
    if (platform !== "X" && !mediaUrl.trim()) { setError("This network requires a publicly reachable HTTPS video URL."); return; }
    if (mediaUrl.trim() && !/^https:\/\//i.test(mediaUrl.trim())) { setError("Media URL must use HTTPS."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await saveSocialPost({ data: {
        ...(editingId ? { id: editingId } : {}),
        platform, accountId, caption,
        ...(mediaUrl.trim() ? { mediaUrl: mediaUrl.trim() } : {}),
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      }});
      setNotice(scheduledAt ? "Publication added to your scheduled queue." : "Draft saved to your private planner.");
      resetForm();
      await refresh();
    } catch (err) { setError(err?.message || "Could not save this post."); }
    finally { setBusy(false); }
  };
  const edit = post => {
    setEditingId(post.id); setPlatform(post.platform); setAccountId(post.account_id || "");
    setCaption(post.caption || ""); setMediaUrl(post.media_reference || "");
    setScheduledAt(localDate(post.scheduled_at)); setError(""); setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const remove = async post => {
    if (!window.confirm("Delete this unpublished post?")) return;
    setBusy(true); setError(""); setNotice("");
    try { await deleteSocialPost({ data: { postId: post.id } }); setNotice("Post deleted."); await refresh(); }
    catch (err) { setError(err?.message || "Could not delete this post."); }
    finally { setBusy(false); }
  };
  const publish = async post => {
    if (!window.confirm("Publish this content to " + post.platform + " now? The network may make it public immediately.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await publishSocialPost({ data: { postId: post.id } });
      setNotice(result.message || "Publication request sent.");
      await refresh();
    } catch (err) { setError(err?.message || "Publication failed. The draft remains available for correction."); await refresh(); }
    finally { setBusy(false); }
  };
  const processDue = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await processMyDueSocialPosts();
      setNotice(result.processed + " due publication(s) processed. Review each result below.");
      await refresh();
    } catch (err) { setError(err?.message || "The scheduled queue could not be processed."); }
    finally { setBusy(false); }
  };

  if (!isAuthenticated) return <SiteFrame eyebrow="VICEHUB / SOCIAL PUBLISHING"><section className="social-shell"><h1>YOUR SOCIAL DESK.</h1><p>Sign in to connect your own accounts and manage your publications.</p><button className="social-primary" onClick={navigateToLogin}>SIGN IN TO CONTINUE ↗</button></section></SiteFrame>;

  return <SiteFrame eyebrow="VICEHUB / SOCIAL PUBLISHING">
    <main className="social-shell">
      <header className="social-hero">
        <div><span className="social-kicker">VICEHUB / CREATOR DISTRIBUTION</span><h1>YOUR SOCIAL<br/><em>CONTROL ROOM.</em></h1><p>Connect your own channels. Prepare platform-specific content. Publish to the account you select — never to another member's profile.</p></div>
        <div className="social-hero-stamp"><b>05</b><span>NETWORKS</span><small>YOUR ACCOUNTS / YOUR TOKENS</small></div>
      </header>

      {error && <div className="social-alert" role="alert">{error}</div>}
      {notice && <div className="social-notice" role="status">{notice}</div>}

      <section className="social-section">
        <div className="social-section-head"><div><span className="social-kicker">01 / AUTHENTICATION</span><h2>CONNECTED ACCOUNTS</h2></div><span className="social-count">{accounts.length} CONNECTED</span></div>
        <p className="social-muted">Each member authorises their own accounts. VICEHUB stores encrypted credentials and only exposes account names and connection status to the interface.</p>
        <div className="social-connect-grid">
          {platforms.map(provider => <article className="social-provider-card" key={provider}>
            <div className="social-provider-top"><b>{provider}</b><span>{accounts.filter(a => a.provider === provider).length} CONNECTED</span></div>
            <p>{platformNotes[provider]}</p>
            <button type="button" onClick={() => connect(provider === "Facebook" ? "Instagram" : provider)} disabled={!!connecting || busy}>{connecting === provider || (provider === "Facebook" && connecting === "Instagram") ? "CONNECTING…" : provider === "Facebook" ? "CONNECT VIA META ↗" : "CONNECT ACCOUNT ↗"}</button>
          </article>)}
        </div>
        {accounts.length > 0 && <div className="social-account-list">
          {accounts.map(account => <article className="social-account-row" key={account.id}>
            <div><span className="social-connected-dot" /><div><b>{account.accountName}</b><small>{account.provider} · {account.accountType} · connected {account.connectedAt ? new Date(account.connectedAt).toLocaleDateString() : ""}</small></div></div>
            <button type="button" className="social-quiet-button" onClick={() => disconnect(account)} disabled={busy}>DISCONNECT</button>
          </article>)}
        </div>}
      </section>

      <section className="social-section">
        <div className="social-section-head"><div><span className="social-kicker">02 / CONTENT DISTRIBUTION</span><h2>CREATE A PUBLICATION</h2></div><span className="social-count">PRIVATE PLANNER</span></div>
        <form className="social-composer" onSubmit={save}>
          <div className="social-form-grid">
            <label>NETWORK<select value={platform} onChange={event => { setPlatform(event.target.value); setAccountId(""); }}><option value="TikTok">TikTok</option><option value="Instagram">Instagram</option><option value="Facebook">Facebook Page</option><option value="YouTube">YouTube</option><option value="X">X</option></select></label>
            <label>DESTINATION ACCOUNT<select required value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">Select your connected account…</option>{accountOptions.map(account => <option value={account.id} key={account.id}>{account.accountName}</option>)}</select></label>
          </div>
          <div className="social-platform-hint">{platformNotes[platform]}</div>
          <label>CAPTION / DESCRIPTION<textarea required minLength={1} maxLength={5000} rows={5} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Write a short brief, then use OmniRoute to generate a platform-ready caption…" /></label><div className="social-ai-row"><button type="button" className="social-secondary" onClick={generateCaption} disabled={aiBusy || busy}>{aiBusy ? "OMNIROUTE IS WRITING…" : "GENERATE / REWRITE WITH OMNIROUTE ✦"}</button><small>AI output is a draft only. Review factual claims and rights before publication.</small></div>
          {platform !== "X" && <label>PUBLIC VIDEO URL (HTTPS)<input required type="url" value={mediaUrl} onChange={event => setMediaUrl(event.target.value)} placeholder="https://your-public-video-host/video.mp4" /><small>The selected network must be able to fetch this URL. Private R2 links and local files are not accepted here.</small></label>}
          <div className="social-form-grid">
            <label>SCHEDULE FOR (OPTIONAL)<input type="datetime-local" min={localDate(new Date(Date.now() + 60000).toISOString())} value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} /><small>Scheduled posts are queued. Run the due queue from this page, or connect a server scheduler before relying on unattended posting.</small></label>
            <div className="social-composer-side"><span>CONTENT CHECK</span><b>{platform === "X" ? "TEXT POST" : "VIDEO POST"}</b><small>Always review the final caption and destination account before publication.</small></div>
          </div>
          <div className="social-form-actions"><button className="social-primary" disabled={busy}>{busy ? "SAVING…" : editingId ? "UPDATE POST" : scheduledAt ? "SCHEDULE POST" : "SAVE DRAFT"}</button>{editingId && <button className="social-secondary" type="button" onClick={resetForm}>CANCEL EDIT</button>}</div>
        </form>
      </section>

      <section className="social-section">
        <div className="social-section-head"><div><span className="social-kicker">03 / PUBLICATION HISTORY</span><h2>YOUR CONTENT QUEUE</h2></div><button type="button" className="social-secondary" onClick={processDue} disabled={busy}>PROCESS DUE POSTS ↻</button></div>
        <div className="social-queue-toolbar"><span>{posts.length} POSTS</span><select value={filter} onChange={event => setFilter(event.target.value)}><option>All</option>{platforms.map(item => <option key={item}>{item}</option>)}</select><button type="button" className="social-secondary" onClick={refresh} disabled={loading || busy}>REFRESH</button></div>
        {loading ? <div className="social-empty">Loading your private queue…</div> : visiblePosts.length === 0 ? <div className="social-empty">No posts yet. Connect a network and create your first publication.</div> : <div className="social-post-list">
          {visiblePosts.map(post => <article className="social-post-card" key={post.id}>
            <div className="social-post-top"><span>{post.platform}</span><b className={"social-status status-" + post.status}>{statusLabel(post.status)}</b></div>
            <p>{post.caption}</p>
            {post.media_reference && <a href={post.media_reference} target="_blank" rel="noreferrer">VIDEO SOURCE ↗</a>}
            {post.scheduled_at && <small>{post.status === "scheduled" ? "Scheduled for " : "Scheduled "} {new Date(post.scheduled_at).toLocaleString()}</small>}
            {post.error_message && <div className="social-post-error">{post.error_message}</div>}
            {post.external_post_id && <small>Provider reference: {post.external_post_id}</small>}
            <div className="social-post-actions">
              {["draft","failed","scheduled"].includes(post.status) && <button type="button" onClick={() => publish(post)} disabled={busy}>PUBLISH NOW ↗</button>}
              {["draft","failed","scheduled"].includes(post.status) && <button type="button" onClick={() => edit(post)} disabled={busy}>EDIT</button>}
              {["draft","failed","scheduled"].includes(post.status) && <button type="button" onClick={() => remove(post)} disabled={busy}>DELETE</button>}
            </div>
          </article>)}
        </div>}
      </section>
      <footer className="social-footnote">Platform approvals, quotas and content restrictions remain controlled by each social network. VICEHUB cannot guarantee approval or bypass provider audits. Tokens are never sent to the AI copy generator.</footer>
    </main>
  </SiteFrame>;
}
