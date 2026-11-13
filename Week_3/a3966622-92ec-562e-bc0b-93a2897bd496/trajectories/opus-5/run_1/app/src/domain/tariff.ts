import { billedDraftFeet, roundHalfUp } from './numerals.ts';
import { type Wall, minutesAfterMidnight } from './porttime.ts';

export type TonnageBand = { from_gt: number; to_gt: number | null; cents: number };

export type TariffRevision = {
  id: string;
  label: string;
  effective_at: string;
  draft_foot_cents: number;
  minimum_cents: number;
  tonnage_bands: TonnageBand[];
  night_percent: number;
  detention_half_hour_cents: number;
  detention_allowance_half_hours: number;
  cancellation_cents: number;
};

export type Line = {
  label: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  tariff_revision: string;
};

export type BillingEventKind = 'Completed' | 'Cancelled late' | 'Refused at ladder';

export type ChargeSubject = {
  draught_mm: number;
  gross_tonnage: number;
  boarding: Wall;
  detention_half_hours: number;
  late_amendments: number;
};

/** The night window is port-local 22:00 through 05:59. */
export function inNightWindow(boarding: Wall): boolean {
  const minutes = minutesAfterMidnight(boarding);
  return minutes >= 22 * 60 || minutes <= 5 * 60 + 59;
}

export function bandFor(revision: TariffRevision, grossTonnage: number): TonnageBand | undefined {
  return revision.tonnage_bands.find(
    (band) => grossTonnage >= band.from_gt && (band.to_gt === null || grossTonnage <= band.to_gt),
  );
}

/** The revision in force is the one with the latest effective time at or before the boarding instant. */
export function revisionInForce(
  revisions: readonly TariffRevision[],
  effectiveInstants: ReadonlyMap<string, number>,
  boardingInstant: number,
): TariffRevision {
  let chosen: TariffRevision | null = null;
  let chosenInstant = Number.NEGATIVE_INFINITY;
  for (const revision of revisions) {
    const instant = effectiveInstants.get(revision.id);
    if (instant === undefined || instant > boardingInstant) continue;
    if (instant >= chosenInstant) {
      chosen = revision;
      chosenInstant = instant;
    }
  }
  if (chosen === null) throw new Error('no tariff revision in force at that boarding time');
  return chosen;
}

function moveCharges(revision: TariffRevision, subject: ChargeSubject): Line[] {
  const lines: Line[] = [];
  const feet = billedDraftFeet(subject.draught_mm);
  lines.push({
    label: 'Draft foot',
    quantity: feet,
    unit_cents: revision.draft_foot_cents,
    amount_cents: feet * revision.draft_foot_cents,
    tariff_revision: revision.label,
  });
  const band = bandFor(revision, subject.gross_tonnage);
  const bandCents = band?.cents ?? 0;
  lines.push({
    label: 'Tonnage band',
    quantity: 1,
    unit_cents: bandCents,
    amount_cents: bandCents,
    tariff_revision: revision.label,
  });
  const baseSum = lines.reduce((total, line) => total + line.amount_cents, 0);
  if (baseSum < revision.minimum_cents) {
    const topUp = revision.minimum_cents - baseSum;
    lines.push({
      label: 'Minimum charge',
      quantity: 1,
      unit_cents: topUp,
      amount_cents: topUp,
      tariff_revision: revision.label,
    });
  }
  if (inNightWindow(subject.boarding)) {
    const sum = lines.reduce((total, line) => total + line.amount_cents, 0);
    const surcharge = roundHalfUp((sum * revision.night_percent) / 100);
    lines.push({
      label: 'Night surcharge',
      quantity: 1,
      unit_cents: surcharge,
      amount_cents: surcharge,
      tariff_revision: revision.label,
    });
  }
  return lines;
}

/** An estimate holds the draft-foot, tonnage-band, minimum-charge and night lines. */
export function estimateLines(revision: TariffRevision, subject: ChargeSubject): Line[] {
  return moveCharges(revision, subject);
}

export function billingEventLines(
  kind: BillingEventKind,
  revision: TariffRevision,
  subject: ChargeSubject,
): Line[] {
  const lines: Line[] = [];
  if (kind === 'Completed') {
    lines.push(...moveCharges(revision, subject));
    if (subject.detention_half_hours > 0) {
      lines.push({
        label: 'Detention',
        quantity: subject.detention_half_hours,
        unit_cents: revision.detention_half_hour_cents,
        amount_cents: subject.detention_half_hours * revision.detention_half_hour_cents,
        tariff_revision: revision.label,
      });
    }
  }
  const cancellationQuantity =
    (kind === 'Completed' ? 0 : 1) + Math.max(0, subject.late_amendments);
  if (cancellationQuantity > 0) {
    lines.push({
      label: 'Cancellation',
      quantity: cancellationQuantity,
      unit_cents: revision.cancellation_cents,
      amount_cents: cancellationQuantity * revision.cancellation_cents,
      tariff_revision: revision.label,
    });
  }
  return lines;
}

export function linesTotal(lines: readonly Line[]): number {
  return lines.reduce((total, line) => total + line.amount_cents, 0);
}

/** Accrued seconds less the allowance, divided by the half-hour length, rounded up, never below zero. */
export function billedHalfHours(
  accruedSeconds: number,
  allowanceHalfHours: number,
  unitSeconds: number,
): number {
  const chargeable = accruedSeconds - allowanceHalfHours * unitSeconds;
  if (chargeable <= 0) return 0;
  return Math.ceil(chargeable / unitSeconds);
}
