// Tariff revisions and tariff lines: each line is rounded half up to the cent once, when calculated,
// and a total is the exact sum of its lines.
import { inNightWindow, portMinuteOfDay } from "../../shared/portTime.js";
import type { Line } from "../../shared/types.js";
import type { BillingEventKind, Store, TariffRevisionRecord } from "../store.js";

interface PricedVessel {
  draught_mm: number;
  gross_tonnage: number;
}

/**
 * The revision in force at a boarding instant: the latest effective time at or before it. Before the
 * first published revision, the first one prices the move.
 */
export function revisionInForce(store: Store, boardingInstant: number): TariffRevisionRecord {
  const revisions = store.tariffRevisions.all().sort((a, b) => a.effective_instant - b.effective_instant);
  const inForce = revisions.filter((r) => r.effective_instant <= boardingInstant).pop();
  const first = revisions[0];
  if (!first) throw new Error("the store holds no tariff revision");
  return inForce ?? first;
}

/** The billed draft foot: stored millimetres / 304.8, rounded up once to a whole foot. */
const billedDraftFeet = (draughtMm: number): number => Math.floor((draughtMm * 10 + 3047) / 3048);

const line = (revision: TariffRevisionRecord, label: string, quantity: number, unitCents: number): Line => ({
  label,
  quantity,
  unit_cents: unitCents,
  amount_cents: quantity * unitCents,
  tariff_revision: revision.label,
});

/** Draft foot, tonnage band, minimum charge and night surcharge: the estimate's four rows. */
function pilotageLines(revision: TariffRevisionRecord, vessel: PricedVessel, boardingInstant: number): Line[] {
  const band = revision.tonnage_bands.find(
    (b) => vessel.gross_tonnage >= b.from_gt && (b.to_gt === null || vessel.gross_tonnage <= b.to_gt),
  );
  const lines = [
    line(revision, "Draft foot", billedDraftFeet(vessel.draught_mm), revision.draft_foot_cents),
    line(revision, "Tonnage band", 1, band?.cents ?? 0),
  ];
  const base = lines.reduce((sum, l) => sum + l.amount_cents, 0);
  if (base < revision.minimum_cents) lines.push(line(revision, "Minimum charge", 1, revision.minimum_cents - base));
  if (inNightWindow(portMinuteOfDay(boardingInstant))) {
    const subtotal = lines.reduce((sum, l) => sum + l.amount_cents, 0);
    const surcharge = Math.floor((subtotal * revision.night_percent * 2 + 100) / 200);
    lines.push(line(revision, "Night surcharge", 1, surcharge));
  }
  return lines;
}

export function estimateFor(
  store: Store,
  vessel: PricedVessel,
  boardingInstant: number,
): { tariff_revision: string; lines: Line[]; total_cents: number } {
  const revision = revisionInForce(store, boardingInstant);
  const lines = pilotageLines(revision, vessel, boardingInstant);
  return { tariff_revision: revision.label, lines, total_cents: lines.reduce((sum, l) => sum + l.amount_cents, 0) };
}

/** Detention billed half hours: accrued seconds less the allowance, per started half hour, never below zero. */
export function billedHalfHours(revision: TariffRevisionRecord, seconds: number, unitSeconds: number): number {
  const beyond = seconds - revision.detention_allowance_half_hours * unitSeconds;
  return beyond > 0 ? Math.ceil(beyond / unitSeconds) : 0;
}

/** The lines of one billing event, in the published order. */
export function billingEventLines(
  revision: TariffRevisionRecord,
  event: BillingEventKind,
  vessel: PricedVessel,
  boardingInstant: number,
  detentionHalfHours: number,
  lateAmendments: number,
): Line[] {
  const lines = event === "Completed" ? pilotageLines(revision, vessel, boardingInstant) : [];
  if (event === "Completed" && detentionHalfHours > 0) {
    lines.push(line(revision, "Detention", detentionHalfHours, revision.detention_half_hour_cents));
  }
  const cancellations = (event === "Completed" ? 0 : 1) + lateAmendments;
  if (cancellations > 0) lines.push(line(revision, "Cancellation", cancellations, revision.cancellation_cents));
  return lines;
}
