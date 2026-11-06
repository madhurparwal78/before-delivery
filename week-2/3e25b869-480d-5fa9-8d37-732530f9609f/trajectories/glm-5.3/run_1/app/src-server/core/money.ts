// Money handling: integer cents from input to Kill Bill and email.
export type Cents = number;

export interface Money {
  cents: Cents;
  currency: "CAD";
}

export function money(cents: Cents): Money {
  return { cents, currency: "CAD" };
}

/**
 * Apply a rate, expressed in hundred-thousandths, to a base in cents.
 * The single rounding rule in the shop: half up.
 */
export function applyRate(base: Cents, rateHundredThousandths: number): Cents {
  return Math.floor((base * rateHundredThousandths + 50_000) / 100_000);
}

// Rate constants in hundred-thousandths.
export const RATES = {
  discount: 12_000,
  GST: 5_000,
  QST: 9_975,
  HST13: 13_000,
  HST14: 14_000,
  HST15: 15_000
} as const;

export type TaxCode = "GST" | "QST" | "HST";

export interface TaxSpec {
  code: TaxCode;
  rateHundredThousandths: number;
  /** Percentage display string, identical in both locales: 5%, 9.975%, 13%, 14%, 15%. */
  rateLabel: string;
}

export interface TaxLine extends TaxSpec {
  amount: Money;
}

export const BAR_PRICE_CENTS = 1_100;
export const DROPSHIPPING_CENTS = 900;
export const TRIO_LIST_CENTS = 3 * BAR_PRICE_CENTS;

export interface PriceBreakdown {
  subtotal: Money;
  discount: Money;
  shipping: Money;
  preTax: Money;
  taxes: TaxLine[];
  total: Money;
}

/** Compute a drop-order price breakdown for a given province. */
export function dropPrice(barCount: number, taxes: readonly TaxSpec[]): PriceBreakdown {
  const subtotal = money(barCount * BAR_PRICE_CENTS);
  const shipping = money(barCount === 0 ? 0 : DROPSHIPPING_CENTS);
  const preTax = money(subtotal.cents + shipping.cents);
  const taxLines = taxes.map((t) => ({ ...t, amount: money(applyRate(preTax.cents, t.rateHundredThousandths)) }));
  const total = money(preTax.cents + taxLines.reduce((s, t) => s + t.amount.cents, 0));
  return { subtotal, discount: money(0), shipping, preTax, taxes: taxLines, total };
}

/** Compute the Trio subscription price breakdown for a given province. */
export function trioPrice(taxes: readonly TaxSpec[]): PriceBreakdown {
  const subtotal = money(TRIO_LIST_CENTS);
  const discount = money(applyRate(subtotal.cents, RATES.discount));
  const shipping = money(0);
  const preTax = money(subtotal.cents - discount.cents + shipping.cents);
  const taxLines = taxes.map((t) => ({ ...t, amount: money(applyRate(preTax.cents, t.rateHundredThousandths)) }));
  const total = money(preTax.cents + taxLines.reduce((s, t) => s + t.amount.cents, 0));
  return { subtotal, discount, shipping, preTax, taxes: taxLines, total };
}
