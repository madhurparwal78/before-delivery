/**
 * The fan's geometry, in one place for the server's first paint and the browser's scrubbing.
 *
 * With s = value ÷ 100 and gap g, part k (counted from 0 in booklet order) moves
 * round(s × k × g) px along the model's axis. All rounding is half up on the exact value.
 */

export type FanAxis = 'x' | 'y' | 'iso';

export const FAN_GAP_WIDE = 48;
export const FAN_GAP_NARROW = 28;
/** The gap is the wide one from 768 px up. */
export const FAN_WIDE_FROM = 768;

const COS_30 = Math.cos(Math.PI / 6);
const SIN_30 = 0.5;

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function gapFor(windowWidth: number): number {
  return windowWidth >= FAN_WIDE_FROM ? FAN_GAP_WIDE : FAN_GAP_NARROW;
}

export function partOffset(value: number, index: number, gap: number): number {
  return roundHalfUp((value / 100) * index * gap);
}

export function fanSeparation(value: number, partCount: number, gap: number): number {
  return roundHalfUp((value / 100) * gap * Math.max(partCount - 1, 0));
}

/** From "1.000" down to "0.750", with exactly 3 decimals, rounded half up. */
export function fanScale(value: number): string {
  const exact = 1 - 0.25 * (value / 100);
  return (roundHalfUp(exact * 1000) / 1000).toFixed(3);
}

/** How far the part moves on screen, along its axis. */
export function offsetVector(axis: FanAxis, offset: number): { dx: number; dy: number } {
  if (axis === 'x') return { dx: offset, dy: 0 };
  if (axis === 'y') return { dx: 0, dy: offset };
  // `iso` moves up and to the right along a line 30 degrees above horizontal.
  return { dx: offset * COS_30, dy: -offset * SIN_30 };
}

export function offsetStyle(axis: FanAxis, offset: number): string {
  const { dx, dy } = offsetVector(axis, offset);
  return `--dx:${dx.toFixed(3)}px;--dy:${dy.toFixed(3)}px`;
}

/** The published slider steps; values clamp at 0 and 100. */
export function sliderValueForKey(key: string, current: number): number | null {
  const steps: Record<string, number> = {
    ArrowRight: 5,
    ArrowUp: 5,
    ArrowLeft: -5,
    ArrowDown: -5,
    PageUp: 25,
    PageDown: -25,
  };
  if (key === 'Home') return 0;
  if (key === 'End') return 100;
  const step = steps[key];
  if (step === undefined) return null;
  return Math.min(100, Math.max(0, current + step));
}
