import { ApiError } from '../errors.js';

/** The published rate table. Any code outside it is refused at checkout. */
const RATE_TABLE: ReadonlyMap<string, number> = new Map([
  ['US', 0],
  ['GB', 20],
  ['DE', 19],
  ['FR', 20],
  ['NL', 21],
  ['IE', 23],
  ['SE', 25],
]);

export function isSupportedBillingCountry(code: string): boolean {
  return RATE_TABLE.has(code);
}

export function vatRatePercent(billingCountry: string): number {
  const rate = RATE_TABLE.get(billingCountry);
  if (rate === undefined) {
    throw ApiError.validation({ billing_country: "We can't invoice that country yet." });
  }
  return rate;
}

/** VAT = net x rate, rounded half up to the cent. Integer cents end to end. */
export function vatCents(netCents: number, ratePercent: number): number {
  return Math.floor((netCents * ratePercent + 50) / 100);
}

export interface PricedAmount {
  readonly netCents: number;
  readonly vatRatePercent: number;
  readonly vatCents: number;
  readonly grossCents: number;
}

export function priceWithVat(netCents: number, billingCountry: string): PricedAmount {
  const ratePercent = vatRatePercent(billingCountry);
  const vat = vatCents(netCents, ratePercent);
  return {
    netCents,
    vatRatePercent: ratePercent,
    vatCents: vat,
    grossCents: netCents + vat,
  };
}
