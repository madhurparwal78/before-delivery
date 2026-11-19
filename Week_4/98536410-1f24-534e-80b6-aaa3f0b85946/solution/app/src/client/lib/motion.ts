import { flushSync } from "react-dom";

const query = window.matchMedia("(prefers-reduced-motion: reduce)");

export function reducedMotion(): boolean {
  return query.matches;
}

export const easeOutQuint = (t: number): number => 1 - (1 - t) ** 5;
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Runs a state update and paints it in the same frame the caller is in. */
export function commit(update: () => void): void {
  flushSync(update);
}

export const MOTION = {
  sheetMs: 200,
  figureMs: 360,
  glideMs: 640,
  panelDelayMs: 170,
  dragHalfLifeMs: 240,
  dragStopSpeed: 0.5,
  clusterTravelMs: 280,
  clusterStaggerMs: 40,
  clusterStaggerSlots: 12,
  arrivalDropMs: 420,
  arrivalPulseMs: 600,
  rankTravelMs: 280,
  holdMeterMs: 250,
} as const;
