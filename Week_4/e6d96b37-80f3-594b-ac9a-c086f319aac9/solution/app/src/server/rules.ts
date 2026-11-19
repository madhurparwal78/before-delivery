// The desk's domain rules, each decided here and nowhere else: specimen status and eligibility,
// holder fit, offer windows and expiry, album reopening, and step-up freshness.

import { F } from "../shared/feedback.js";
import { CELL_MM } from "../shared/limits.js";
import { OPEN, OUTBOUND, RESPONDING } from "../shared/offerStates.js";
import type { Holder, Party, SpecimenStatus } from "../shared/types.js";
import { config } from "./config.js";
import type { Desk, OfferRecord } from "./desk.js";


export function offerItems(offer: OfferRecord): string[] {
  return [...offer.dealer_items, ...offer.counterpart_items];
}

/** How an offer currently commits a specimen: reserved (open offer or hold), outbound, or not at all. */
function commitment(desk: Desk, key: string, except?: string): { offer: string; kind: "reserved" | "outbound" } | null {
  for (const offer of desk.offers.values()) {
    if (offer.key === except) continue;
    const listed = offerItems(offer).includes(key);
    if (listed && OUTBOUND.includes(offer.status)) return { offer: offer.key, kind: "outbound" };
    if (listed && RESPONDING.includes(offer.status)) return { offer: offer.key, kind: "reserved" };
    if (offer.holds.some((h) => h.specimen === key) && OPEN.includes(offer.status)) return { offer: offer.key, kind: "reserved" };
  }
  return null;
}

export function specimenStatus(desk: Desk, key: string): SpecimenStatus {
  const s = desk.specimen(key);
  if (s.missing) return "missing";
  if (s.transferred) return "transferred";
  const committed = commitment(desk, key);
  if (committed) return committed.kind;
  if (s.quarantined) return "quarantined";
  if (s.attribution.register === "pending") return "pending_catalogue";
  return [...desk.cells.values()].some((c) => c.specimen === key) ? "shelved" : "attributed";
}

/**
 * What keeps a specimen from filling an album hole or going into an offer (brief: Specimen states,
 * eligibility). Missing or transferred stock is never eligible either.
 */
function ineligibility(desk: Desk, key: string, except?: string) {
  const s = desk.specimen(key);
  return {
    uncertain: s.quarantined || s.attribution.certainty === "uncertain",
    committed: commitment(desk, key, except)?.kind ?? null,
    pending: s.attribution.register === "pending",
    gone: s.missing || s.transferred,
  };
}

/** The album's 409 copy for an ineligible specimen, in the brief's order; null when it may fill. */
export function albumRefusal(desk: Desk, key: string): string | null {
  const why = ineligibility(desk, key);
  if (why.uncertain) return F.SET_UNCERTAIN;
  if (why.committed) return F.SET_OUTBOUND;
  if (why.pending) return F.CATALOG_PENDING;
  return null;
}

/**
 * The offer's 409 copy for a basket item, in the brief's eligibility order; null when it may be
 * offered. Quarantined or uncertain stock takes the quarantine copy, missing or transferred stock
 * the outbound copy (decided: the brief's only eligibility copies for those states).
 */
export function offerRefusal(desk: Desk, key: string, offer?: string): string | null {
  const why = ineligibility(desk, key, offer);
  if (why.committed === "reserved") return F.OFFER_TAKEN;
  if (why.committed === "outbound") return F.IN_OFFER;
  if (why.uncertain) return F.SET_UNCERTAIN;
  if (why.gone) return F.SET_OUTBOUND;
  if (why.pending) return F.CATALOG_PENDING;
  return null;
}

/** A holder fits a tray cell when both sides fit, without rotation. */
export function holderFits(holder: Holder): boolean {
  return holder.width_mm <= CELL_MM && holder.height_mm <= CELL_MM;
}

/** The response window as the brief states it, always from the namespace clock. */
export function offerWindow(offer: OfferRecord, now: Date): { expires_at: string | null; remaining_seconds: number | null; closing: boolean } {
  if (offer.status === "expired") return { expires_at: offer.expires_at, remaining_seconds: 0, closing: false };
  if (!RESPONDING.includes(offer.status) || offer.expires_at === null) return { expires_at: null, remaining_seconds: null, closing: false };
  const remaining = Math.max(0, Math.floor((Date.parse(offer.expires_at) - now.getTime()) / 1000));
  return { expires_at: offer.expires_at, remaining_seconds: remaining, closing: remaining <= config.limits.FLAN_CLOSING_S };
}

/** Starts a new response window after a send or a change by `by`. */
export function startWindow(offer: OfferRecord, by: Party, now: Date): void {
  const seconds = by === "dealer" ? config.limits.FLAN_OFFER_WINDOW_S : config.limits.FLAN_COUNTER_WINDOW_S;
  offer.expires_at = new Date(now.getTime() + seconds * 1000).toISOString();
}

/** Offers whose window has run out on the namespace clock. */
export function expiredOffers(desk: Desk): OfferRecord[] {
  return [...desk.offers.values()].filter(
    (o) => RESPONDING.includes(o.status) && o.expires_at !== null && Date.parse(o.expires_at) <= desk.now.getTime(),
  );
}

/** Expires overdue offers: releases their reservations and holds and appends `offer.expired`. */
export function expireOffers(desk: Desk): void {
  for (const offer of expiredOffers(desk)) {
    offer.status = "expired";
    offer.holds = [];
    desk.touch("offers", offer.key);
    offer.changed = desk.event("offer.expired", "system", `offer.expired:${offer.key}:${offer.version}`, [offer.key]);
  }
}

/** A filling specimen that became quarantined, reserved, outbound, missing or transferred reopens its hole. */
export function reopenHoles(desk: Desk, commandId: string): void {
  if (!desk.album) return;
  for (const [label, hole] of Object.entries(desk.album.holes)) {
    if (hole.specimen === null) continue;
    const why = ineligibility(desk, hole.specimen);
    if (!why.uncertain && !why.committed && !why.gone) continue;
    hole.specimen = null;
    desk.albumVersion += 1;
    desk.touchRow();
    desk.event("album.reopened", "dealer", commandId, [], { hole: label });
  }
}

/** A step-up proof is fresh for FLAN_STEPUP_TTL_S of real time after Keycloak's authentication time. */
export function stepUpExpiry(stepUpAt: Date | null): Date | null {
  return stepUpAt ? new Date(stepUpAt.getTime() + config.limits.FLAN_STEPUP_TTL_S * 1000) : null;
}

export function stepUpFresh(stepUpAt: Date | null): boolean {
  const expiry = stepUpExpiry(stepUpAt);
  return expiry !== null && expiry.getTime() > Date.now();
}
