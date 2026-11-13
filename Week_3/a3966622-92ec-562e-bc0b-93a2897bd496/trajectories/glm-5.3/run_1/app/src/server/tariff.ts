import { isNightBoarding } from './porttime.js';
import { roundHalfUp } from './numerals.js';

// Published tariff lines. Each line is rounded half up to the cent once, when
// it is calculated, and the total is the exact sum of its lines.

export interface TonnageBand {
  from_gt: number;
  to_gt: number | null;
  cents: number;
}

export interface TariffRevision {
  label: string;
  effective_at: string; // "YYYY-MM-DDTHH:MM" port-local
  draft_foot_cents: number;
  minimum_cents: number;
  tonnage_bands: readonly TonnageBand[];
  night_percent: number;
  detention_half_hour_cents: number;
  detention_allowance_half_hours: number;
  cancellation_cents: number;
}

export interface Line {
  label: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  tariff_revision: string;
}

export interface BillingEvent {
  kind: 'Completed' | 'Cancelled late' | 'Refused at ladder';
  draughtMm: number;
  grossTonnage: number;
  boardingMs: number;
  detentionSeconds: number;
  lateAmendments: number;
  detentionUnitSeconds: number;
}

// The billed draft foot: stored millimetres divided by 304.8, rounded up once
// to a whole foot.
export function billedDraftFoot(draughtMm: number): number {
  return Math.ceil(draughtMm / 304.8);
}

export function revisionInForce(
  revisions: readonly TariffRevision[],
  boardingMs: number,
  toInstant: (effectiveAt: string) => number | null,
): TariffRevision {
  const inForce = revisions
    .map((r) => ({ r, ms: toInstant(r.effective_at) }))
    .filter((x) => x.ms !== null && (x.ms as number) <= boardingMs)
    .sort((a, b) => (a.ms as number) - (b.ms as number));
  if (inForce.length === 0) throw new Error('no tariff revision in force');
  return inForce[inForce.length - 1]!.r;
}

function bandForCents(bands: readonly TonnageBand[], grossTonnage: number): TonnageBand | null {
  for (const band of bands) {
    const upperOk = band.to_gt === null || grossTonnage <= band.to_gt;
    if (grossTonnage >= band.from_gt && upperOk) return band;
  }
  return null;
}

// The four estimate rows: draft foot, tonnage band, minimum charge and night
// surcharge, by the same rules the billing event uses.
export function estimateLines(revision: TariffRevision, draughtMm: number, grossTonnage: number, boardingMs: number): Line[] {
  const lines: Line[] = [];
  const draftFoot = billedDraftFoot(draughtMm);
  lines.push({
    label: 'Draft foot',
    quantity: draftFoot,
    unit_cents: revision.draft_foot_cents,
    amount_cents: draftFoot * revision.draft_foot_cents,
    tariff_revision: revision.label,
  });
  const band = bandForCents(revision.tonnage_bands, grossTonnage);
  if (band) {
    lines.push({
      label: 'Tonnage band',
      quantity: 1,
      unit_cents: band.cents,
      amount_cents: band.cents,
      tariff_revision: revision.label,
    });
  }
  const sum = lines.reduce((acc, l) => acc + l.amount_cents, 0);
  if (sum < revision.minimum_cents) {
    const topUp = revision.minimum_cents - sum;
    lines.push({
      label: 'Minimum charge',
      quantity: 1,
      unit_cents: topUp,
      amount_cents: topUp,
      tariff_revision: revision.label,
    });
  }
  if (isNightBoarding(boardingMs)) {
    const base = lines.reduce((acc, l) => acc + l.amount_cents, 0);
    const surcharge = roundHalfUp((base * revision.night_percent) / 100);
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

// Billed half hours: whole seconds accrued minus the allowance, divided by the
// half-hour length, rounded up, never below zero. The allowance is that length
// times the revision's allowance in half hours.
export function billedHalfHours(seconds: number, allowanceHalfHours: number, unitSeconds: number): number {
  const allowance = allowanceHalfHours * unitSeconds;
  const excess = Math.max(0, seconds - allowance);
  return excess === 0 ? 0 : Math.ceil(excess / unitSeconds);
}

// Lines fixed at the billing event, in the published order.
export function eventLines(event: BillingEvent, revision: TariffRevision): Line[] {
  const lines: Line[] = estimateLines(revision, event.draughtMm, event.grossTonnage, event.boardingMs);
  if (event.kind === 'Completed') {
    const halfHours = billedHalfHours(
      event.detentionSeconds,
      revision.detention_allowance_half_hours,
      event.detentionUnitSeconds,
    );
    if (halfHours > 0) {
      lines.push({
        label: 'Detention',
        quantity: halfHours,
        unit_cents: revision.detention_half_hour_cents,
        amount_cents: halfHours * revision.detention_half_hour_cents,
        tariff_revision: revision.label,
      });
    }
  }
  if (event.kind === 'Cancelled late' || event.kind === 'Refused at ladder' || event.lateAmendments > 0) {
    const quantity = event.lateAmendments + (event.kind === 'Cancelled late' || event.kind === 'Refused at ladder' ? 1 : 0);
    if (quantity > 0) {
      lines.push({
        label: 'Cancellation',
        quantity,
        unit_cents: revision.cancellation_cents,
        amount_cents: quantity * revision.cancellation_cents,
        tariff_revision: revision.label,
      });
    }
  }
  return lines;
}

export function totalOf(lines: readonly Line[]): number {
  return lines.reduce((acc, l) => acc + l.amount_cents, 0);
}
