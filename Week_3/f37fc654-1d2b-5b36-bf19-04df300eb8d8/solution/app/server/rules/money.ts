// Money rules (brief: Business rules › Money, Splitting rule). Integer cents only.
import { ADD_ONS, INSTALLATIONS, MILESTONE_SCHEDULE, SIZES, type AddOn, type InstallationType, type Size } from "../../shared/catalog.js";
import { percent } from "../../shared/format.js";

const WHOLE = 10_000;

/** Tax on a subtotal at a basis-point rate, rounded half up to the cent once. */
function taxCents(subtotalCents: number, rateBp: number): number {
  return Math.floor((subtotalCents * rateBp + WHOLE / 2) / WHOLE);
}

/** The splitting rule: floor parts, leftover cents to the largest remainders, ties to the earlier entry. */
function split(amount: number, weightsBp: readonly number[]): number[] {
  const parts = weightsBp.map((w) => Math.floor((amount * w) / WHOLE));
  const remainders = weightsBp.map((w) => (amount * w) % WHOLE);
  const order = weightsBp.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a] || a - b);
  let leftover = amount - parts.reduce((s, p) => s + p, 0);
  for (const i of order) {
    if (leftover <= 0) break;
    parts[i] += 1;
    leftover -= 1;
  }
  return parts;
}

export interface QuoteLine {
  label: string;
  amountCents: number;
}

interface QuoteAmounts {
  lines: QuoteLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function priceQuote(installation: InstallationType, size: Size, addOns: readonly AddOn[], taxRateBp: number): QuoteAmounts {
  const priced: QuoteLine[] = [
    { label: INSTALLATIONS[installation].label, amountCents: INSTALLATIONS[installation].priceCents },
    { label: `Size: ${SIZES[size].label}`, amountCents: SIZES[size].priceCents },
    ...addOns.map((a) => ({ label: ADD_ONS[a].label, amountCents: ADD_ONS[a].priceCents })),
  ];
  const subtotalCents = priced.reduce((s, l) => s + l.amountCents, 0);
  const tax = taxCents(subtotalCents, taxRateBp);
  return {
    lines: [...priced, { label: `Sales tax (${percent(taxRateBp)}%)`, amountCents: tax }],
    subtotalCents,
    taxCents: tax,
    totalCents: subtotalCents + tax,
  };
}

interface Part {
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
}

function parts(subtotalCents: number, taxCentsTotal: number, weightsBp: readonly number[]): Part[] {
  const subtotals = split(subtotalCents, weightsBp);
  const taxes = split(taxCentsTotal, weightsBp);
  return subtotals.map((s, i) => ({ subtotalCents: s, taxCents: taxes[i], amountCents: s + taxes[i] }));
}

/** Funder stage: the quote split across funders in list order (lead client first). */
export function funderParts(quote: { subtotalCents: number; taxCents: number }, weightsBp: readonly number[]): Part[] {
  return parts(quote.subtotalCents, quote.taxCents, weightsBp);
}

/** Milestone stage: the lead client's part split by the payment schedule. */
export function milestoneParts(clientPart: { subtotalCents: number; taxCents: number }): Part[] {
  return parts(clientPart.subtotalCents, clientPart.taxCents, MILESTONE_SCHEDULE.map((m) => m.bp));
}

/** Kill Bill boundary: integer cents ↔ its decimal amount strings. */
export function killbillAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function fromKillbill(value: number | string): number {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  const negative = text.trim().startsWith("-");
  const [whole, fraction = ""] = text.trim().replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}
