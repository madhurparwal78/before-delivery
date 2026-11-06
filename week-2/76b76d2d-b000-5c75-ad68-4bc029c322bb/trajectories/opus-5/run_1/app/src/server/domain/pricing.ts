import { FARES, FARE_PRICES, type Fare, sortSeats } from '../../shared/domain.ts';

export type AdmissionLine = {
  fare: Fare;
  quantity: number;
  unit_cents: number;
  subtotal_cents: number;
  gst_cents: number;
  qst_cents: number;
};

export type Totals = {
  lines: AdmissionLine[];
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  total_cents: number;
};

export function gstOf(subtotalCents: number): number {
  return Math.trunc((subtotalCents * 5 + 50) / 100);
}

export function qstOf(subtotalCents: number): number {
  return Math.trunc((subtotalCents * 9975 + 50000) / 100000);
}

export function admissionTotals(fares: Record<string, Fare>, upliftCents: number): Totals {
  const counts = new Map<Fare, number>();
  for (const seat of sortSeats(Object.keys(fares))) {
    const fare = fares[seat];
    counts.set(fare, (counts.get(fare) ?? 0) + 1);
  }
  const lines: AdmissionLine[] = [];
  for (const fare of FARES) {
    const quantity = counts.get(fare);
    if (quantity === undefined) continue;
    const unit = FARE_PRICES[fare];
    const subtotal = unit * quantity;
    lines.push({
      fare,
      quantity,
      unit_cents: unit,
      subtotal_cents: subtotal,
      gst_cents: gstOf(subtotal),
      qst_cents: qstOf(subtotal),
    });
  }
  const admission = lines.reduce((sum, line) => sum + line.subtotal_cents, 0);
  const gst = lines.reduce((sum, line) => sum + line.gst_cents, 0);
  const qst = lines.reduce((sum, line) => sum + line.qst_cents, 0);
  return {
    lines,
    admission_cents: admission,
    gst_cents: gst,
    qst_cents: qst,
    uplift_cents: upliftCents,
    total_cents: admission + gst + qst + upliftCents,
  };
}

export function creditApplied(balanceCents: number, totalCents: number): number {
  return Math.min(Math.max(balanceCents, 0), totalCents);
}

export type PayerInput = { name: string; seats: number };
export type PayerShare = { name: string; seats: number; share_cents: number };

/** Largest-remainder split of the invoice total by seat count, ties broken by listing order. */
export function splitShares(totalCents: number, payers: PayerInput[]): PayerShare[] {
  const seatTotal = payers.reduce((sum, payer) => sum + payer.seats, 0);
  const shares = payers.map((payer, index) => ({
    name: payer.name,
    seats: payer.seats,
    share_cents: Math.floor((totalCents * payer.seats) / seatTotal),
    remainder: (totalCents * payer.seats) % seatTotal,
    index,
  }));
  let leftover = totalCents - shares.reduce((sum, share) => sum + share.share_cents, 0);
  const order = [...shares].sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
  for (const share of order) {
    if (leftover <= 0) break;
    share.share_cents += 1;
    leftover -= 1;
  }
  return shares.map((share) => ({ name: share.name, seats: share.seats, share_cents: share.share_cents }));
}
