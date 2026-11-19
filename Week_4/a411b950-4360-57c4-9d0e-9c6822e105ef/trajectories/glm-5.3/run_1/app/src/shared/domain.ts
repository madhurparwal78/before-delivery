/**
 * Shared domain vocabulary used by both the server and the browser bundle.
 * Money is integer cents everywhere (DP: engineering standards) and never
 * passes through binary floating-point arithmetic.
 */

export type CreditType = "shipped" | "jam" | "redesign";
export type ProjectStatus = "draft" | "in_review" | "published" | "withdrawn";
export type Visibility = "public" | "nda";
export type Layer = "bed" | "pulse" | "lead" | "stinger";

export const LAYERS: readonly Layer[] = ["bed", "pulse", "lead", "stinger"];

export type EnquiryStatus =
  | "new"
  | "qualified"
  | "proposal_sent"
  | "accepted"
  | "deposit_paid"
  | "booked"
  | "declined"
  | "expired";

export const ENQUIRY_STATUSES: readonly EnquiryStatus[] = [
  "new",
  "qualified",
  "proposal_sent",
  "accepted",
  "deposit_paid",
  "booked",
  "declined",
  "expired",
];

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: "New",
  qualified: "Qualified",
  proposal_sent: "Proposal sent",
  accepted: "Accepted",
  deposit_paid: "Deposit paid",
  booked: "Booked",
  declined: "Declined",
  expired: "Expired",
};

export const CREDIT_LABELS: Record<CreditType, string> = {
  shipped: "Shipped title",
  jam: "Game jam",
  redesign: "Redesign",
};

export interface Thresholds {
  bed: number;
  pulse: number;
  lead: number;
  stinger: number;
}

export interface StationStem {
  id: string;
  layer: Layer;
  url: string;
}

export interface Station {
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_label: string;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  thresholds: Thresholds;
  playable: boolean;
  stems: StationStem[];
}

export interface Milestone {
  number: number;
  name: string;
  percent: number;
  amount_cents: number;
}

export const MILESTONE_NAMES: Record<number, string> = {
  1: "Deposit",
  2: "Vertical slice",
  3: "Content complete",
  4: "Final delivery",
};

export const MILESTONE_PERCENTS: Record<number, number> = {
  1: 30,
  2: 20,
  3: 20,
  4: 30,
};

/**
 * The single place that decides the 30/20/20/30 milestone split (DP-24).
 * Milestones 1-3 are floor(fee * percent / 100); milestone 4 takes the
 * remainder so the four always add up to the fee.
 */
export function milestoneSplit(feeCents: number): Milestone[] {
  const partial = [1, 2, 3].map((number) => ({
    number,
    name: MILESTONE_NAMES[number],
    percent: MILESTONE_PERCENTS[number],
    amount_cents: Math.floor((feeCents * MILESTONE_PERCENTS[number]) / 100),
  }));
  const remainder = feeCents - partial.reduce((sum, m) => sum + m.amount_cents, 0);
  return [
    ...partial,
    {
      number: 4,
      name: MILESTONE_NAMES[4],
      percent: MILESTONE_PERCENTS[4],
      amount_cents: remainder,
    },
  ];
}

/** The single place that writes money for people: $1,499.99 (DP: Business rules). */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toString();
  const groups = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsPart = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${groups}.${centsPart}`;
}

/** Decimal dollars with exactly two decimals, no separators: 8000.00 (field format). */
export function centsToDecimalField(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const negative = cents < 0 ? "-" : "";
  return `${negative}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

/**
 * The single cents-to-dollars conversion used for Kill Bill amounts (DP:
 * Business rules). Written from integer cents without floating-point math.
 */
export function centsToDecimalString(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const negative = cents < 0 ? "-" : "";
  return `${negative}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

/**
 * The single dollars-to-cents conversion for values read back from Kill Bill.
 * Parses the decimal digits exactly, with no rounding step.
 */
export function decimalToCents(value: string | number): number {
  const text = typeof value === "number" ? value.toString() : value;
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) {
    throw new Error(`Not a decimal amount: ${text}`);
  }
  const [, sign, dollars, fraction = ""] = match;
  const cents = Number.parseInt(dollars, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0").slice(0, 2) || "0", 10);
  return sign === "-" ? -cents : cents;
}

/** The single place that writes money fields ("4,999.99" or "4999.99") as cents. */
export function parseMoneyField(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(trimmed) && !/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const withoutSeparators = trimmed.replace(/,/g, "");
  const [dollarText, fraction = ""] = withoutSeparators.split(".");
  const negative = dollarText.startsWith("-");
  const dollars = Number.parseInt(dollarText.replace(/^-/, ""), 10);
  const cents = dollars * 100 + Number.parseInt(fraction.padEnd(2, "0").slice(0, 2) || "0", 10);
  return negative ? -cents : cents;
}

/**
 * The single intensity rule (DP-03): offset/16 rounded to the nearest whole
 * number with an exact half always rounded up.
 */
export function intensityFromOffset(offset: number): number {
  const scaled = offset / 16;
  const floor = Math.floor(scaled);
  const difference = scaled - floor;
  if (difference === 0.5) return floor + 1;
  return Math.round(scaled);
}
