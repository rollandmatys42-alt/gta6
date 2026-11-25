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
      <span className="fh-section-kicker">CREATOR REWARDS · VERSION 2.0 · 25 NOVEMBER 2026</span>
      <h1>Referral Programme Terms</h1>
      <p className="vh-terms-lead">Share VICEHUB with a new creator. They receive a first-invoice discount; you earn a cash commission when their first eligible subscription payment is confirmed.</p>
      <h2>1. The reward</h2>
      <ul>
        <li>The referred person receives 5% off their first paid monthly membership invoice.</li>
        <li>The referrer earns a cash commission equal to 20% of the first successful subscription payment, calculated after any discount and excluding separately stated tax. The commission is calculated once only; no commission is paid on renewals or later purchases.</li>
        <li>Only one reward is earned for each eligible new customer. The reward is not recurring and is not paid on renewals.</li>
      </ul>
      <h2>2. Validation and cash payouts</h2>
      <ul>
        <li>Commissions remain pending for 30 days after payment confirmation. During this period VICEHUB may review the transaction for refunds, disputes, reversals or suspected abuse.</li>
        <li>After validation, the commission becomes available for a cash payout in the same currency, subject to the minimum payout threshold, successful Stripe Connect onboarding, verification and administrative approval.</li>
        <li>Available commissions remain in the affiliate balance until a payout is requested. A submitted request reserves the selected available balance while VICEHUB reviews it.</li>
        <li>Commissions are cash remuneration for eligible referrals, not promotional account credits. Payouts are sent by Stripe Connect to the affiliate's connected account. Stripe may apply verification, processing, currency and payout timing requirements. VICEHUB does not collect or store bank account credentials.</li>
      </ul>
      <h2>3. Eligibility and prohibited activity</h2>
      <ul>
        <li>The referred customer must be a genuinely new VICEHUB subscriber and must use a valid referral link before checkout.</li>
        <li>Self-referrals, duplicate accounts, false identities, automated sign-ups, spam, misleading claims, cookie stuffing and paid search bidding on VICEHUB brand terms are prohibited.</li>
        <li>Referrers must clearly disclose that they may receive a cash commission when sharing their referral link. Do not imply that earnings are guaranteed.</li>
      </ul>
      <h2>4. Refunds, disputes and abuse</h2>
      <p>The commission is conditional on the referred payment remaining valid. VICEHUB may withhold, cancel, reverse or recover pending or available commissions where a payment is refunded, reversed, disputed or associated with suspected abuse. If a commission has already been paid, VICEHUB may offset the amount against future commissions or pursue recovery where legally permitted. Accounts involved in abuse may be suspended from the programme.</p>
      <h2>5. No earnings guarantee</h2>
      <p>There is no guaranteed income. Results depend on genuine referrals who independently choose to purchase a membership. The programme is one-level only; no commission is paid on referrals made by your referrals.</p>
      <h2>6. Changes and contact</h2>
      <p>VICEHUB may amend or suspend the programme where reasonably necessary, including to prevent abuse or comply with law. The terms in force at the time of the qualifying referral apply, subject to applicable consumer law.</p>
      <p className="vh-terms-note">This programme pays cash referral commissions. It does not create an employment, worker, agency or partnership relationship and does not guarantee income. Affiliates must provide accurate information to Stripe, complete identity and payout verification, and remain responsible for tax declarations and any registration or reporting obligations applicable to them. Payout availability, bank settlement times and fees may depend on Stripe, the receiving country and the financial institution. The minimum payout is £25 / €25 / $25 in the corresponding currency. These terms apply subject to mandatory consumer, tax and other applicable laws.</p>
      <Link to="/dashboard" className="fh-btn solid big">Back to creator dashboard</Link>
    </article>
  </SiteFrame>;
}
