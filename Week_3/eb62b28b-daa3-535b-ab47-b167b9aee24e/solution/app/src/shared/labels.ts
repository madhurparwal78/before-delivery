// The published option labels.

import type { Flag } from "./api";

export const FLAG_LABEL: Record<Flag, string> = {
  belowRange: "Below range",
  inRange: "In range",
  optimal: "Optimal",
  aboveRange: "Above range",
};

export const CADENCE_LABEL = { sixMonths: "Every 6 months", yearly: "Yearly" } as const;
export const MEMBERSHIP_LABEL = { free: "Free", pending: "Plus · Pending", active: "Plus · Active", cancelled: "Plus · Ending" } as const;
export const DRAW_STATE_LABEL = { booked: "Booked", collected: "Collected", ready: "Ready", released: "Released", cancelled: "Cancelled" } as const;
export const ACCOUNT_STATE_LABEL = { active: "Active", closing: "Closing", erasing: "Erasing", erased: "Erased" } as const;
export const ROLE_LABEL = { owner: "Practice owner", specialist: "Longevity specialist", coordinator: "Care coordinator", billingLead: "Billing lead", member: "Member" } as const;
export const AGE_BAND_LABEL = { age18To39: "18–39", age40To59: "40–59", age60Plus: "60 and over" } as const;
export const SEX_LABEL = { female: "Female", male: "Male" } as const;
export const THREAD_STATE_LABEL = { open: "Open", handled: "Handled" } as const;
