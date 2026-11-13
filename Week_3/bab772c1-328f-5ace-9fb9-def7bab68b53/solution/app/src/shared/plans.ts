/** The Archive plan catalogue as the app knows it: labels, prices in cents and quotas. */

import { formatMoney, monthlyCents } from "./sizes.js";
import type { PlanId } from "./model.js";

type PlanDefinition = {
  plan: PlanId;
  label: string;
  price_cents: number;
  period: "month" | "year";
  quota_bytes: number;
};

export const PLANS: readonly PlanDefinition[] = [
  {
    plan: "archive-free",
    label: "Free",
    price_cents: 0,
    period: "month",
    quota_bytes: 268_435_456,
  },
  {
    plan: "archive-1",
    label: "Archive 1 GiB",
    price_cents: 400,
    period: "month",
    quota_bytes: 1_073_741_824,
  },
  {
    plan: "archive-10-annual",
    label: "Archive 10 GiB",
    price_cents: 28_800,
    period: "year",
    quota_bytes: 10_737_418_240,
  },
];

export const DEFAULT_PLAN: PlanId = "archive-free";

export function planDefinition(plan: PlanId): PlanDefinition {
  const found = PLANS.find((candidate) => candidate.plan === plan);
  if (!found) {
    throw new Error(`unknown plan ${plan}`);
  }
  return found;
}

export function isPlanId(value: unknown): value is PlanId {
  return PLANS.some((candidate) => candidate.plan === value);
}

/** `<plan price>`. */
export function planPrice(definition: PlanDefinition): string {
  if (definition.price_cents === 0) {
    return "Free";
  }
  if (definition.period === "month") {
    return `${formatMoney(definition.price_cents)} USD/month`;
  }
  const monthly = formatMoney(monthlyCents(definition.price_cents));
  return `${monthly} USD/month, billed ${formatMoney(definition.price_cents)} USD yearly`;
}
