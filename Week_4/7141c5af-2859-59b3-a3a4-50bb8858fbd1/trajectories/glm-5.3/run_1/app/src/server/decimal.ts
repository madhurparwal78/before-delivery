/** Exact decimal arithmetic on scaled integers; no binary float for money. */
export type Dec = { v: bigint }; // value × 10^8

const SCALE = 8n;

export function decParse(s: string | number | null | undefined): Dec | null {
  if (s === null || s === undefined) return null;
  let str = String(s).trim();
  if (str === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(str)) return null;
  const neg = str.startsWith("-");
  if (neg) str = str.slice(1);
  const [i, f = ""] = str.split(".");
  const frac = f.slice(0, 8).padEnd(8, "0");
  return { v: (neg ? -1n : 1n) * (BigInt(i) * 10n ** SCALE + BigInt(frac)) };
}
export const decFromMinor = (minor: number | bigint, currency: string): Dec => {
  const scale = currency === "JPY" ? 0n : 2n;
  return { v: BigInt(minor) * 10n ** (SCALE - scale) };
};
export const decToMinor = (d: Dec, currency: string): number => {
  const scale = currency === "JPY" ? 0n : 2n;
  return Number(d.v / 10n ** (SCALE - scale));
};
/** Half-up rounding to n decimals. */
export function decRound(d: Dec, n: number): Dec {
  const factor = 10n ** (SCALE - BigInt(n));
  const rem = d.v % factor;
  const base = d.v / factor;
  const half = factor / 2n;
  const up = rem < 0n ? -rem >= half : rem >= half;
  const adj = rem < 0n ? (up ? -1n : 0n) : up ? 1n : 0n;
  return { v: (base + adj) * factor };
}
/** Round half up to minor units; returns minor units as integer. */
export const decToMinorHalfUp = (d: Dec, currency: string): number => {
  const scale = currency === "JPY" ? 0n : 2n;
  const factor = 10n ** (SCALE - scale);
  const rem = d.v % factor;
  const base = d.v / factor;
  const half = factor / 2n;
  const up = rem < 0n ? -rem >= half : rem >= half;
  const adj = rem < 0n ? (up ? -1n : 0n) : up ? 1n : 0n;
  return Number(base + adj);
};
export const decMul = (a: Dec, b: Dec): Dec => {
  const product = a.v * b.v; // (a×10^8)(b×10^8) = ab×10^16
  return { v: product / 10n ** SCALE }; // ab×10^8
};
export const decAdd = (a: Dec | null, b: Dec | null): Dec => ({ v: (a?.v ?? 0n) + (b?.v ?? 0n) });
export const decSub = (a: Dec, b: Dec): Dec => ({ v: a.v - b.v });
export const decDiv = (a: Dec, b: Dec): Dec => ({ v: (a.v * 10n ** SCALE) / b.v });
export const decCmp = (a: Dec, b: Dec): number => (a.v === b.v ? 0 : a.v > b.v ? 1 : -1);
export const decIsZero = (a: Dec) => a.v === 0n;
export const decGte = (a: Dec, b: Dec) => a.v >= b.v;
export const decLt = (a: Dec, b: Dec) => a.v < b.v;
export const decFromInt = (n: number): Dec => ({ v: BigInt(n) * 10n ** SCALE });
export const decToString = (d: Dec, n = 2): string => {
  const r = decRound(d, n);
  const neg = r.v < 0n;
  const abs = neg ? -r.v : r.v;
  const int = abs / 10n ** SCALE;
  const frac = (abs % 10n ** SCALE) / 10n ** (SCALE - BigInt(n));
  const fs = n > 0 ? "." + frac.toString().padStart(n, "0") : "";
  return `${neg ? "-" : ""}${int}${fs}`;
};

export type Currency = "EUR" | "GBP" | "USD" | "JPY" | "AED";
export const currencyMinorScale: Record<Currency, number> = { EUR: 2, GBP: 2, USD: 2, JPY: 0, AED: 2 };
export const currencySymbol: Record<Currency, string> = { EUR: "€", GBP: "£", USD: "US$", JPY: "¥", AED: "AED " };

/** Print a minor-unit amount in the published form. */
export function printMinor(minor: number, currency: Currency): string {
  const scale = currencyMinorScale[currency];
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const i = Math.trunc(abs / 10 ** scale);
  const f = abs % 10 ** scale;
  const fs = scale > 0 ? "." + String(f).padStart(scale, "0") : "";
  const grouped = i.toLocaleString("en-US");
  return `${sign}${currencySymbol[currency]}${grouped}${fs}`;
}
/** Print a decimal string (already exact) in the published form, e.g. "412.50" EUR → "€412.50". */
export function printAmount(value: string, currency: Currency): string {
  const d = decParse(value)!;
  const scale = currencyMinorScale[currency];
  const rounded = decToMinorHalfUp(d, currency);
  return printMinor(rounded, currency);
}

/** Milestones: 30/40/30 of the total in minor units rounded down, remainder one each to the earlier milestones first. */
export function milestoneSplit(totalMinor: number, currency: Currency): { percent: number; amountMinor: number }[] {
  const percents = [30, 40, 30];
  const shares = percents.map((p) => Math.floor((totalMinor * p) / 100));
  let remainder = totalMinor - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; i < shares.length && remainder > 0; i++) {
    shares[i]! += 1;
    remainder -= 1;
  }
  return percents.map((p, i) => ({ percent: p, amountMinor: shares[i]! }));
}

/** Quarter metres rounded up. */
export function quarterMetresUp(metres: Dec): Dec {
  const q = 25n * 10n ** (SCALE - 2n); // 0.25 in Dec scale
  return { v: ((metres.v + q - 1n) / q) * q };
}
/** Ceiling division of two same-scale decimals, staying in Dec scale. */
export function ceilDiv(a: Dec, b: Dec): Dec {
  if (b.v === 0n) return { v: 0n };
  const q = a.v / b.v;
  const rem = a.v % b.v;
  return { v: (rem === 0n ? q : q + 1n) * 10n ** SCALE };
}
export const SQFT_TO_SQCM = 929.0304;
export const sqcmToSqft = (sqcm: number): Dec => decDiv(decFromInt(sqcm), { v: BigInt(Math.round(SQFT_TO_SQCM * 10 ** 6)) * 100n });
