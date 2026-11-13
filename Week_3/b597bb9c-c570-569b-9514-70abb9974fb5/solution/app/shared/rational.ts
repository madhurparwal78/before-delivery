export type RateLabel = "23.976" | "24" | "25" | "29.97" | "30" | "50" | "59.94" | "60";

export interface FrameRate {
  readonly label: RateLabel;
  readonly num: bigint;
  readonly den: bigint;
  readonly nominal: number;
}

const FRAME_RATES: readonly FrameRate[] = [
  { label: "23.976", num: 24000n, den: 1001n, nominal: 24 },
  { label: "24", num: 24n, den: 1n, nominal: 24 },
  { label: "25", num: 25n, den: 1n, nominal: 25 },
  { label: "29.97", num: 30000n, den: 1001n, nominal: 30 },
  { label: "30", num: 30n, den: 1n, nominal: 30 },
  { label: "50", num: 50n, den: 1n, nominal: 50 },
  { label: "59.94", num: 60000n, den: 1001n, nominal: 60 },
  { label: "60", num: 60n, den: 1n, nominal: 60 },
];

export const RATE_LABELS: readonly RateLabel[] = FRAME_RATES.map((rate) => rate.label);

export function rateOf(label: string): FrameRate {
  const rate = FRAME_RATES.find((candidate) => candidate.label === label);
  if (!rate) throw new Error(`unknown frame rate ${label}`);
  return rate;
}

export function isRateLabel(value: unknown): value is RateLabel {
  return typeof value === "string" && FRAME_RATES.some((rate) => rate.label === value);
}

function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? quotient - 1n : quotient;
}

/** The rounding rule: the exact rational num/den, to the nearest whole number, an exact half rounding up. */
export function roundExact(num: bigint, den: bigint): number {
  if (den < 0n) return roundExact(-num, -den);
  return Number(floorDiv(2n * num + den, 2n * den));
}

/** Rounding of a double that already is the published fraction (pixels, percents): half up. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** seconds (num/den) x exact rate. */
export function secondsToFrames(rate: FrameRate, secondsNum: bigint, secondsDen: bigint): number {
  return roundExact(secondsNum * rate.num, secondsDen * rate.den);
}

export function msToFrames(rate: FrameRate, ms: number): number {
  return roundExact(BigInt(ms) * rate.num, 1000n * rate.den);
}

export function framesToMs(rate: FrameRate, frame: number): number {
  return roundExact(BigInt(frame) * 1000n * rate.den, rate.num);
}

/** Length of a source range at a speed: (out - in) x 100 / speed. */
export function lengthAtSpeed(sourceFrames: number, speedPercent: number): number {
  return roundExact(BigInt(sourceFrames) * 100n, BigInt(speedPercent));
}

/** Source frames covered by a timeline distance at a speed: delta x speed / 100. */
export function sourceAtSpeed(timelineFrames: number, speedPercent: number): number {
  return roundExact(BigInt(timelineFrames) * BigInt(speedPercent), 100n);
}

/** Parse a decimal string such as "12.34" into an exact numerator and denominator. */
export function decimalToFraction(text: string): { num: bigint; den: bigint } {
  const [whole = "0", fraction = ""] = text.split(".");
  return { num: BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) };
}

export function formatRational(rate: FrameRate): string {
  return `${rate.num}/${rate.den}`;
}
