import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { priceForMonth, ladderSchedule } from "@/lib/loyalty";

function requireAdmin(context) {
  if (context.user?.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
}

// Quote for the signed-in fan: price of the next charge on the degressive ladder.
export const getMyLadderQuote = createServerFn({ method: "GET" }).middleware([requireUser])
  .validator(z.object({ tierCode: z.enum(["starter", "pro", "premium"]), currency: z.enum(["USD", "EUR", "GBP"]) }))
  .handler(async ({ data, context }) => {
    const db = context.getBase44().asServiceRole.entities;
    const plan = (await db.SubscriptionPlan.filter({ tier_code: data.tierCode, currency: data.currency, status: "active" }, "-created_date", 1, 0))[0];
    if (!plan) throw Object.assign(new Error("This plan is not configured in the selected currency."), { status: 404 });
    const sub = (await db.UserSubscription.filter({ user_id: context.user.id }, "-created_date", 1, 0))[0];
    const active = (sub?.status === "active" || (sub?.status === "past_due" && sub?.grace_period_ends_at && new Date(sub.grace_period_ends_at) > new Date())) && !sub?.voluntary_cancelled;
    const samePlan = sub?.tier_code === data.tierCode && sub?.currency === data.currency;
    const streak = active && samePlan ? Number(sub?.streak_months || 0) : 0;
    return { tierCode: data.tierCode, currency: data.currency, currentPriceCents: priceForMonth(plan, streak + 1), nextChargeMonth: streak + 1, streakMonths: streak, schedule: ladderSchedule(plan), resetOnVoluntaryCancellation: true };
  });

export const getAdminLadderPlans = createServerFn({ method: "GET" }).middleware([requireUser]).handler(async ({ context }) => {
  requireAdmin(context);
  return context.getBase44().asServiceRole.entities.SubscriptionPlan.list("sort_order", 100, 0);
});

// Admin: set the degressive ladder. Step 1 price is also the Stripe checkout price (monthly_price_cents).
export const saveAdminPlanLadder = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ id: z.string().min(1), priceLadderCents: z.array(z.number().int().min(1)).min(1).max(8), ladderStepMonths: z.number().int().min(1).max(12) }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities.SubscriptionPlan;
    const existing = await db.get(data.id);
    if (data.priceLadderCents.some((price, index) => index > 0 && price > data.priceLadderCents[index - 1])) {
      throw Object.assign(new Error("Each loyalty step must be equal to or cheaper than the previous step."), { status: 400, code: "INVALID_PRICE_LADDER" });
    }
    const first = data.priceLadderCents[0];
    return db.update(data.id, { price_ladder_cents: data.priceLadderCents, ladder_step_months: data.ladderStepMonths, monthly_price_cents: first, ...(existing && Number(existing.monthly_price_cents) !== first ? { stripe_price_id: null } : {}) });
  });
