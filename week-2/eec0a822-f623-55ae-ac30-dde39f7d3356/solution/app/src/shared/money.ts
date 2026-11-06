// Exact money and decimal arithmetic. Amounts are integer minor units; rates and measurements are
// exact decimal strings or whole centimetres. No float ever touches an amount.

/** The integer nearest num/den, ties away from zero. */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError("zero denominator");
  if (den < 0n) return roundHalfUp(-num, -den);
  const sign = num < 0n ? -1n : 1n;
  const abs = num < 0n ? -num : num;
  return sign * ((2n * abs + den) / (2n * den));
}

/** A decimal string as an exact fraction: "0.8450" -> [8450n, 10000n]. */
export function decimalFraction(text: string): [bigint, bigint] {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new RangeError(`not a decimal: ${text}`);
  const decimals = match[3] ?? "";
  const scale = 10n ** BigInt(decimals.length);
  const value = BigInt(match[2] + decimals) * (match[1] ? -1n : 1n);
  return [value, scale];
}

/** Round a decimal string half up to `places` decimals, exactly, returning a decimal string. */
export function roundDecimalText(text: string, places: number): string {
  const [num, den] = decimalFraction(text);
  const scale = 10n ** BigInt(places);
  const scaled = roundHalfUp(num * scale, den);
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const fraction = places ? `.${digits.slice(digits.length - places)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** The shortest decimal text of a finite double, without exponent notation. */
export function plainDecimal(value: number): string {
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

/** `EUR 12,450.00`: the code, a space, comma thousands and two decimals. */
export function formatMoney(currency: string, minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = String(abs % 100).padStart(2, "0");
  return `${currency} ${negative ? "-" : ""}${major}.${cents}`;
}

/** Minor units as a plain major-unit decimal string (`3614.07`), for typed fields and Kill Bill. */
export function minorToDecimal(minor: number): string {
  const abs = Math.abs(minor);
  return `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A typed euro amount with up to two decimals as minor units, or null when it is not one. */
export function parseMoneyText(text: string): number | null {
  const match = /^\s*(\d{1,12})(?:\.(\d{1,2}))?\s*$/.exec(text.replace(/,/g, ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Metres typed or sent as a number, as whole centimetres; null when it has more than two decimals. */
export function metresToCentimetres(text: string): number | null {
  const match = /^\s*(\d{1,4})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Whole centimetres as metres for the API: 1829 -> 18.29. */
export function centimetresToMetres(cm: number): number {
  return Number(`${Math.floor(cm / 100)}.${String(cm % 100).padStart(2, "0")}`);
}
