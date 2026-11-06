/**
 * Exact decimal money arithmetic in minor units (centimes/rappen).
 * Never uses binary floating point for amounts.
 */
export type Minor = bigint;

export function toMinor(amount: string): Minor {
  const negative = amount.startsWith('-');
  const digits = negative ? amount.slice(1) : amount;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(digits);
  if (!match) throw new Error(`Not a money amount: ${amount}`);
  const whole = BigInt(match[1] ?? '0');
  const frac = BigInt((match[2] || '').padEnd(2, '0').slice(0, 2) || '0');
  const minor = whole * 100n + frac;
  return negative ? -minor : minor;
}

export function fromMinor(minor: Minor): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const text = `${whole}.${frac.toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

export function sumMinor(values: Minor[]): Minor {
  return values.reduce((acc, value) => acc + value, 0n);
}

/** Round half up to the nearest multiple of `step` minor units. */
export function roundHalfUp(minor: Minor, step: bigint = 1n): Minor {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const half = step / 2n;
  const rounded = (abs + half) / step * step;
  return negative ? -rounded : rounded;
}

export const VAT_RATE_BASIS = 10000n; // VAT = net × 810 / 10000 (8.1%)

/** quantity (≤2 decimals) as an integer scaled by 100. */
export function quantityCenti(quantity: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(quantity);
  if (!match) return null;
  return BigInt(match[1] ?? '0') * 100n + BigInt((match[2] || '').padEnd(2, '0').slice(0, 2) || '0');
}

/** Line net = quantity × unit price, rounded half up to 0.01. */
export function lineNetMinor(quantity: string, unitPrice: string): Minor {
  const q = quantityCenti(quantity);
  if (q === null) throw new Error(`Not a quantity: ${quantity}`);
  const price = toMinor(unitPrice);
  // q × price is net × 10000; net in minor units = net × 100
  return roundHalfUp(q * price, 100n) / 100n;
}

/** Line VAT = net × 8.1%, rounded half up to 0.01. */
export function lineVatMinor(netMinor: Minor): Minor {
  return roundHalfUp(netMinor * 810n, VAT_RATE_BASIS) / VAT_RATE_BASIS;
}

export interface Totals {
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
}

/** Exact totals from per-line net and VAT values (already rounded per line). */
export function computeTotals(lineNets: string[], lineVats: string[]): Totals {
  const net = sumMinor(lineNets.map(toMinor));
  const vat = sumMinor(lineVats.map(toMinor));
  const unrounded = net + vat;
  const total = roundHalfUp(unrounded, 5n); // nearest five centimes
  const rounding = total - unrounded;
  return {
    net_total: fromMinor(net),
    vat_total: fromMinor(vat),
    rounding: fromMinor(rounding),
    total: fromMinor(total),
  };
}
