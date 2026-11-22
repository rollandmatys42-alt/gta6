import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";

const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const safeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
async function verifyStripeSignature(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map(part => part.trim().split("=", 2)));
  const timestamp = Number(parts.t);
  const signatures = header.split(",").map(part => part.trim()).filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + rawBody)));
  return signatures.some(signature => safeEqual(signature, digest));
}
function localStatus(status) {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "cancelled";
  return "inactive";
}
async function stripeRequest(path, method = "GET", form = null) {
  const key = secrets.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: { Authorization: "Bearer " + key, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    ...(form ? { body: form.toString() } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "Stripe API request failed.");
  return body;
}
const stripeGet = path => stripeRequest(path);
async function applyLoyaltyRenewal(db, stripeSub) {
  const rows = await db.UserSubscription.filter({ stripe_subscription_id: stripeSub.id }, "-created_date", 1, 0);
  const local = rows[0];
  if (!local || local.voluntary_cancelled || stripeSub.cancel_at_period_end || stripeSub.status !== "active") return;
  const plans = await db.SubscriptionPlan.filter({ tier_code: local.tier_code, currency: local.currency, status: "active" }, "-created_date", 1, 0);
  const plan = plans[0];
  if (!plan) return;
  const streakMonths = Number(local.streak_months || 0) + 1;
  const discount = Math.min(Number(plan.loyalty_max_discount_percent || 0), streakMonths * Number(plan.loyalty_monthly_discount_percent || 0));
  const nextPrice = Math.max(Number(plan.loyalty_floor_price_cents || 0), Math.round(Number(plan.monthly_price_cents || 0) * (1 - discount / 100)));
  if (nextPrice <= 0) return;
  const item = stripeSub.items?.data?.[0];
  if (item?.id && item?.price?.product && Number(item.price.unit_amount) !== nextPrice) {
    const form = new URLSearchParams();
    form.set("price_data[currency]", String(local.currency || "USD").toLowerCase());
    form.set("price_data[product]", typeof item.price.product === "string" ? item.price.product : item.price.product.id);
    form.set("price_data[recurring][interval]", item.price.recurring?.interval || "month");
    form.set("price_data[unit_amount]", String(nextPrice));
    form.set("proration_behavior", "none");
    await stripeRequest("subscription_items/" + encodeURIComponent(item.id), "POST", form);
  }
  await db.UserSubscription.update(local.id, { streak_months: streakMonths, loyalty_discount_percent: discount, current_monthly_price_cents: nextPrice });
}
async function saveInvoiceLedger(db, invoice, status, eventId) {
  const invoiceId = invoice.id;
  if (!invoiceId) return;
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || "";
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || "";
  const subscriptions = subscriptionId ? await db.UserSubscription.filter({ stripe_subscription_id: subscriptionId }, "-created_date", 1, 0) : [];
  const linePeriod = invoice.lines?.data?.[0]?.period || {};
  const taxRows = invoice.total_taxes || invoice.total_tax_amounts || [];
  const taxCents = taxRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const payload = {
    stripe_invoice_id: invoiceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    user_id: subscriptions[0]?.user_id || "",
    customer_email: invoice.customer_email || invoice.customer_details?.email || "",
    currency: String(invoice.currency || "gbp").toUpperCase(),
    amount_paid_cents: Number(invoice.amount_paid || 0),
    amount_due_cents: Number(invoice.amount_due || 0),
    tax_cents: taxCents,
    refund_amount_cents: 0,
    status,
    billing_reason: invoice.billing_reason || "",
    ...(linePeriod.start ? { period_start: new Date(linePeriod.start * 1000).toISOString() } : {}),
    ...(linePeriod.end ? { period_end: new Date(linePeriod.end * 1000).toISOString() } : {}),
    ...(invoice.status_transitions?.paid_at ? { paid_at: new Date(invoice.status_transitions.paid_at * 1000).toISOString() } : {}),
    ...(invoice.invoice_pdf ? { invoice_pdf_url: invoice.invoice_pdf } : {}),
    ...(invoice.hosted_invoice_url ? { hosted_invoice_url: invoice.hosted_invoice_url } : {}),
    source_event_id: eventId,
  };
  const existing = await db.PaymentLedgerEntry.filter({ stripe_invoice_id: invoiceId }, "-created_date", 1, 0);
  if (existing[0]) return db.PaymentLedgerEntry.update(existing[0].id, payload);
  return db.PaymentLedgerEntry.create(payload);
}
async function saveStripeSubscription(db, stripeSub, fallback = {}) {
  const userId = stripeSub.metadata?.user_id || fallback.user_id;
  const tierCode = stripeSub.metadata?.tier_code || fallback.tier_code;
  if (!userId || !["starter", "pro", "premium"].includes(tierCode)) return false;
  const rows = await db.UserSubscription.filter({ stripe_subscription_id: stripeSub.id }, "-created_date", 1, 0);
  const existing = rows[0] || (await db.UserSubscription.filter({ user_id: userId }, "-created_date", 1, 0))[0];
  const status = localStatus(stripeSub.status);
  const item = stripeSub.items?.data?.[0];
  const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer?.id;
  const currency = (item?.price?.currency || fallback.currency || "usd").toUpperCase();
  const startedAt = stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000).toISOString() : new Date().toISOString();
  const resetStreak = !!existing && existing.stripe_subscription_id !== stripeSub.id;
  const payload = {
    user_id: userId, tier_code: tierCode, status, currency, started_at: startedAt,
    streak_months: resetStreak ? 0 : Number(existing?.streak_months || 0),
    stripe_customer_id: customerId, stripe_subscription_id: stripeSub.id,
    current_monthly_price_cents: Number(item?.price?.unit_amount || fallback.price_cents || 0),
    loyalty_discount_percent: Number(stripeSub.metadata?.discount_percent || fallback.discount_percent || 0),
    voluntary_cancelled: !!stripeSub.cancel_at_period_end || stripeSub.status === "canceled",
    ...(stripeSub.cancel_at ? { cancelled_at: new Date(stripeSub.cancel_at * 1000).toISOString() } : {}),
  };
  if (existing) await db.UserSubscription.update(existing.id, payload);
  else await db.UserSubscription.create({ ...payload, streak_months: 0 });
  return true;
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const signingSecret = secrets.get("STRIPE_WEBHOOK_SECRET");
        if (!signingSecret) return Response.json({ error: "Webhook signing secret is not configured." }, { status: 503 });
        const signature = request.headers.get("stripe-signature") || "";
        const rawBody = await request.text();
        if (!(await verifyStripeSignature(rawBody, signature, signingSecret))) {
          return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
        }
        let event;
        try { event = JSON.parse(rawBody); }
        catch { return Response.json({ error: "Invalid event JSON." }, { status: 400 }); }
        try {
          const db = context.getBase44().asServiceRole.entities;
          const seen = await db.StripeWebhookEvent.filter({ event_id: event.id }, "-created_date", 1, 0);
          if (seen.length) return Response.json({ received: true, duplicate: true });
          const object = event.data?.object || {};
          if (event.type === "checkout.session.completed" && object.mode === "subscription" && object.subscription) {
            const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription.id;
            const stripeSub = await stripeGet("subscriptions/" + encodeURIComponent(subscriptionId));
            await saveStripeSubscription(db, stripeSub, {
              user_id: object.metadata?.user_id || object.client_reference_id,
              tier_code: object.metadata?.tier_code,
              currency: object.metadata?.currency,
              price_cents: Number(object.metadata?.monthly_price_cents || 0),
              discount_percent: Number(object.metadata?.discount_percent || 0),
            });
          } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
            await saveStripeSubscription(db, object);
          } else if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
            let subscriptionId = object.subscription || object.parent?.subscription_details?.subscription;
            if (typeof subscriptionId === "object") subscriptionId = subscriptionId.id;
            if (subscriptionId) {
              const stripeSub = await stripeGet("subscriptions/" + encodeURIComponent(subscriptionId));
              await saveStripeSubscription(db, stripeSub);
              if (event.type === "invoice.paid") await applyLoyaltyRenewal(db, stripeSub);
            }
            await saveInvoiceLedger(db, object, event.type === "invoice.paid" ? "paid" : "failed", event.id);
          } else if (event.type === "charge.refunded" && object.invoice) {
            const invoiceId = typeof object.invoice === "string" ? object.invoice : object.invoice.id;
            const rows = await db.PaymentLedgerEntry.filter({ stripe_invoice_id: invoiceId }, "-created_date", 1, 0);
            if (rows[0]) await db.PaymentLedgerEntry.update(rows[0].id, {
              status: Number(object.amount_refunded || 0) >= Number(object.amount || 0) ? "refunded" : rows[0].status,
              refund_amount_cents: Number(object.amount_refunded || 0),
              source_event_id: event.id,
            });
          }
          await db.StripeWebhookEvent.create({ event_id: event.id, event_type: event.type, processed_at: new Date().toISOString() });
          return Response.json({ received: true });
        } catch (error) {
          return Response.json({ error: error?.message || "Webhook processing failed." }, { status: 500 });
        }
      },
    },
  },
});
