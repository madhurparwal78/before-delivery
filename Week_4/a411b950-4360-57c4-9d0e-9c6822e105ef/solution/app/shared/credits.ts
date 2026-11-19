export const CREDIT_TYPES = ["shipped", "jam", "redesign"] as const;
export type CreditType = (typeof CREDIT_TYPES)[number];

export const CREDIT_LABELS: Record<CreditType, string> = {
  shipped: "Shipped title",
  jam: "Game jam",
  redesign: "Redesign",
};

export const LAYERS = ["bed", "pulse", "lead", "stinger"] as const;
export type Layer = (typeof LAYERS)[number];
