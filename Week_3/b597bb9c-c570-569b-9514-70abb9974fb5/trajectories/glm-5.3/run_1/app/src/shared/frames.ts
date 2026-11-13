import { rat, ratFromDecimal, ratMul, ratDiv, roundRational, ratSub, ratAdd, type Rational } from './rational';

/**
 * Whole-frame time. Every stored time is a whole frame, every conversion
 * follows the published rounding rule and every timecode uses HH:MM:SS:FF
 * counted at the nominal rate.
 */
export interface FrameRate {
  readonly label: string;
  readonly exact: Rational;
  readonly nominal: number;
}

const RATE_TABLE: readonly FrameRate[] = [
  { label: '23.976', exact: rat(24000n, 1001n), nominal: 24 },
  { label: '24', exact: rat(24n), nominal: 24 },
  { label: '25', exact: rat(25n), nominal: 25 },
  { label: '29.97', exact: rat(30000n, 1001n), nominal: 30 },
  { label: '30', exact: rat(30n), nominal: 30 },
  { label: '50', exact: rat(50n), nominal: 50 },
  { label: '59.94', exact: rat(60000n, 1001n), nominal: 60 },
  { label: '60', exact: rat(60n), nominal: 60 },
];

export const FRAME_RATES: readonly string[] = RATE_TABLE.map((r) => r.label);

export function frameRate(label: string): FrameRate {
  const rate = RATE_TABLE.find((r) => r.label === label);
  if (rate === undefined) throw new Error(`unknown frame rate ${label}`);
  return rate;
}

export function isFrameRate(label: string): boolean {
  return RATE_TABLE.some((r) => r.label === label);
}

export interface AspectSize {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const ASPECT_TABLE: readonly AspectSize[] = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:5', width: 1080, height: 1350 },
];

export const ASPECT_RATIOS: readonly string[] = ASPECT_TABLE.map((a) => a.label);

export function aspectSize(label: string): AspectSize {
  const size = ASPECT_TABLE.find((a) => a.label === label);
  if (size === undefined) throw new Error(`unknown aspect ratio ${label}`);
  return size;
}

export function isAspectRatio(label: string): boolean {
  return ASPECT_TABLE.some((a) => a.label === label);
}

/** Seconds (exact decimal) to frames by the rounding rule. */
export function secondsToFrames(seconds: string | number, rateLabel: string): number {
  const r = typeof seconds === 'number' ? ratFromDecimal(seconds.toString()) : ratFromDecimal(seconds);
  return roundRational(ratMul(r, frameRate(rateLabel).exact));
}

/** MP4 header duration (in the movie timescale) to source frames. */
export function mp4DurationToFrames(duration: number, timescale: number, rateLabel: string): number {
  return roundRational(ratMul(rat(duration, timescale), frameRate(rateLabel).exact));
}

/** WAV length (sample frames at the given sample rate) to source frames. */
export function wavSamplesToFrames(samples: number, sampleRate: number, rateLabel: string): number {
  return roundRational(ratMul(rat(samples, sampleRate), frameRate(rateLabel).exact));
}

/** SRT milliseconds to frames. */
export function srtMsToFrames(ms: number, rateLabel: string): number {
  return roundRational(ratMul(rat(ms), ratDiv(frameRate(rateLabel).exact, rat(1000n))));
}

/** Frames to SRT milliseconds by the rounding rule. */
export function framesToSrtMs(frame: number, rateLabel: string): number {
  return roundRational(ratMul(rat(frame * 1000), ratDiv(rat(1n), frameRate(rateLabel).exact)));
}

/** A clip's length: (source_out − source_in) × 100 ÷ speed_percent. */
export function clipLength(sourceIn: number, sourceOut: number, speedPercent: number): number {
  return roundRational(ratMul(rat(sourceOut - sourceIn), rat(100n, BigInt(speedPercent))));
}

/** A trim changes the source edge by delta_frames × speed_percent ÷ 100. */
export function trimSourceDelta(deltaFrames: number, speedPercent: number): number {
  return roundRational(ratMul(rat(deltaFrames), rat(BigInt(speedPercent), 100n)));
}

/** Timecode: HH:MM:SS:FF, non-drop, counted at the nominal rate from frame 0. */
export function timecode(frame: number, rateLabel: string): string {
  const nominal = frameRate(rateLabel).nominal;
  const f = Math.max(0, Math.floor(frame));
  const ff = f % nominal;
  const totalSeconds = Math.floor(f / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

/** The nominal rate in frames is "one second" of keyboard movement. */
export function oneSecond(rateLabel: string): number {
  return frameRate(rateLabel).nominal;
}

export { ratAdd, ratSub };
