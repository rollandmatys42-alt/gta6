// Degressive loyalty ladder. Pure functions, shared by server and UI.
// Month 1-3: ladder[0], 4-6: ladder[1], 7-9: ladder[2], 10+: ladder[3] (last step stays forever).
// A voluntary cancellation + resubscription creates a new Stripe subscription => paid months restart at 0.
export const DEFAULT_LADDER_CENTS = [4999, 3999, 2999, 999];
export const DEFAULT_STEP_MONTHS = 3;

export function getLadder(plan) {
  const raw = Array.isArray(plan?.price_ladder_cents) ? plan.price_ladder_cents.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  if (raw.length) return raw;
  // Preserve existing plan pricing until an administrator explicitly saves a ladder.
  const basePrice = Number(plan?.monthly_price_cents);
  return [Number.isInteger(basePrice) && basePrice > 0 ? basePrice : DEFAULT_LADDER_CENTS[0]];
}
export function getStepMonths(plan) {
  const n = Number(plan?.ladder_step_months);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_STEP_MONTHS;
}
// billingMonth is 1-based: the month about to be charged.
export function priceForMonth(plan, billingMonth) {
  const ladder = getLadder(plan);
  const month = Math.max(1, Math.floor(Number(billingMonth) || 1));
  const step = Math.min(ladder.length - 1, Math.floor((month - 1) / getStepMonths(plan)));
  return ladder[step];
}
// Full schedule for display: [{fromMonth, toMonth|null, priceCents}]
export function ladderSchedule(plan) {
  const ladder = getLadder(plan), n = getStepMonths(plan);
  return ladder.map((priceCents, i) => ({ fromMonth: i * n + 1, toMonth: i === ladder.length - 1 ? null : (i + 1) * n, priceCents }));
}
export const formatMoney = (cents, currency = "USD") => new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
