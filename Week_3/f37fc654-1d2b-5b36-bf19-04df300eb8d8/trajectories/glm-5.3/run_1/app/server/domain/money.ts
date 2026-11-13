// The one place where amounts are computed and split.
import { ADD_ON_LABELS, ADD_ON_PRICE_CENTS, INSTALLATION_LABELS, MAIN_PIECE_PRICE_CENTS, SIZE_LABELS, SIZE_PRICE_CENTS } from './seed.js';
import type { AddOn, InstallationType, Size } from './seed.js';

export interface QuoteLine {
  label: string;
  amountCents: number;
}

export interface QuoteAmounts {
  lines: QuoteLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function taxCentsFor(subtotalCents: number, taxRateBp: number): number {
  // Half up to the cent, computed once on the subtotal.
  const scaled = BigInt(subtotalCents) * BigInt(taxRateBp);
  return Number((scaled + 5000n) / 10000n);
}

export function quoteAmounts(type: InstallationType, size: Size, addOns: AddOn[], taxRateBp: number): QuoteAmounts {
  const lines: QuoteLine[] = [];
  let subtotal = MAIN_PIECE_PRICE_CENTS[type];
  lines.push({ label: INSTALLATION_LABELS[type], amountCents: MAIN_PIECE_PRICE_CENTS[type] });
  const sizePrice = SIZE_PRICE_CENTS[size];
  lines.push({ label: `Size: ${SIZE_LABELS[size]}`, amountCents: sizePrice });
  subtotal += sizePrice;
  for (const a of addOns) {
    lines.push({ label: ADD_ON_LABELS[a], amountCents: ADD_ON_PRICE_CENTS[a] });
    subtotal += ADD_ON_PRICE_CENTS[a];
  }
  const tax = taxCentsFor(subtotal, taxRateBp);
  const rate = (taxRateBp / 100).toFixed(2);
  lines.push({ label: `Sales tax (${rate}%)`, amountCents: tax });
  return { lines, subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
}

/**
 * The one splitting rule: parts always add up to amount.
 * floor first, then leftover cents one at a time to the largest remainders,
 * equal remainders to the earlier entry.
 */
export function splitByBp(amountCents: number, weightsBp: number[]): number[] {
  const totalBp = weightsBp.reduce((s, w) => s + w, 0);
  if (totalBp !== 10000) throw new Error('weights must sum to 10000');
  const parts = weightsBp.map((w) => Math.floor((amountCents * w) / 10000));
  let leftover = amountCents - parts.reduce((s, p) => s + p, 0);
  const order = weightsBp
    .map((w, i) => ({ i, rem: (amountCents * w) % 10000 }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    leftover -= 1;
  }
  return parts;
}

export interface SplitPart {
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
}

/**
 * Split subtotal and tax separately, in two stages: funders first,
 * then the lead client's parts across the payment schedule.
 * Destinations must be ordered: funders in list order, milestones in
 * schedule order.
 */
export function splitAmounts(
  subtotalCents: number,
  taxCents: number,
  funderBps: Array<{ funderId: string; bp: number }>,
  milestoneBps: Array<{ milestoneId: string; bp: number }>,
): { funders: Map<string, SplitPart>; milestones: Map<string, SplitPart> } {
  const funderSub = splitByBp(subtotalCents, funderBps.map((f) => f.bp));
  const funderTax = splitByBp(taxCents, funderBps.map((f) => f.bp));
  const leadId = funderBps[0]?.funderId;
  if (!leadId) throw new Error('no lead funder');
  const msSub = splitByBp(funderSub[0] ?? 0, milestoneBps.map((m) => m.bp));
  const msTax = splitByBp(funderTax[0] ?? 0, milestoneBps.map((m) => m.bp));
  const funders = new Map<string, SplitPart>();
  funderBps.forEach((f, i) => {
    const subtotal = funderSub[i] ?? 0;
    const tax = funderTax[i] ?? 0;
    funders.set(f.funderId, { subtotalCents: subtotal, taxCents: tax, amountCents: subtotal + tax });
  });
  const milestones = new Map<string, SplitPart>();
  milestoneBps.forEach((m, i) => {
    const subtotal = msSub[i] ?? 0;
    const tax = msTax[i] ?? 0;
    milestones.set(m.milestoneId, { subtotalCents: subtotal, taxCents: tax, amountCents: subtotal + tax });
  });
  return { funders, milestones };
}
