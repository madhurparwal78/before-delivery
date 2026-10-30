// Plans and prices (Business rules › Plans and prices), in integer cents.
import type { Period, Plan } from "./api-types.js";

interface PlanTerms { name: string; includedSeats: number; tokenLimit: number; prices: Record<Period, { base: number; seat: number }> }

export const PLAN_CATALOG: Record<Plan, PlanTerms> = {
  team: { name: "Team", includedSeats: 8, tokenLimit: 5, prices: { monthly: { base: 9600, seat: 1200 }, annual: { base: 96000, seat: 12000 } } },
  business: { name: "Business", includedSeats: 20, tokenLimit: 25, prices: { monthly: { base: 38000, seat: 1600 }, annual: { base: 380000, seat: 16000 } } },
};

/** The trial is the Team plan with 8 seats. */
export const TRIAL_SEATS = 8;
