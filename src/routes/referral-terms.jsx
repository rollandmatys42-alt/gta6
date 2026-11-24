import { createFileRoute, Link } from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import "@/styles/vicehub-growth.css";

export const Route = createFileRoute("/referral-terms")({
  head: () => ({ meta: [{ title: "Referral Programme Terms — VICEHUB" }, { name: "robots", content: "index,follow" }] }),
  component: ReferralTermsPage,
});

function ReferralTermsPage() {
  return <SiteFrame eyebrow="VICEHUB / REFERRAL PROGRAMME">
    <article className="vh-referral-terms">
      <span className="fh-section-kicker">CREATOR REWARDS · VERSION 1.0 · 24 NOVEMBER 2026</span>
      <h1>Referral Programme Terms</h1>
      <p className="vh-terms-lead">Share VICEHUB with a new creator. They receive a first-invoice discount; you earn VICEHUB membership credit when their first subscription payment is confirmed.</p>
      <h2>1. The reward</h2>
      <ul>
        <li>The referred person receives 5% off their first paid monthly membership invoice.</li>
        <li>The referrer earns membership credit equal to 20% of the first successful subscription payment, calculated after any discount and excluding separately stated tax.</li>
        <li>Only one reward is earned for each eligible new customer. The reward is not recurring and is not paid on renewals.</li>
      </ul>
      <h2>2. Validation and use of credit</h2>
      <ul>
        <li>Credits remain pending for 30 days after payment confirmation.</li>
        <li>After validation, credit can be applied to a future VICEHUB subscription invoice in the same currency.</li>
        <li>Credit can reduce an invoice by up to 100%. Any unused balance remains in the wallet and carries forward.</li>
        <li>Credits are promotional account balance, not cash, are non-transferable and cannot be withdrawn or exchanged for cash.</li>
      </ul>
      <h2>3. Eligibility and prohibited activity</h2>
      <ul>
        <li>The referred customer must be a genuinely new VICEHUB subscriber and must use a valid referral link before checkout.</li>
        <li>Self-referrals, duplicate accounts, false identities, automated sign-ups, spam, misleading claims, cookie stuffing and paid search bidding on VICEHUB brand terms are prohibited.</li>
        <li>Referrers must disclose clearly that they may receive VICEHUB credit when sharing their referral link. Do not imply that earnings are guaranteed.</li>
      </ul>
      <h2>4. Refunds, disputes and abuse</h2>
      <p>Referral credit is conditional on the referred payment remaining valid. VICEHUB may withhold, cancel or adjust pending or available credit where a payment is refunded, reversed, disputed or associated with suspected abuse. Accounts involved in abuse may be suspended from the programme.</p>
      <h2>5. No earnings guarantee</h2>
      <p>There is no guaranteed income. Results depend on genuine referrals who independently choose to purchase a membership. The programme is one-level only; no commission is paid on referrals made by your referrals.</p>
      <h2>6. Changes and contact</h2>
      <p>VICEHUB may amend or suspend the programme where reasonably necessary, including to prevent abuse or comply with law. The terms in force at the time of the qualifying referral apply, subject to applicable consumer law.</p>
      <p className="vh-terms-note">This programme provides membership credits only. It is not an employment relationship, financial product or promise of income. Members remain responsible for any tax reporting obligations that apply to them.</p>
      <Link to="/dashboard" className="fh-btn solid big">Back to creator dashboard</Link>
    </article>
  </SiteFrame>;
}
