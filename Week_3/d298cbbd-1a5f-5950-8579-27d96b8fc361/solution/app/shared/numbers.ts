/** Half-up rounding to two decimals, exact for ratios and decimal-exact for floating-point values. */

export interface Ratio {
  readonly num: number;
  readonly den: number;
}

export function ratioValue(ratio: Ratio): number {
  return ratio.num / ratio.den;
}

/** Hundredths of a non-negative ratio, rounded half up. */
export function ratioHundredths(ratio: Ratio): number {
  return Math.floor((200 * ratio.num + ratio.den) / (2 * ratio.den));
}

/** Hundredths of a finite number, rounded half up on its shortest decimal form (ties go away from zero). */
export function numberHundredths(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  if (magnitude >= 1e15) return sign * Number(BigInt(Math.round(magnitude)) * 100n);
  const text = magnitude.toString();
  const [whole = "0", fraction = ""] = (text.includes("e") ? magnitude.toFixed(20) : text).split(".");
  let hundredths = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  if (fraction.charAt(2) >= "5" && fraction.charAt(2) !== "") hundredths += 1;
  return sign * hundredths;
}

export function fromHundredths(hundredths: number): number {
  return hundredths / 100;
}

export function formatHundredths(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  return `${whole}.${String(Math.abs(hundredths % 100)).padStart(2, "0")}`;
}

/** Whole number, rounded half up. */
export function wholeHalfUp(ratio: Ratio): number {
  return Math.floor((2 * ratio.num + ratio.den) / (2 * ratio.den));
}
