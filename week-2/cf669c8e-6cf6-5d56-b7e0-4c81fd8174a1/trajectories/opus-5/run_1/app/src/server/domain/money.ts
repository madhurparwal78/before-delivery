/**
 * Money rules. Every amount is integer euro cents and every intermediate
 * product is a BigInt, so no floating-point value ever decides an amount.
 *
 * This module is the only place that extracts VAT, builds a payment schedule,
 * or allocates a payment across lines.
 */

import type { StageName } from '../../shared/types.js';

export const STAGE_ORDER: readonly StageName[] = [
  'deposit',
  'instalment-1',
  'instalment-2',
  'instalment-3',
];

/** Deposit share of the order total, as a percentage. */
const DEPOSIT_PCT = 20n;

function divRoundHalfUp(num: bigint, den: bigint): bigint {
  const q = num / den;
  const rem = num - q * den;
  return rem * 2n >= den ? q + 1n : q;
}

/** Line VAT = gross × rate ÷ (100 + rate), rounded half up to the cent. */
export function extractVat(grossCents: number, ratePct: number): number {
  if (ratePct === 0) return 0;
  const gross = BigInt(grossCents);
  const rate = BigInt(ratePct);
  return Number(divRoundHalfUp(gross * rate, 100n + rate));
}

/**
 * Split `totalCents` into a deposit of 20 percent rounded half up plus three
 * instalments by whole-cent division, with leftover cents going one each to
 * the earliest instalments.
 */
export function buildScheduleAmounts(totalCents: number): Record<StageName, number> {
  const total = BigInt(totalCents);
  const deposit = divRoundHalfUp(total * DEPOSIT_PCT, 100n);
  const rest = total - deposit;
  const base = rest / 3n;
  const leftover = Number(rest - base * 3n);
  const instalments = [0, 1, 2].map((i) => Number(base) + (i < leftover ? 1 : 0));
  return {
    deposit: Number(deposit),
    'instalment-1': instalments[0] as number,
    'instalment-2': instalments[1] as number,
    'instalment-3': instalments[2] as number,
  };
}

/**
 * Re-level an unpaid balance across the unpaid stages into equal whole cents,
 * with leftover cents going one each to the earliest.
 */
export function levelAmounts(balanceCents: number, stageCount: number): number[] {
  if (stageCount === 0) return [];
  const balance = BigInt(balanceCents);
  const count = BigInt(stageCount);
  const base = balance / count;
  const leftover = Number(balance - base * count);
  return Array.from({ length: stageCount }, (_, i) => Number(base) + (i < leftover ? 1 : 0));
}

export interface AllocationTarget {
  lineId: string;
  /** The line's share weight: its current gross. */
  weightCents: number;
  ratePct: number;
}

export interface AllocatedShare {
  lineId: string;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

/**
 * Allocate `amountCents` across lines in proportion to line gross ÷ order
 * total. Each line takes the floor of its share and leftover cents go one each
 * to the largest fractional remainders, ties to the earlier line.
 */
export function allocateProportional(
  amountCents: number,
  targets: readonly AllocationTarget[],
): AllocatedShare[] {
  const totalWeight = targets.reduce((sum, t) => sum + t.weightCents, 0);
  if (totalWeight === 0 || amountCents === 0) {
    return targets.map((t) => ({ lineId: t.lineId, grossCents: 0, vatCents: 0, netCents: 0 }));
  }

  const amount = BigInt(amountCents);
  const total = BigInt(totalWeight);

  const parts = targets.map((t, index) => {
    const num = BigInt(t.weightCents) * amount;
    const floor = num / total;
    return { index, target: t, gross: Number(floor), remainder: num - floor * total };
  });

  let leftover = amountCents - parts.reduce((sum, p) => sum + p.gross, 0);
  const byRemainder = [...parts].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.index - b.index;
  });
  for (const part of byRemainder) {
    if (leftover <= 0) break;
    part.gross += 1;
    leftover -= 1;
  }

  return parts.map((p) => {
    const vatCents = extractVat(p.gross, p.target.ratePct);
    return {
      lineId: p.target.lineId,
      grossCents: p.gross,
      vatCents,
      netCents: p.gross - vatCents,
    };
  });
}

/**
 * The residual allocation for the final payment on each line, so a line's
 * allocations sum exactly to its gross and VAT.
 */
export function allocateResidual(
  lines: readonly { id: string; grossCents: number; vatCents: number }[],
  alreadyAllocated: ReadonlyMap<string, { grossCents: number; vatCents: number }>,
): AllocatedShare[] {
  return lines.map((line) => {
    const done = alreadyAllocated.get(line.id) ?? { grossCents: 0, vatCents: 0 };
    const grossCents = line.grossCents - done.grossCents;
    const vatCents = line.vatCents - done.vatCents;
    return { lineId: line.id, grossCents, vatCents, netCents: grossCents - vatCents };
  });
}

/**
 * VAT reversed for a refund draw: the allocation's remaining VAT if the draw
 * empties the allocation, otherwise draw × rate ÷ (100 + rate) rounded half
 * up, capped at the remaining VAT.
 */
export function reverseVatForDraw(
  drawCents: number,
  remainingGrossCents: number,
  remainingVatCents: number,
  ratePct: number,
): number {
  if (drawCents >= remainingGrossCents) return remainingVatCents;
  const extracted = extractVat(drawCents, ratePct);
  return Math.min(extracted, remainingVatCents);
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}
