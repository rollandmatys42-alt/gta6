import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import "@/styles/social-publishing.css";
import {
  beginSocialOAuth, completeSocialOAuth, getMySocialAccounts,
  getSocialProviderAvailability, disconnectSocialAccount,
} from "@/lib/server-fns";
import { useAuth } from "@/lib/AuthContext";
import "@/styles/vicehub-2026-redesign.css";
import "@/styles/social-library.css";

export const Route = createFileRoute("/social")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Connect Social Accounts — VICEHUB" },
    { name: "description", content: "Connect your TikTok, Instagram and YouTube accounts to VICEHUB." },
  ] }),
  component: SocialAccountsPage,
});

const platforms = [
  { key: "TikTok", label: "TikTok", mark: "♪", description: "Connect the TikTok account you use for your GTA VI videos.", className: "tiktok", art: "https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=1920" },
  { key: "Instagram", label: "Instagram", mark: "◎", description: "Connect your Instagram account to your VICEHUB profile.", className: "instagram", art: "https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=1920" },
  { key: "YouTube", label: "YouTube", mark: "▶", description: "Connect your YouTube channel for your creator profile.", className: "youtube", art: "https://www.rockstargames.com/VI/_next/static/media/Vice_City_27.0d2e~w_r93hmh.jpg?akim=1&imdensity=1&imwidth=1920" },
];

