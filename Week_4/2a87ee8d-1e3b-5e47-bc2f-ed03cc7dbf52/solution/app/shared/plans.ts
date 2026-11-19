// Plans, prices, entitlements and the plan-change policy. Money is held as exact decimal strings.

export const PLANS = ["free", "studio", "agency"] as const;
export type Plan = (typeof PLANS)[number];
export const TERMS = ["monthly", "annual"] as const;
export type Term = (typeof TERMS)[number];

export const PLAN_LABELS: Record<Plan, string> = { free: "Free", studio: "Studio", agency: "Agency" };
export const TERM_LABELS: Record<Term, string> = { monthly: "Monthly", annual: "Annual" };

/** Prices in euros, billed in advance. Free has no annual term. */
export const PRICES: Record<Plan, Partial<Record<Term, string>>> = {
  free: { monthly: "0.00" },
  studio: { monthly: "24.00", annual: "230.40" },
  agency: { monthly: "59.00", annual: "566.40" },
};

export interface Entitlements {
  activeWorkshops: number | null;
  participantsPerWorkshop: number;
  silentRoundsPerWorkshop: number | null;
  invitesPerDay: number;
  recapScale: number;
}

export const ENTITLEMENTS: Record<Plan, Entitlements> = {
  free: { activeWorkshops: 3, participantsPerWorkshop: 8, silentRoundsPerWorkshop: 1, invitesPerDay: 20, recapScale: 1 },
  studio: { activeWorkshops: 20, participantsPerWorkshop: 30, silentRoundsPerWorkshop: null, invitesPerDay: 200, recapScale: 2 },
  agency: { activeWorkshops: null, participantsPerWorkshop: 50, silentRoundsPerWorkshop: null, invitesPerDay: 1000, recapScale: 2 },
};

const RANK: Record<Plan, number> = { free: 0, studio: 1, agency: 2 };

export function hasTerm(plan: Plan, term: Term): boolean {
  return PRICES[plan][term] !== undefined;
}

/** A change is immediate when the plan rises, or the plan stays and the term goes from monthly to annual. */
export function isImmediateChange(from: { plan: Plan; term: Term }, to: { plan: Plan; term: Term }): boolean {
  if (RANK[to.plan] !== RANK[from.plan]) return RANK[to.plan] > RANK[from.plan];
  return from.term === "monthly" && to.term === "annual";
}

export function planCode(plan: Plan, term: Term): string {
  return `${plan}-${term}`;
}
