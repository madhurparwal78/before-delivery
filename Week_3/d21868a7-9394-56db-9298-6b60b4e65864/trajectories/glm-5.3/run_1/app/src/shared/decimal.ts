// Exact decimal arithmetic for ML and ML/day quantities.
// Values are scaled BigInt with a decimal scale, so no binary floating
// point is ever involved.

export type Decimal = { readonly s: bigint; readonly scale: number };

export function decParse(raw: string | number | null | undefined): Decimal | null {
  if (raw === null || raw === undefined) return null;
  let text = typeof raw === "number" ? String(raw) : raw.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const neg = text.startsWith("-");
  if (neg || text.startsWith("+")) text = text.slice(1);
  const dot = text.indexOf(".");
  const intPart = dot < 0 ? text : text.slice(0, dot);
  const fracPart = dot < 0 ? "" : text.slice(dot + 1);
  const s = BigInt(intPart || "0") * 10n ** BigInt(fracPart.length) + BigInt(fracPart || "0");
  return { s: neg ? -s : s, scale: fracPart.length };
}

export function decScaleTo(d: Decimal, scale: number): Decimal {
  if (d.scale === scale) return d;
  if (d.scale < scale) return { s: d.s * 10n ** BigInt(scale - d.scale), scale };
  const drop = d.scale - scale;
  const div = 10n ** BigInt(drop);
  const q = d.s / div;
  const r = ((d.s % div) * 2n) / div;
  return { s: q + r, scale };
}

export function decFromInt(n: number | bigint): Decimal {
  return { s: BigInt(n), scale: 0 };
}

export function decAdd(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { s: decScaleTo(a, scale).s + decScaleTo(b, scale).s, scale };
}

export function decSub(a: Decimal, b: Decimal): Decimal {
  return decAdd(a, { s: -b.s, scale: b.scale });
}

export function decMul(a: Decimal, b: Decimal): Decimal {
  return { s: a.s * b.s, scale: a.scale + b.scale };
}

// exact division to a target scale, halves rounded up.
// a/b = (a.s × 10^(a.scale' - a.scale)) / (b.s × 10^(b.scale' - b.scale)) with
// scale' = max scales, so the powers of ten cancel; the quotient is then
// scaled to the target scale with a single half-up remainder step.
export function decDiv(a: Decimal, b: Decimal, scale: number): Decimal {
  if (b.s === 0n) throw new Error("division by zero");
  const k = Math.max(a.scale, b.scale, scale);
  const num = decScaleTo(a, k).s * 10n ** BigInt(scale);
  const den = decScaleTo(b, k).s;
  const neg = num < 0n !== den < 0n;
  const aa = num < 0n ? -num : num;
  const bb = den < 0n ? -den : den;
  let q = aa / bb;
  const r = (aa % bb) * 2n;
  if (r >= bb) q += 1n;
  return { s: neg ? -q : q, scale };
}

// round down (toward zero) to 0.001
export function decTrunc3(a: Decimal): Decimal {
  if (a.scale <= 3) return { s: a.s * 10n ** BigInt(3 - a.scale), scale: 3 };
  const div = 10n ** BigInt(a.scale - 3);
  return { s: a.s / div, scale: 3 };
}

// round half-up to 3 decimals (the one conversion rounding rule)
export function decRound3(a: Decimal): Decimal {
  const scaled = decScaleTo(a, 4);
  let q = scaled.s / 10n;
  const r = ((scaled.s % 10n) * 2n) / 10n;
  if (r >= 1n) q += 1n;
  return { s: q, scale: 3 };
}

export function decCmp(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const x = decScaleTo(a, scale).s;
  const y = decScaleTo(b, scale).s;
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

export function decIsZero(a: Decimal): boolean {
  return a.s === 0n;
}

export function decEq(a: Decimal, b: Decimal): boolean {
  return decCmp(a, b) === 0;
}

// 3-decimal string, e.g. "10.000"
export function decStr3(a: Decimal): string {
  const r = decRound3(a);
  const neg = r.s < 0n;
  const abs = neg ? -r.s : r.s;
  const int = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${int.toString()}.${frac}`;
}

// count of decimal places in a decimal literal, or null when malformed
export function decimalPlaces(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const dot = t.indexOf(".");
  return dot < 0 ? 0 : t.length - dot - 1;
}
