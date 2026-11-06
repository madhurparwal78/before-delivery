// Frame arithmetic: exact rates, timecode, real seconds, target length and rate conversion.
// Everything here works on whole numbers; a rate is the fraction num/den.

export type FrameRate = '25' | '23.976' | '29.97';

export const FRAME_RATES: readonly FrameRate[] = ['25', '23.976', '29.97'];

interface Rate {
  num: number;
  den: number;
  nominal: number;
}

const RATES: Record<FrameRate, Rate> = {
  '25': { num: 25, den: 1, nominal: 25 },
  '23.976': { num: 24000, den: 1001, nominal: 24 },
  '29.97': { num: 30000, den: 1001, nominal: 30 },
};

/** Floor of a / b for whole numbers with a >= 0 and b > 0. */
export function divFloor(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** a / b rounded half up, on the exact value. */
export function divHalfUp(a: number, b: number): number {
  return divFloor(2 * a + b, 2 * b);
}

function divCeil(a: number, b: number): number {
  return divFloor(a + b - 1, b);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function nominalFrames(rate: FrameRate): number {
  return RATES[rate].nominal;
}

export function targetFrames(rate: FrameRate, targetSeconds: number): number {
  return targetSeconds * RATES[rate].nominal;
}

export function targetText(totalFrames: number, target: number): string {
  if (totalFrames === target) return 'exact';
  const difference = Math.abs(totalFrames - target);
  const unit = difference === 1 ? 'frame' : 'frames';
  return `${difference} ${unit} ${totalFrames > target ? 'over' : 'under'}`;
}

export function timecode(frame: number, rate: FrameRate): string {
  const { nominal } = RATES[rate];
  const drop = rate === '29.97';
  let label = frame;
  if (drop) {
    const tenMinutes = divFloor(frame, 17982);
    const rest = frame % 17982;
    label += 18 * tenMinutes + (rest >= 2 ? 2 * divFloor(rest - 2, 1798) : 0);
  }
  const frames = label % nominal;
  const totalSeconds = divFloor(label, nominal);
  const seconds = totalSeconds % 60;
  const totalMinutes = divFloor(totalSeconds, 60);
  const clock = `${pad(divFloor(totalMinutes, 60))}:${pad(totalMinutes % 60)}:${pad(seconds)}`;
  return `${clock}${drop ? ';' : ':'}${pad(frames)}`;
}

/** The frame a record column of an edit decision list starts from. */
export function recordStartFrame(rate: FrameRate): number {
  return rate === '29.97' ? 107892 : 3600 * RATES[rate].nominal;
}

/** Real seconds in hundredths, half up on the exact value. */
function hundredths(frames: number, rate: FrameRate): number {
  const { num, den } = RATES[rate];
  return divHalfUp(frames * den * 100, num);
}

function decimalText(value: number): string {
  return `${divFloor(value, 100)}.${pad(value % 100)}`;
}

/** `5.01`, the shot list's cell. */
export function secondsCell(frames: number, rate: FrameRate): string {
  return decimalText(hundredths(frames, rate));
}

/** `5.01 s`, the strip's numerals. */
export function secondsText(frames: number, rate: FrameRate): string {
  return `${secondsCell(frames, rate)} s`;
}

/** New whole frames that keep a real length as near as they can. */
function convertFrames(frames: number, from: FrameRate, to: FrameRate): number {
  const a = RATES[from];
  const b = RATES[to];
  return divHalfUp(frames * b.num * a.den, b.den * a.num);
}

export function convertClip(frames: number, from: FrameRate, to: FrameRate): number {
  return Math.max(1, convertFrames(frames, from, to));
}

export function convertPlayhead(frame: number, lastFrame: number, from: FrameRate, to: FrameRate): number {
  return Math.min(convertFrames(frame, from, to), Math.max(0, lastFrame));
}

/** Decimal text (digits, optional point) to frames, half up on the exact value. Never under 1. */
export function secondsToFrames(seconds: string, rate: FrameRate): number {
  const [whole = '0', fraction = ''] = seconds.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const value = BigInt(whole + fraction);
  const { num, den } = RATES[rate];
  const top = value * BigInt(num);
  const bottom = scale * BigInt(den);
  const frames = (2n * top + bottom) / (2n * bottom);
  return Math.max(1, Number(frames));
}

/** Percent geometry: half up to one decimal. */
export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Milliseconds between two playback steps. */
export function frameGapMs(rate: FrameRate): number {
  const { num, den } = RATES[rate];
  return (1000 * den) / num;
}

/** Words / 3 seconds, rounded up to a whole frame. */
export function readingFrames(words: number, rate: FrameRate): number {
  const { num, den } = RATES[rate];
  return divCeil(words * num, 3 * den);
}
