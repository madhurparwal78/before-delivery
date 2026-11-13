/**
 * Frame rates, the rounding rule and the timecode form.
 * Every time in Gatecut is a whole frame; every conversion below is decided here.
 */

export const FRAME_RATES = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] as const;
export type FrameRateName = (typeof FRAME_RATES)[number];

export interface ExactRate {
  readonly name: FrameRateName;
  /** numerator of the exact rate in frames per second */
  readonly num: bigint;
  /** denominator of the exact rate in frames per second */
  readonly den: bigint;
  /** nominal rate: the frame count of "one second" and the timecode modulus */
  readonly nominal: number;
}

const RATES: Record<FrameRateName, ExactRate> = {
  '23.976': { name: '23.976', num: 24000n, den: 1001n, nominal: 24 },
  '24': { name: '24', num: 24n, den: 1n, nominal: 24 },
  '25': { name: '25', num: 25n, den: 1n, nominal: 25 },
  '29.97': { name: '29.97', num: 30000n, den: 1001n, nominal: 30 },
  '30': { name: '30', num: 30n, den: 1n, nominal: 30 },
  '50': { name: '50', num: 50n, den: 1n, nominal: 50 },
  '59.94': { name: '59.94', num: 60000n, den: 1001n, nominal: 60 },
  '60': { name: '60', num: 60n, den: 1n, nominal: 60 },
};

export function isFrameRateName(value: unknown): value is FrameRateName {
  return typeof value === 'string' && Object.hasOwn(RATES, value);
}

export function exactRate(name: FrameRateName): ExactRate {
  return RATES[name];
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/**
 * The rounding rule: round an exact rational to the nearest whole number,
 * an exact half rounding up. Never computed in floating point.
 */
export function roundRational(num: bigint, den: bigint): number {
  const d = den < 0n ? -den : den;
  const n = den < 0n ? -num : num;
  return Number(floorDiv(2n * n + d, 2n * d));
}

/** Parse a decimal number written as text or given as a number into an exact rational. */
export function decimalToRational(value: string | number): { num: bigint; den: bigint } {
  const text = typeof value === 'number' ? formatPlain(value) : value.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error(`not a decimal number: ${text}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] === '' ? '0' : match[2];
  const fraction = match[3] ?? '';
  const den = 10n ** BigInt(fraction.length);
  return { num: sign * (BigInt(whole) * den + BigInt(fraction === '' ? '0' : fraction)), den };
}

function formatPlain(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
  if (Number.isInteger(value)) return value.toFixed(0);
  return value.toFixed(9).replace(/0+$/, '');
}

/** Seconds to frames: seconds × exact rate. */
export function secondsToFrames(seconds: string | number, rate: ExactRate): number {
  const s = decimalToRational(seconds);
  return roundRational(s.num * rate.num, s.den * rate.den);
}

/** MP4 header duration to source frames: duration × exact rate ÷ timescale. */
export function mp4DurationToFrames(duration: bigint, timescale: bigint, rate: ExactRate): number {
  return roundRational(duration * rate.num, timescale * rate.den);
}

/** WAV length to source frames: samples ÷ sample rate × exact rate. */
export function wavSamplesToFrames(samples: bigint, sampleRate: bigint, rate: ExactRate): number {
  return roundRational(samples * rate.num, sampleRate * rate.den);
}

/** SRT milliseconds to frames: ms × exact rate ÷ 1000. */
export function millisecondsToFrames(ms: number, rate: ExactRate): number {
  return roundRational(BigInt(ms) * rate.num, 1000n * rate.den);
}

/** Frames to SRT milliseconds: frame × 1000 ÷ exact rate. */
export function framesToMilliseconds(frame: number, rate: ExactRate): number {
  return roundRational(BigInt(frame) * 1000n * rate.den, rate.num);
}

/** Minutes for an export: frames ÷ exact rate ÷ 60, rounded up to a whole minute. */
export function framesToMinutesCeiling(frames: number, rate: ExactRate): number {
  if (frames <= 0) return 0;
  const num = BigInt(frames) * rate.den;
  const den = rate.num * 60n;
  const whole = num / den;
  return Number(num % den === 0n ? whole : whole + 1n);
}


/** Timecode is always HH:MM:SS:FF, non-drop, counted at the nominal rate from frame 0. */
export function timecode(frame: number, rate: ExactRate): string {
  const n = rate.nominal;
  const negative = frame < 0;
  const f = Math.abs(Math.trunc(frame));
  const frames = f % n;
  const totalSeconds = Math.floor(f / n);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const two = (v: number): string => String(v).padStart(2, '0');
  return `${negative ? '-' : ''}${two(hours)}:${two(minutes)}:${two(seconds)}:${two(frames)}`;
}

/** "One second" of keyboard movement is the nominal rate in frames. */
export function oneSecondInFrames(rate: ExactRate): number {
  return rate.nominal;
}

/** The frame rate as the manifest writes it: "<num>/<den>". */
export function rateFraction(rate: ExactRate): string {
  return `${rate.num}/${rate.den}`;
}
