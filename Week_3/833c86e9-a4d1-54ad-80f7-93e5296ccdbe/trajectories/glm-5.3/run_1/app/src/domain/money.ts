export type CurrencyCode = "EUR" | "USD" | "JPY" | "KWD";

export const CURRENCIES: CurrencyCode[] = ["EUR", "USD", "JPY", "KWD"];

export const DECIMALS: Record<CurrencyCode, number> = { EUR: 2, USD: 2, JPY: 0, KWD: 3 };

/** half-up division of integers: round(a/b) */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("division by zero");
  const neg = a < 0n;
  const x = neg ? -a : a;
  const q = (2n * x + b) / (2n * b);
  return neg ? -q : q;
}

/** x − round(x × p / 100) */
export function off(x: number, p: number): number {
  return x - Number(divRound(BigInt(x) * BigInt(p), 100n));
}

/** round(x × p / q) with integers */
export function roundMul(x: number, p: number, q: number): number {
  return Number(divRound(BigInt(x) * BigInt(p), BigInt(q)));
}

export type RatesPpm = Record<CurrencyCode, number>;

export const DEFAULT_RATES: RatesPpm = { EUR: 1000000, USD: 1080000, JPY: 161500000, KWD: 332000 };

/** Convert one EUR-minor amount to the target currency's minor units, half up. */
export function convert(amountMinor: number, ppm: number, decimals: number): number {
  return Number(divRound(BigInt(amountMinor) * BigInt(ppm) * 10n ** BigInt(decimals), 100n * 1000000n));
}

/** The converted total over all nights (amounts in EUR minor). */
export function convertTotal(amounts: number[], ppm: number, decimals: number): number {
  const scale = 10n ** BigInt(decimals);
  let sum = 0n;
  for (const a of amounts) sum += BigInt(a) * BigInt(ppm) * scale;
  return Number(divRound(sum, 100n * 1000000n));
}

/** exact share of one night: whole part and a fractional numerator scaled for ranking */
function exactShare(a: number, ppm: number, decimals: number): { whole: bigint; fracNum: bigint } {
  const scale = 10n ** BigInt(decimals);
  const v = BigInt(a) * BigInt(ppm) * scale;
  const den = 100n * 1000000n;
  return { whole: v / den, fracNum: (v % den) * 1000000n / den };
}

/**
 * Split the converted total across nights so they add up exactly.
 * Each night takes the whole part of its exact share; missing units go one each
 * to the nights with the largest fractional parts, ties to the earlier night.
 */
export function splitAcrossNights(amounts: number[], ppm: number, decimals: number): number[] {
  if (amounts.length === 0) return [];
  const shares = amounts.map((a) => exactShare(a, ppm, decimals));
  let wholeSum = 0n;
  for (const s of shares) wholeSum += s.whole;
  const total = BigInt(convertTotal(amounts, ppm, decimals));
  let missing = total - wholeSum;
  const order = shares.map((s, i) => ({ i, frac: s.fracNum })).sort((x, y) =>
    x.frac === y.frac ? x.i - y.i : x.frac > y.frac ? -1 : 1
  );
  const out = shares.map((s) => Number(s.whole));
  for (let k = 0; missing > 0n && k < order.length; k++ , missing -= 1n) out[order[k].i] += 1;
  return out;
}
