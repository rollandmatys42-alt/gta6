import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { secrets } from "base44:runtime";
import { requireUser } from "@/lib/auth-middleware";

const SITE_URL = "https://gta6-creator-hub-c26cc578.base44.app";
const MIN_PAYOUT_CENTS = { GBP: 2500, EUR: 2500, USD: 2500 };
const currencies = ["GBP", "EUR", "USD"];
const dbFor = context => context.getBase44().asServiceRole.entities;
const requireAdmin = context => {
  if (context.user?.role !== "admin") throw Object.assign(new Error("Administrator access is required."), { status: 403 });
};
async function stripe(path, method = "GET", form = null, idempotencyKey = "") {
  const key = secrets.get("STRIPE_SECRET_KEY");
  if (!key) throw Object.assign(new Error("Stripe is not configured."), { status: 503 });
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method, headers: { Authorization: "Bearer " + key, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    ...(form ? { body: form.toString() } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error?.message || "Stripe request failed."), { status: response.status, code: body?.error?.code || "STRIPE_ERROR" });
  return body;
}
async function ensureProfile(db, userId) {
  const rows = await db.ReferralProfile.filter({ user_id: userId }, "-created_date", 1, 0);
  if (rows[0]) return rows[0];
  let code = "";
  for (let i = 0; i < 8; i++) {
    const candidate = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    if (!(await db.ReferralProfile.filter({ referral_code: candidate }, "-created_date", 1, 0)).length) { code = candidate; break; }
  }
  if (!code) throw new Error("Could not generate a unique referral code.");
  return db.ReferralProfile.create({ user_id: userId, referral_code: code, status: "active", stripe_connect_status: "not_started", payouts_enabled: false });
}
async function unlockMaturedCredits(db, credits) {
  const now = Date.now();
  for (const credit of credits) {
    if (credit.status === "pending" && credit.available_at && new Date(credit.available_at).getTime() <= now) {
      await db.ReferralCredit.update(credit.id, { status: "available" });
      credit.status = "available";
    }
  }
}
export const getMyAffiliateDashboard = createServerFn({ method: "GET" }).middleware([requireUser]).handler(async ({ context }) => {
  const db = dbFor(context), user = context.user, profile = await ensureProfile(db, user.id);
  const [credits, requests] = await Promise.all([
    db.ReferralCredit.filter({ referrer_user_id: user.id }, "-created_date", 2000, 0),
    db.AffiliatePayoutRequest.filter({ user_id: user.id }, "-created_date", 100, 0),
  ]);
  await unlockMaturedCredits(db, credits);
  const balances = Object.fromEntries(currencies.map(c => [c, { pendingCents: 0, availableCents: 0, reservedCents: 0, paidCents: 0, earnedCents: 0 }]));
  for (const credit of credits) {
    const currency = String(credit.currency || "GBP").toUpperCase();
    if (!balances[currency] || credit.status === "reversed") continue;
    const b = balances[currency];
    b.earnedCents += Number(credit.amount_cents || 0);
    if (credit.status === "pending") b.pendingCents += Number(credit.available_cents ?? credit.amount_cents ?? 0);
    if (credit.status === "available") b.availableCents += Number(credit.available_cents ?? 0);
    if (credit.status === "reserved") b.reservedCents += Number(credit.reserved_cents ?? credit.available_cents ?? 0);
    if (credit.status === "paid") b.paidCents += Number(credit.paid_cents ?? credit.amount_cents ?? 0);
  }
  let connect = { status: profile.stripe_connect_status || "not_started", payoutsEnabled: !!profile.payouts_enabled, accountId: profile.stripe_connect_account_id || "" };
  if (profile.stripe_connect_account_id) {
    try {
      const account = await stripe("accounts/" + encodeURIComponent(profile.stripe_connect_account_id));
      connect = { ...connect, status: account.payouts_enabled ? "active" : account.details_submitted ? "under_review" : "onboarding", payoutsEnabled: !!account.payouts_enabled, defaultCurrency: String(account.default_currency || "").toUpperCase(), requirementsDue: account.requirements?.currently_due || [] };
      await db.ReferralProfile.update(profile.id, { stripe_connect_status: connect.status, payouts_enabled: connect.payoutsEnabled });
    } catch {}
  }
  return { code: profile.referral_code, referralCount: credits.filter(c => c.status !== "reversed").length, balances, requests, connect, minimumPayoutCents: MIN_PAYOUT_CENTS };
});
export const startAffiliatePayoutOnboarding = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ country: z.enum(["GB", "FR", "IE", "DE", "ES", "IT", "NL", "BE", "LU", "US", "CA"]) }))
  .handler(async ({ data, context }) => {
    const db = dbFor(context), profile = await ensureProfile(db, context.user.id);
    let accountId = profile.stripe_connect_account_id;
    if (!accountId) {
      const form = new URLSearchParams();
      form.set("type", "express"); form.set("country", data.country); form.set("email", context.user.email || "");
      form.set("capabilities[transfers][requested]", "true");
      form.set("business_type", "individual");
      form.set("metadata[vicehub_user_id]", context.user.id);
      form.set("metadata[referral_profile_id]", profile.id);
      const account = await stripe("accounts", "POST", form, "affiliate-connect-" + context.user.id);
      accountId = account.id;
      await db.ReferralProfile.update(profile.id, { stripe_connect_account_id: accountId, payout_country: data.country, stripe_connect_status: "onboarding", payouts_enabled: false });
    }
    const link = new URLSearchParams();
    link.set("account", accountId); link.set("refresh_url", SITE_URL + "/dashboard?affiliate=refresh"); link.set("return_url", SITE_URL + "/dashboard?affiliate=return"); link.set("type", "account_onboarding");
    const accountLink = await stripe("account_links", "POST", link);
    return { url: accountLink.url };
  });
