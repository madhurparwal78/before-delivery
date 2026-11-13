import { TICK_RATE } from './constants.js';

const MINUS_SIGN = '\u2212';
const MS_PER_TICK = 1000 / TICK_RATE;
const TICKS_PER_MINUTE = TICK_RATE * 60;

/** Milli-charge integers render as whole charge units with exactly three decimals. */
export function formatCharge(milli: number): string {
  const magnitude = Math.abs(milli);
  const whole = Math.floor(magnitude / 1000);
  const fraction = magnitude % 1000;
  const text = `${whole}.${String(fraction).padStart(3, '0')}`;
  return milli < 0 ? `${MINUS_SIGN}${text}` : text;
}

/** Ticks render as mm:ss.SSS game time. */
export function formatTick(tick: number): string {
  const minutes = Math.floor(tick / TICKS_PER_MINUTE);
  const seconds = Math.floor((tick % TICKS_PER_MINUTE) / TICK_RATE);
  const millis = (tick % TICK_RATE) * MS_PER_TICK;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Parses mm:ss.SSS game time, rejecting instants between simulation boundaries. */
export function parseTick(text: string): number | null {
  const match = /^(\d{2,}):([0-5]\d)\.(\d{3})$/.exec(text.trim());
  if (match === null) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const millis = Number(match[3]);
  if (millis % MS_PER_TICK !== 0) return null;
  return minutes * TICKS_PER_MINUTE + seconds * TICK_RATE + millis / MS_PER_TICK;
}

export function formatTenthsPercent(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  return `${whole}.${tenths % 10}%`;
}
