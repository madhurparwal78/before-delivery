// Running time and cut saving, derived from the bar map and the stored cuts on every read.

import type { BarSegment } from "../../shared/api.js";

interface BarSpan {
  from_bar: number;
  to_bar: number;
}

/** Exact milliseconds of the bars from `from` to `to` inclusive. */
export function spanMs(barMap: BarSegment[], from: number, to: number): number {
  return barMap.reduce((total, segment) => {
    const bars = Math.min(segment.to_bar, to) - Math.max(segment.from_bar, from) + 1;
    return total + Math.max(bars, 0) * segment.bar_ms;
  }, 0);
}

/** Exact milliseconds of the work's uncut bars. */
export function uncutMs(barMap: BarSegment[], cuts: BarSpan[]): number {
  const bars = barMap.at(-1)?.to_bar ?? 0;
  return spanMs(barMap, 1, bars) - cuts.reduce((total, cut) => total + spanMs(barMap, cut.from_bar, cut.to_bar), 0);
}

/** Nearest whole second, half a second rounding up. */
export function wholeSeconds(ms: number): number {
  return Math.floor((ms + 500) / 1000);
}
