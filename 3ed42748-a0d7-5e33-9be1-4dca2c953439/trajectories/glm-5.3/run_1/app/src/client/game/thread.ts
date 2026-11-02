// The Horizon thread: the signature sequence and its phases, timed by the page clock and
// resumed by elapsed real time after a hidden page.

import type { LatLon } from "../../shared/geometry.js";

export type ThreadPhase = "idle" | "pullback" | "unspool" | "return" | "walking" | "arrived" | "handing" | "delivered" | "rewind";

export type ThreadState = {
  phase: ThreadPhase;
  routeId: string;
  door: LatLon | null;
  totalArcM: number;
  startedAt: number;
  phaseStartedAt: number;
  rewindFromFraction: number;
  announcedArrival: boolean;
};

export const PULLBACK_MS = 420; // 0.3–0.55 s
export const UNSPOOL_MS = 600; // 0.5–0.75 s
export const RETURN_MS = 350; // 0.25–0.5 s
export const REWIND_MS = 320; // 0.25–0.4 s
export const DELIVERED_FADE_MS = 250;

export function newThreadState(): ThreadState {
  return {
    phase: "idle",
    routeId: "",
    door: null,
    totalArcM: 0,
    startedAt: 0,
    phaseStartedAt: 0,
    rewindFromFraction: 1,
    announcedArrival: false,
  };
}

/** Which phase a thread started at `startedAt` should be in at `now`, from elapsed real time. */
export function phaseAtElapsed(startedAt: number, now: number): ThreadPhase {
  const elapsed = now - startedAt;
  if (elapsed < PULLBACK_MS) return "pullback";
  if (elapsed < PULLBACK_MS + UNSPOOL_MS) return "unspool";
  if (elapsed < PULLBACK_MS + UNSPOOL_MS + RETURN_MS) return "return";
  return "walking";
}

/** The ribbon fraction shown during the pull-back, unspool and return phases. */
export function unspoolFraction(startedAt: number, now: number): number {
  const elapsed = now - startedAt;
  if (elapsed <= PULLBACK_MS) return 0;
  if (elapsed >= PULLBACK_MS + UNSPOOL_MS) return 1;
  return (elapsed - PULLBACK_MS) / UNSPOOL_MS;
}

/** Interpolates a rewind from its starting fraction down to zero. */
export function rewindFraction(from: number, rewindStartedAt: number, now: number): number {
  const t = (now - rewindStartedAt) / REWIND_MS;
  if (t >= 1) return 0;
  return from * (1 - t);
}