function SocialAccountsPage() {
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [availability, setAvailability] = useState({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState("");
  const [busyAccount, setBusyAccount] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const callbackHandled = useRef(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [connected, providerStatus] = await Promise.all([
        getMySocialAccounts(),
        getSocialProviderAvailability(),
      ]);
      setAccounts(connected || []);
      setAvailability(providerStatus || {});
    } catch (err) {
      setError(err?.message || "Your connected accounts could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    refresh();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined" || callbackHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const providerError = params.get("error_description") || params.get("error");
    if (providerError) {
      callbackHandled.current = true;
      setError("The social account connection was cancelled or refused: " + providerError);
      window.history.replaceState({}, "", "/social");
      return;
    }
    if (!code || !state) return;
    callbackHandled.current = true;
    window.history.replaceState({}, "", "/social");
    setConnecting("callback");
    setError("");
    completeSocialOAuth({ data: { code, state } })
      .then(async result => {
        setNotice((result?.count || 1) + " account connection(s) completed.");
        await refresh();
      })
      .catch(err => setError(err?.message || "The account could not be connected."))
      .finally(() => setConnecting(""));
  }, [isAuthenticated]);

  const connect = async provider => {
    if (!isAuthenticated) { navigateToLogin(); return; }
    setConnecting(provider);
    setError("");
    setNotice("");
    try {
      const result = await beginSocialOAuth({ data: { provider } });
      if (!result?.authorizationUrl) throw new Error("The provider did not return an authorisation URL.");
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(err?.message || "A secure connection could not be started.");
      setConnecting("");
    }
  };

  const disconnect = async account => {
    if (!window.confirm("Disconnect " + account.accountName + " from VICEHUB?")) return;
    setBusyAccount(account.id);
    setError("");
    setNotice("");
    try {
      await disconnectSocialAccount({ data: { accountId: account.id } });
      setNotice(account.accountName + " has been disconnected.");
      await refresh();
    } catch (err) {
      setError(err?.message || "This account could not be disconnected.");
    } finally {
      setBusyAccount("");
    }
  };

  const connectedFor = provider => accounts.filter(account => account.provider === provider);
  const connectedCount = accounts.filter(account => platforms.some(p => p.key === account.provider)).length;

  return (
    <SiteFrame eyebrow="VICEHUB / SOCIAL ACCOUNTS" workspace={isAuthenticated} activeKey="social">
      <main className="social-shell vh-social-connect-only vh-social-library-page">
        <header className="social-hero vh-image-hero">
          <img className="vh-page-art-image" src="https://www.rockstargames.com/VI/_next/static/media/Jason_Lucia_Rooftop_landscape.0c6p5do~-8~7..jpg?akim=1&imdensity=1&imwidth=1920" alt="Jason and Lucia in Leonida — GTA VI artwork" />
          <div className="vh-page-art-shade" />
          <div className="vh-social-hero-copy">
            <span className="social-kicker">VICEHUB / CREATOR CHANNELS</span>
            <h1>YOUR SOCIAL<br /><em>CHANNELS.</em></h1>
            <p>Manage the TikTok, Instagram and YouTube accounts linked to your VICEHUB creator profile. Each connection is authorised directly by its platform.</p>
          </div>
          <div className="social-hero-stamp"><b>03</b><span>PLATFORMS</span><small>YOUR ACCOUNTS / YOUR CONTROL</small></div>
        </header>

        {!isAuthenticated ? (
          <section className="vh-social-connect-intro">
            <h2>YOUR CHANNELS, IN ONE PLACE.</h2>
            <p>Sign in to connect your TikTok, Instagram and YouTube accounts to your VICEHUB profile.</p>
            <button type="button" className="social-primary" onClick={navigateToLogin}>SIGN IN TO CONNECT ↗</button>
          </section>
        ) : (
          <>
            {error && <div className="social-alert" role="alert">{error}</div>}
            {notice && <div className="social-notice" role="status">{notice}</div>}

            <section className="vh-social-connect-section">
              <div className="vh-social-connect-heading">
                <div><span className="social-kicker">01 / CONNECT</span><h2>YOUR PLATFORMS</h2></div>
                <span className="vh-social-total">{connectedCount} / 3 CONNECTED</span>
              </div>
              <p className="vh-social-explainer">Choose a platform and authorise access through its official sign-in window. You can disconnect an account at any time.</p>

              <div className="vh-social-platform-grid">
                {platforms.map(platform => {
                  const linked = connectedFor(platform.key);
                  const ready = availability[platform.key] === true;
                  return (
                    <article className={"vh-social-platform-card " + platform.className} key={platform.key}>
                      <div className="vh-social-platform-art"><img src={platform.art} alt="" loading="lazy" /><span>{platform.label}</span></div>
                      <div className="vh-social-platform-brand">
                        <span className="vh-social-platform-mark" aria-hidden="true">{platform.mark}</span>
                        <span className="vh-social-platform-state">{linked.length ? "CONNECTED" : "NOT CONNECTED"}</span>
                      </div>
                      <h3>{platform.label}</h3>
                      <p>{platform.description}</p>
                      <div className="vh-social-platform-bottom">
                        <span>{linked.length ? linked.length + " account" + (linked.length > 1 ? "s" : "") + " linked" : "No account linked yet"}</span>
                        <button type="button" onClick={() => connect(platform.key)} disabled={!ready || !!connecting || !!busyAccount}>
                          {connecting === platform.key ? "CONNECTING…" : ready ? linked.length ? "CONNECT ANOTHER ACCOUNT ↗" : "CONNECT ACCOUNT ↗" : "CONNECTION UNAVAILABLE"}
                        </button>
                      </div>
                      {!ready && <small className="vh-social-setup-note">This platform is not configured by the VICEHUB administrator yet.</small>}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="vh-social-linked-section">
              <div className="vh-social-connect-heading">
                <div><span className="social-kicker">02 / ACCOUNT STATUS</span><h2>LINKED ACCOUNTS</h2></div>
                <span className="vh-social-total">{connectedCount} ACTIVE</span>
              </div>
              {loading ? <div className="social-empty">Loading your connected accounts…</div> : connectedCount === 0 ? (
                <div className="vh-social-no-accounts"><span>◎</span><b>NO ACCOUNTS CONNECTED</b><p>Your connected TikTok, Instagram or YouTube accounts will appear here.</p></div>
              ) : (
                <div className="vh-social-linked-list">
                  {accounts.filter(account => platforms.some(p => p.key === account.provider)).map(account => (
                    <article className="vh-social-linked-account" key={account.id}>
                      <span className={"vh-social-linked-mark " + account.provider.toLowerCase()}>{platforms.find(p => p.key === account.provider)?.mark}</span>
                      <div className="vh-social-linked-info"><b>{account.accountName}</b><small>{account.provider} {account.accountType ? "· " + account.accountType : ""}{account.connectedAt ? " · Connected " + new Date(account.connectedAt).toLocaleDateString() : ""}</small></div>
                      <span className="vh-social-linked-status">CONNECTED</span>
                      <button type="button" onClick={() => disconnect(account)} disabled={!!busyAccount || !!connecting}>{busyAccount === account.id ? "DISCONNECTING…" : "DISCONNECT"}</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <p className="vh-social-next-step">That’s all for now. VICEHUB is only linking your accounts at this stage. The content-sharing and publishing features will be designed separately.</p>
          </>
        )}
      </main>
    </SiteFrame>
  );
}
