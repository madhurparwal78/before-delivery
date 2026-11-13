// Tenant onboarding states and the document cover rule. Suspension is judged on every read from
// the stored onboarding state and the current documents, in this process's kitchen zone.

import type { ClearanceReason, CoverState, Lapse, TenantStatus } from "../shared/api.js";
import { daysBetween } from "../shared/clock.js";

export type Onboarding = "applied" | "documents_pending" | "approved";

export interface CurrentCover {
  insuranceExpiresOn: string | null;
  foodHandlerExpiresOn: string | null;
}

/** Which current document fails to cover a kitchen date (valid through 23:59:59 on expiresOn), insurance first. */
export function lapse(cover: CurrentCover, date: string): Lapse | null {
  if (cover.insuranceExpiresOn === null || cover.insuranceExpiresOn < date) return "insurance_lapsed";
  if (cover.foodHandlerExpiresOn === null || cover.foodHandlerExpiresOn < date) return "food_handler_lapsed";
  return null;
}

export function tenantStatus(onboarding: Onboarding, cover: CurrentCover, today: string): { status: TenantStatus; suspendedReason: Lapse | null } {
  if (onboarding !== "approved") return { status: onboarding, suspendedReason: null };
  const reason = lapse(cover, today);
  return reason ? { status: "suspended", suspendedReason: reason } : { status: "approved", suspendedReason: null };
}

/** Cleared for a kitchen date: approved once (approved or suspended) and both documents cover it. */
export function clearance(onboarding: Onboarding, cover: CurrentCover, date: string): { cleared: boolean; reason: ClearanceReason | null } {
  const reason = onboarding === "approved" ? lapse(cover, date) : "not_approved";
  return { cleared: reason === null, reason };
}

/** applied → documents_pending, automatically once a current document of each kind exists. */
export function afterUpload(onboarding: Onboarding, cover: CurrentCover): Onboarding {
  return onboarding === "applied" && cover.insuranceExpiresOn !== null && cover.foodHandlerExpiresOn !== null
    ? "documents_pending"
    : onboarding;
}

export function asOnboarding(value: string): Onboarding {
  return value === "documents_pending" || value === "approved" ? value : "applied";
}

/** A document's cover state and days left, from the kitchen's today: the first matching line of the brief's list. */
export function coverState(expiresOn: string, current: boolean, today: string): { coverState: CoverState; daysLeft: number | null } {
  if (!current) return { coverState: "superseded", daysLeft: null };
  if (today > expiresOn) return { coverState: "lapsed", daysLeft: null };
  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft === 0) return { coverState: "expires_today", daysLeft };
  return { coverState: daysLeft <= 7 ? "expires_soon" : "ok", daysLeft };
}