export const requestAffiliatePayout = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ currency: z.enum(["GBP", "EUR", "USD"]) }))
  .handler(async ({ data, context }) => {
    const db = dbFor(context), profile = await ensureProfile(db, context.user.id);
    if (!profile.stripe_connect_account_id) throw Object.assign(new Error("Complete Stripe payout onboarding first."), { status: 409 });
    const account = await stripe("accounts/" + encodeURIComponent(profile.stripe_connect_account_id));
    if (!account.payouts_enabled || account.capabilities?.transfers !== "active") throw Object.assign(new Error("Stripe has not enabled payouts for this account yet. Complete any outstanding verification steps."), { status: 409 });
    if (String(account.default_currency || "").toUpperCase() !== data.currency) throw Object.assign(new Error("This Stripe payout account settles in " + String(account.default_currency || "an unsupported currency").toUpperCase() + ". Request a payout in that currency."), { status: 409 });
    const open = await db.AffiliatePayoutRequest.filter({ user_id: context.user.id, currency: data.currency, status: { $in: ["requested", "processing", "failed"] } }, "-created_date", 1, 0);
    if (open.length) throw Object.assign(new Error("A payout request for this currency is already awaiting processing."), { status: 409 });
    const credits = await db.ReferralCredit.filter({ referrer_user_id: context.user.id, currency: data.currency, status: "available" }, "created_date", 2000, 0);
    const allocations = credits.map(c => ({ credit_id: c.id, amount_cents: Number(c.available_cents ?? c.amount_cents ?? 0) })).filter(x => x.amount_cents > 0);
    const amountCents = allocations.reduce((sum, x) => sum + x.amount_cents, 0);
    if (amountCents < MIN_PAYOUT_CENTS[data.currency]) throw Object.assign(new Error("Your available balance has not reached the minimum payout threshold."), { status: 409 });
    const reserved = [];
    try {
      for (const item of allocations) {
        const result = await db.ReferralCredit.updateMany({ id: item.credit_id, status: "available", available_cents: item.amount_cents }, { $set: { status: "reserved", available_cents: 0, reserved_cents: item.amount_cents } });
        if (!result?.updated) throw new Error("A commission changed while the payout was being requested. Refresh your balance and try again.");
        reserved.push(item);
      }
      const payout = await db.AffiliatePayoutRequest.create({ user_id: context.user.id, amount_cents: amountCents, currency: data.currency, status: "requested", connected_account_id: profile.stripe_connect_account_id, allocations: reserved, idempotency_key: "affiliate-payout-" + crypto.randomUUID() });
      return { success: true, payout };
    } catch (error) {
      for (const item of reserved) {
        const row = await db.ReferralCredit.get(item.credit_id).catch(() => null);
        if (row?.status === "reserved") await db.ReferralCredit.update(row.id, { status: "available", available_cents: item.amount_cents, reserved_cents: 0 }).catch(() => null);
      }
      throw error;
    }
  });
