import {
  ADDON_LABELS,
  ADDON_ORDER,
  ADDON_PRICE_CENTS,
  INSTALLATION_LABELS,
  INSTALLATION_PRICE_CENTS,
  MILESTONE_SCHEDULE,
  SIZE_LABELS,
  SIZE_PRICE_CENTS,
  type AddOn,
  type InstallationType,
  type SizeOption,
} from './seed.js';

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

/** Basis-points rate formatted with two decimals, e.g. 1025 -> "10.25". */
export function formatRateBp(taxRateBp: number): string {
  return (taxRateBp / 100).toFixed(2);
}

/**
 * Tax is the subtotal times the venue rate in basis points, rounded half up to
 * the cent exactly once on the subtotal. This is the only place tax is computed.
 */
export function taxOn(subtotalCents: number, taxRateBp: number): number {
  const scaled = subtotalCents * taxRateBp;
  return Math.floor(scaled / 10000 + 0.5);
}

export function computeQuote(
  installationType: InstallationType,
  size: SizeOption,
  addOns: readonly AddOn[],
  taxRateBp: number,
): QuoteAmounts {
  const chosen = ADDON_ORDER.filter((a) => addOns.includes(a));
  const lines: QuoteLine[] = [
    { label: INSTALLATION_LABELS[installationType], amountCents: INSTALLATION_PRICE_CENTS[installationType] },
    { label: `Size: ${SIZE_LABELS[size]}`, amountCents: SIZE_PRICE_CENTS[size] },
    ...chosen.map((a) => ({ label: ADDON_LABELS[a], amountCents: ADDON_PRICE_CENTS[a] })),
  ];
  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const taxCents = taxOn(subtotalCents, taxRateBp);
  lines.push({ label: `Sales tax (${formatRateBp(taxRateBp)}%)`, amountCents: taxCents });
  return { lines, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/**
 * The one splitting rule: divide `amountCents` by weights in basis points that
 * sum to 10000. Each part is the floor share; leftover cents go one at a time to
 * the largest remainders, ties resolved towards the earlier weight. Parts always
 * add up to the amount.
 */
export function splitByBasisPoints(amountCents: number, weightsBp: readonly number[]): number[] {
  const parts = weightsBp.map((w) => Math.floor((amountCents * w) / 10000));
  const remainders = weightsBp.map((w, i) => ({ i, rem: (amountCents * w) % 10000 }));
  let leftover = amountCents - parts.reduce((sum, p) => sum + p, 0);
  remainders.sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
  for (const entry of remainders) {
    if (leftover <= 0) break;
    parts[entry.i] = (parts[entry.i] ?? 0) + 1;
    leftover -= 1;
  }
  return parts;
}

export interface SplitPart {
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
}

function zipParts(subtotals: number[], taxes: number[]): SplitPart[] {
  return subtotals.map((s, i) => {
    const t = taxes[i] ?? 0;
    return { subtotalCents: s, taxCents: t, amountCents: s + t };
  });
}

/** Stage one: split the quote across funders in list order. */
export function splitAcrossFunders(quote: QuoteAmounts, funderBp: readonly number[]): SplitPart[] {
  return zipParts(
    splitByBasisPoints(quote.subtotalCents, funderBp),
    splitByBasisPoints(quote.taxCents, funderBp),
  );
}

/** Stage two: split the lead client's part by the payment schedule. */
export function splitAcrossMilestones(leadPart: SplitPart): SplitPart[] {
  const bp = MILESTONE_SCHEDULE.map((m) => m.scheduleBp);
  return zipParts(
    splitByBasisPoints(leadPart.subtotalCents, bp),
    splitByBasisPoints(leadPart.taxCents, bp),
  );
}

/** US dollars with a dollar sign, comma thousands and two decimals. */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars}.${rest}`;
}

/** Share percent typed with two decimals, e.g. 2500 -> "25.00". */
export function formatSharePercent(bp: number): string {
  return (bp / 100).toFixed(2);
}
