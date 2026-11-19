// The derived counts of the brief's "Counts" rules, computed from what the viewer may see and the
// namespace clock the server states, never from the device clock.

import type { DeskState, Offer } from "./types.js";
import { F, windowClosed, windowOpen } from "./feedback.js";
import { AWAITING_RECEIPT, OPEN } from "./offerStates.js";

export function deskCounts(state: DeskState, clock: string | null) {
  const offers = Object.values(state.offers);
  const today = clock?.slice(0, 10);
  return {
    openOffers: offers.filter((o) => OPEN.includes(o.status)).length,
    awaitingReceipt: offers.filter((o) => AWAITING_RECEIPT.includes(o.status)).length,
    closing: offers.some((o) => OPEN.includes(o.status) && o.closing),
    stock: Object.values(state.specimens).filter((s) => s.owner === "dealer" && s.status !== "transferred" && !s.missing).length,
    cellsFilled: Object.values(state.tray).filter((c) => c?.specimen).length,
    takenInToday: today ? state.events.filter((e) => e.type === "specimen.created" && e.at.slice(0, 10) === today).length : 0,
    pendingRecords: Object.values(state.specimens).filter((s) => s.attribution.register === "pending").length,
  };
}

/** The response-window text for an offer, by status (brief: F_WINDOW, F_WINDOW_ACCEPTED, F_WINDOW_CLOSED). */
export function windowText(offer: Offer): string | null {
  if (offer.expires_at === null) return offer.status === "accepted" ? F.WINDOW_ACCEPTED : null;
  return offer.status === "expired" ? windowClosed(offer.expires_at) : windowOpen(offer.remaining_seconds!, offer.expires_at);
}
