import { useEffect, useState } from "react";

const STORAGE_KEY = "vicehub_cookie_consent_v1";
const DEFAULTS = { necessary: true, analytics: false, marketing: false };

function readConsent() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value && value.version === 1 ? value : null;
  } catch { return null; }
}

export default function CookieConsent() {
  const [consent, setConsent] = useState(null);
  const [visible, setVisible] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [choices, setChoices] = useState(DEFAULTS);

  useEffect(() => {
    const saved = readConsent();
    if (saved) { setConsent(saved); setChoices(saved.categories || DEFAULTS); }
    else setVisible(true);
  }, []);

  const save = (categories) => {
    const record = { version: 1, categories: { ...DEFAULTS, ...categories, necessary: true }, savedAt: new Date().toISOString() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch {}
    setConsent(record);
    setChoices(record.categories);
    setVisible(false);
    setPreferences(false);
    window.dispatchEvent(new CustomEvent("vicehub:cookie-consent-updated", { detail: record }));
  };

  return <>
    {visible && <div className="vh-cookie-backdrop" role="presentation">
      <section className="vh-cookie-panel" role="dialog" aria-modal="true" aria-labelledby="vh-cookie-title">
        <div className="vh-cookie-kicker">YOUR PRIVACY / VICEHUB</div>
        <h2 id="vh-cookie-title">Your cookies. Your call.</h2>
        <p>We use essential storage to keep VICEHUB working. Optional analytics and marketing technologies stay off unless you choose to enable them. You can change your choice at any time.</p>
        {preferences && <div className="vh-cookie-options">
          <div><span><b>Strictly necessary</b><small>Security, login and core platform functions. Always active.</small></span><input type="checkbox" checked disabled aria-label="Strictly necessary cookies always active" /></div>
          <div><span><b>Analytics</b><small>Helps us understand how the platform is used.</small></span><input type="checkbox" checked={choices.analytics} onChange={e=>setChoices(v=>({...v,analytics:e.target.checked}))} aria-label="Allow analytics cookies" /></div>
          <div><span><b>Marketing</b><small>Used to measure campaigns and personalise marketing.</small></span><input type="checkbox" checked={choices.marketing} onChange={e=>setChoices(v=>({...v,marketing:e.target.checked}))} aria-label="Allow marketing cookies" /></div>
        </div>}
        <div className="vh-cookie-actions">
          <button type="button" className="vh-cookie-secondary" onClick={()=>save(DEFAULTS)}>Reject optional</button>
          {preferences ? <button type="button" className="vh-cookie-secondary" onClick={()=>setPreferences(false)}>Back</button> : <button type="button" className="vh-cookie-secondary" onClick={()=>setPreferences(true)}>Customise</button>}
          <button type="button" className="vh-cookie-primary" onClick={()=>save(preferences?choices:{...DEFAULTS,analytics:true,marketing:true})}>{preferences?"Save choices":"Accept all"}</button>
        </div>
        <small className="vh-cookie-footnote">You can reopen these settings from the footer. Read our <a href="/cookies">Cookie Policy</a> and <a href="/privacy">Privacy Policy</a>.</small>
      </section>
    </div>}
    {!visible && <button type="button" className="vh-cookie-manage" onClick={()=>{setChoices(consent?.categories||DEFAULTS);setPreferences(true);setVisible(true);}}>Cookie settings</button>}
  </>;
}
