import type { BarMapSpan } from '../../shared/api.js';

export interface BarRange {
  from_bar: number;
  to_bar: number;
}

/** Nearest whole second; half a second rounds up. */
export function roundToSeconds(milliseconds: number): number {
  return Math.round(milliseconds / 1000);
}

function overlapBars(span: BarRange, other: BarRange): number {
  const from = Math.max(span.from_bar, other.from_bar);
  const to = Math.min(span.to_bar, other.to_bar);
  return to >= from ? to - from + 1 : 0;
}

/** The exact duration in milliseconds of a run of bars. */
export function barRangeMs(barMap: readonly BarMapSpan[], range: BarRange): number {
  return barMap.reduce((total, span) => total + overlapBars(span, range) * span.bar_ms, 0);
}

/** The exact duration in milliseconds of the bars a work still plays. */
export function uncutMs(barMap: readonly BarMapSpan[], cuts: readonly BarRange[]): number {
  const cutMs = cuts.reduce((total, cut) => total + barRangeMs(barMap, cut), 0);
  return fullMs(barMap) - cutMs;
}

export function fullMs(barMap: readonly BarMapSpan[]): number {
  return barMap.reduce((total, span) => total + (span.to_bar - span.from_bar + 1) * span.bar_ms, 0);
}

export function isBarCut(bar: number, cuts: readonly BarRange[]): boolean {
  return cuts.some((cut) => bar >= cut.from_bar && bar <= cut.to_bar);
}

export function cutBarCount(cuts: readonly BarRange[]): number {
  return cuts.reduce((total, cut) => total + (cut.to_bar - cut.from_bar + 1), 0);
}