export const getAdminAffiliateData = createServerFn({ method: "GET" }).middleware([requireUser]).handler(async ({ context }) => {
  requireAdmin(context);
  const db = dbFor(context);
  const [profiles, credits, payouts, users] = await Promise.all([
    db.ReferralProfile.list("-created_date", 2000, 0), db.ReferralCredit.list("-created_date", 5000, 0),
    db.AffiliatePayoutRequest.list("-created_date", 2000, 0), db.User.list("-created_date", 5000, 0),
  ]);
  const userMap = Object.fromEntries(users.map(u => [u.id, { id: u.id, email: u.email, name: u.full_name || u.name || u.email }]));
  const enrichedProfiles = profiles.map(p => ({ ...p, user: userMap[p.user_id] || { id: p.user_id, email: "Unknown member" } }));
  const enrichedCredits = credits.map(c => ({ ...c, referrer: userMap[c.referrer_user_id], referred: userMap[c.referred_user_id] }));
  const enrichedPayouts = payouts.map(p => ({ ...p, user: userMap[p.user_id] }));
  const summary = Object.fromEntries(currencies.map(c => [c, { pending: 0, available: 0, reserved: 0, paid: 0, payoutRequests: 0 }]));
  for (const c of credits) {
    const b = summary[String(c.currency || "GBP").toUpperCase()]; if (!b || c.status === "reversed") continue;
    if (c.status === "pending") b.pending += Number(c.available_cents ?? c.amount_cents ?? 0);
    if (c.status === "available") b.available += Number(c.available_cents ?? 0);
    if (c.status === "reserved") b.reserved += Number(c.reserved_cents ?? 0);
    if (c.status === "paid") b.paid += Number(c.paid_cents ?? c.amount_cents ?? 0);
  }
  for (const p of payouts) if (summary[p.currency] && ["requested", "processing", "failed"].includes(p.status)) summary[p.currency].payoutRequests += Number(p.amount_cents || 0);
  return { profiles: enrichedProfiles, credits: enrichedCredits, payouts: enrichedPayouts, summary, minimumPayoutCents: MIN_PAYOUT_CENTS };
});
export const processAffiliatePayout = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ payoutId: z.string().min(1), action: z.enum(["send", "reject"]), adminNote: z.string().max(1000).optional() }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = dbFor(context), payout = await db.AffiliatePayoutRequest.get(data.payoutId);
    if (!payout || !["requested", "failed"].includes(payout.status)) throw Object.assign(new Error("This payout is no longer awaiting an administrative decision."), { status: 409 });
    if (data.action === "reject") {
      if (payout.stripe_transfer_id) throw Object.assign(new Error("A Stripe transfer already exists for this request. It cannot be rejected; reconcile the transfer instead."), { status: 409 });
      for (const allocation of payout.allocations || []) {
        const credit = await db.ReferralCredit.get(allocation.credit_id);
        if (credit?.status === "reserved") await db.ReferralCredit.update(credit.id, { status: "available", available_cents: Number(credit.reserved_cents || allocation.amount_cents), reserved_cents: 0 });
      }
      await db.AffiliatePayoutRequest.update(payout.id, { status: "rejected", admin_note: data.adminNote || "", processed_by: context.user.id, processed_at: new Date().toISOString() });
      await db.AdminAuditLog.create({ actor_user_id: context.user.id, actor_email: context.user.email || "", action: "affiliate_payout_rejected", target_type: "AffiliatePayoutRequest", target_id: payout.id, summary: "Rejected affiliate payout " + payout.amount_cents + " " + payout.currency, metadata_json: JSON.stringify({ user_id: payout.user_id, amount_cents: payout.amount_cents, currency: payout.currency, note: data.adminNote || "" }) }).catch(() => null);
      return { success: true, status: "rejected" };
    }
    await db.AffiliatePayoutRequest.update(payout.id, { status: "processing", admin_note: data.adminNote || payout.admin_note || "" });
    try {
      const connected = await stripe("accounts/" + encodeURIComponent(payout.connected_account_id));
      if (!connected.payouts_enabled || connected.capabilities?.transfers !== "active") throw new Error("The connected Stripe account is not enabled to receive transfers.");
      const form = new URLSearchParams();
      form.set("amount", String(payout.amount_cents)); form.set("currency", String(payout.currency).toLowerCase());
      form.set("destination", payout.connected_account_id); form.set("description", "VICEHUB affiliate commission payout");
      form.set("metadata[affiliate_payout_request_id]", payout.id); form.set("metadata[affiliate_user_id]", payout.user_id);
      for (const allocation of payout.allocations || []) {
        const credit = await db.ReferralCredit.get(allocation.credit_id);
        if (!credit) throw new Error("A commission linked to this payout no longer exists.");
        if (credit.status === "paid" && Number(credit.paid_cents || 0) >= Number(allocation.amount_cents)) continue;
        if (credit.status !== "reserved" || Number(credit.reserved_cents || 0) < Number(allocation.amount_cents)) throw new Error("A reserved commission was changed or reversed. No transfer was sent; reject this payout request and reconcile its allocations.");
      }
      const transfer = payout.stripe_transfer_id
        ? await stripe("transfers/" + encodeURIComponent(payout.stripe_transfer_id))
        : await stripe("transfers", "POST", form, payout.idempotency_key);
      await db.AffiliatePayoutRequest.update(payout.id, { status: "processing", stripe_transfer_id: transfer.id, admin_note: data.adminNote || payout.admin_note || "" });
      for (const allocation of payout.allocations || []) {
        const credit = await db.ReferralCredit.get(allocation.credit_id);
        if (credit.status === "paid" && Number(credit.paid_cents || 0) >= Number(allocation.amount_cents)) continue;
        await db.ReferralCredit.update(credit.id, { status: "paid", reserved_cents: 0, available_cents: 0, paid_cents: Number(credit.paid_cents || 0) + Number(allocation.amount_cents) });
      }
      await db.AffiliatePayoutRequest.update(payout.id, { status: "sent", stripe_transfer_id: transfer.id, processed_by: context.user.id, processed_at: new Date().toISOString(), admin_note: data.adminNote || "" });
      await db.AdminAuditLog.create({ actor_user_id: context.user.id, actor_email: context.user.email || "", action: "affiliate_payout_sent", target_type: "AffiliatePayoutRequest", target_id: payout.id, summary: "Sent affiliate transfer " + payout.amount_cents + " " + payout.currency, metadata_json: JSON.stringify({ user_id: payout.user_id, amount_cents: payout.amount_cents, currency: payout.currency, stripe_transfer_id: transfer.id }) }).catch(() => null);
      return { success: true, status: "sent", transferId: transfer.id };
    } catch (error) {
      await db.AffiliatePayoutRequest.update(payout.id, { status: "failed", admin_note: String(error?.message || error).slice(0, 1000), processed_by: context.user.id, processed_at: new Date().toISOString() });
      throw error;
    }
  });
