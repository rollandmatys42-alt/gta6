import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { createClient } from "@base44/sdk";
import "@/styles/auth-experience.css";

const base44 = createClient({ appId: "6b02e11e6786e710c26cc578" });

export default function AuthExperience({ mode = "login" }) {
  const [view, setView] = useState(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const message = err => {
    const status = err?.status;
    if (status === 401) return "Email or password is incorrect.";
    if (status === 403) return "Verify your email address before signing in.";
    if (status === 409) return "An account already exists with this email. Sign in instead.";
    if (status === 422) return "Please check the information and password requirements.";
    if (status === 429) return "Too many attempts. Wait a moment and try again.";
    return err?.message || "Something went wrong. Please try again.";
  };

  const continueWithGoogle = () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      base44.auth.loginWithProvider("google", "/dashboard");
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  const login = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await base44.auth.loginViaEmailPassword(email.trim(), password);
      window.location.assign("/dashboard");
    } catch (err) { setError(message(err)); setBusy(false); }
  };

  const register = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await base44.auth.register({ email: email.trim(), password });
      setView("verify");
      setNotice("We sent a verification code to your email. Enter it below to activate your account.");
    } catch (err) { setError(message(err)); setBusy(false); }
  };

  const verify = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await base44.auth.verifyOtp({ email: email.trim(), otpCode: otp.trim() });
      const result = await base44.auth.loginViaEmailPassword(email.trim(), password);
      if (name.trim()) await base44.auth.updateMe({ full_name: name.trim() });
      window.location.assign("/dashboard");
    } catch (err) { setError(message(err)); setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError(""); setNotice("");
    try { await base44.auth.resendOtp(email.trim()); setNotice("A new verification code has been sent."); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const reset = async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await base44.auth.resetPasswordRequest(email.trim()); setNotice("If an account exists for this email, a password reset message will arrive shortly."); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const title = view === "register" ? "Claim your place in Leonida." : view === "verify" ? "One last checkpoint." : view === "reset" ? "Back on the road." : "Welcome back to Leonida.";
  const subtitle = view === "register" ? "Create your free VICEHUB account and build your GTA VI creator profile." : view === "verify" ? "Confirm your email to secure your creator account." : view === "reset" ? "We’ll send you a secure link to reset your password." : "Sign in to your creator headquarters and pick up where you left off.";

  return <main className="vh-auth-page">
    <section className="vh-auth-scene">
      <div className="vh-auth-scene-top"><Link to="/" className="vh-auth-brand"><span>V</span><b>VICEHUB</b><small>GTA VI CREATOR UNIVERSE</small></Link><span className="vh-auth-coordinate">LEONIDA · 26°07′N / 80°08′W</span></div>
      <div className="vh-auth-map-art" aria-hidden="true"><div className="vh-auth-map-grid"/><div className="vh-auth-map-island"><i/><i/><i/><i/><i/></div><div className="vh-auth-map-route route-a"/><div className="vh-auth-map-route route-b"/><span className="vh-map-label label-north">LUMMOX COUNTY</span><span className="vh-map-label label-city">VICE CITY</span><span className="vh-map-label label-south">VICE-DALE COUNTY</span><span className="vh-map-pin">●</span><span className="vh-map-pin pin-two">●</span></div>
      <div className="vh-auth-scene-bottom"><div><span>INDEPENDENT FAN PLATFORM</span><h1>THE STATE<br/><em>OF CREATORS.</em></h1><p>Stories, creators and culture from every corner of Leonida.</p></div><div className="vh-auth-scene-index"><b>VICEHUB</b><span>EST. FOR THE COMMUNITY</span><span>NOT AFFILIATED WITH ROCKSTAR GAMES</span></div></div>
    </section>
    <section className="vh-auth-panel">
      <div className="vh-auth-panel-top"><Link to="/" className="vh-auth-back">← Back to VICEHUB</Link><span>CREATOR ACCESS / 01</span></div>
      <div className="vh-auth-form-wrap">
        <div className="vh-auth-kicker"><i/> {view === "register" ? "NEW CREATOR REGISTRATION" : view === "verify" ? "EMAIL VERIFICATION" : view === "reset" ? "ACCOUNT RECOVERY" : "SECURE MEMBER ACCESS"}</div>
        <h2>{title}</h2><p className="vh-auth-intro">{subtitle}</p>
        {view === "login" && <div className="vh-auth-switch"><span>New to VICEHUB?</span><Link to="/register">Create an account ↗</Link></div>}
        {(view === "login" || view === "register" || view === "verify") && <button type="button" className="vh-auth-google" onClick={continueWithGoogle} disabled={busy}>
          <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.62 5.91c4.45-4.11 7.15-10.16 7.15-17.56z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.56 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.79l-7.62-5.91c-2.12 1.42-4.84 2.25-8.28 2.25-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          <span>{view === "verify" ? "CONTINUE WITH GOOGLE INSTEAD" : view === "register" ? "SIGN UP WITH GOOGLE" : "CONTINUE WITH GOOGLE"}</span>
          <b>↗</b>
        </button>}
        {(view === "login" || view === "register" || view === "verify") && <div className="vh-auth-or"><span/> <small>OR USE EMAIL</small> <span/></div>}

        {view === "register" && <div className="vh-auth-switch"><span>Already have an account?</span><Link to="/sign-in">Sign in ↗</Link></div>}
        {error && <div className="vh-auth-alert" role="alert">{error}</div>}
        {notice && <div className="vh-auth-notice" role="status">{notice}</div>}
        {view === "login" && <form onSubmit={login} className="vh-auth-form">
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
          <label>Password<span className="vh-password-field"><input type={showPassword?"text":"password"} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password"/><button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?"HIDE":"SHOW"}</button></span></label>
          <div className="vh-auth-inline"><button type="button" className="vh-auth-text-button" onClick={()=>{setView("reset");setError("");setNotice("");}}>Forgot password?</button><span>SECURE SESSION</span></div>
          <button className="vh-auth-submit" disabled={busy}>{busy?"SIGNING IN…":"SIGN IN TO VICEHUB"} <b>↗</b></button>
        </form>}
        {view === "register" && <form onSubmit={register} className="vh-auth-form">
          <label>Display name<input type="text" autoComplete="name" maxLength={80} required value={name} onChange={e=>setName(e.target.value)} placeholder="Your creator name"/></label>
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
          <label>Create password<span className="vh-password-field"><input type={showPassword?"text":"password"} autoComplete="new-password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/><button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?"HIDE":"SHOW"}</button></span></label>
          <p className="vh-auth-terms">By creating an account, you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>. Email verification is required for email/password accounts. Google sign-up does not use this email code.</p>
          <button className="vh-auth-submit" disabled={busy}>{busy?"CREATING ACCOUNT…":"CREATE FREE ACCOUNT"} <b>↗</b></button>
        </form>}
        {view === "verify" && <form onSubmit={verify} className="vh-auth-form">
          <label>Verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={otp} onChange={e=>setOtp(e.target.value)} placeholder="Enter the code from your email"/></label>
          <p className="vh-auth-terms vh-auth-otp-help">No code arrived? Search all folders for no-reply@base44-apps.com, including Spam/Junk and Promotions. Confirm the email address, then request a new code. You can also continue with Google above and avoid email-code verification.</p>
          <button className="vh-auth-submit" disabled={busy}>{busy?"VERIFYING…":"VERIFY & ENTER VICEHUB"} <b>↗</b></button>
          <button type="button" className="vh-auth-secondary" disabled={busy} onClick={resend}>Resend verification code</button>
        </form>}
        {view === "reset" && <form onSubmit={reset} className="vh-auth-form">
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
          <button className="vh-auth-submit" disabled={busy}>{busy?"SENDING…":"SEND RESET LINK"} <b>↗</b></button>
          <button type="button" className="vh-auth-secondary" onClick={()=>{setView("login");setError("");setNotice("");}}>Back to sign in</button>
        </form>}
        <div className="vh-auth-divider"><span/> <small>VICEHUB / LEONIDA</small> <span/></div>
        <p className="vh-auth-disclaimer">VICEHUB is an independent fan community. Not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive.</p>
      </div>
      <div className="vh-auth-panel-bottom"><span>© VICEHUB</span><span>BUILT FOR THE COMMUNITY</span><span>ENGLISH · GLOBAL</span></div>
    </section>
  </main>;
}
