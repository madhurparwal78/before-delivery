export type PlanId = "launch-page" | "studio-site" | "care-lite" | "care-plus";
export type CareTier = "lite" | "plus";

export interface PlanDefinition {
  readonly id: PlanId;
  readonly name: string;
  readonly kind: "build" | "care";
  readonly tier: CareTier | null;
}

export const PLANS: readonly PlanDefinition[] = [
  { id: "launch-page", name: "Launch Page", kind: "build", tier: null },
  { id: "studio-site", name: "Studio Site", kind: "build", tier: null },
  { id: "care-lite", name: "Care Lite", kind: "care", tier: "lite" },
  { id: "care-plus", name: "Care Plus", kind: "care", tier: "plus" },
];

export function isPlanId(value: unknown): value is PlanId {
  return PLANS.some((plan) => plan.id === value);
}

function planDefinition(id: PlanId): PlanDefinition {
  const found = PLANS.find((plan) => plan.id === id);
  if (!found) throw new Error(`unknown plan ${id}`);
  return found;
}

export function planName(id: PlanId): string {
  return planDefinition(id).name;
}

export function isCarePlan(id: PlanId): boolean {
  return planDefinition(id).kind === "care";
}

export function carePlanId(tier: CareTier): PlanId {
  return tier === "lite" ? "care-lite" : "care-plus";
}

export function careTierOf(id: PlanId): CareTier {
  const tier = planDefinition(id).tier;
  if (!tier) throw new Error(`plan ${id} is not a care plan`);
  return tier;
}
