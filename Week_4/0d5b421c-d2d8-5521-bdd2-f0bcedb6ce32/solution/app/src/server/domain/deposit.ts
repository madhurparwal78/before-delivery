// The deposit amount and the refund cutoff, each decided once.
import { addMinutes } from "../clock.js";
import { catalog, type Target } from "../catalog.js";

/** 1500 cents a guest for parties of 5 or more, or at Chef's Counter. Walk-ins never come through here. */
export function depositCents(partySize: number, target: Target): number {
  const { deposit_cents_per_cover, deposit_min_party, deposit_rooms } = catalog().rules;
  const inDepositRoom = deposit_rooms.includes(target.roomId);
  return partySize >= deposit_min_party || inDepositRoom ? deposit_cents_per_cover * partySize : 0;
}

export function refundCutoff(startsAt: Date): Date {
  return addMinutes(startsAt, -catalog().rules.refund_cutoff_hours * 60);
}

/** A cancel landing exactly at the cutoff is still refunded. */
export function refundsIfCancelledAt(startsAt: Date, at: Date): boolean {
  return at <= refundCutoff(startsAt);
}

export function noShowAllowedFrom(startsAt: Date): Date {
  return addMinutes(startsAt, catalog().rules.no_show_after_minutes);
}
