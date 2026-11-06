// The critically damped spring for the drawer and the bottom sheet, with
// velocity carried into every retarget. The single home of the spring.

import { SPRING } from "./constants.js";

export interface SpringState {
  offset: number; // pixels from closed
  velocity: number; // pixels per second
}

/**
 * The drawer and sheet spring, per the published formulas. From offset x0
 * and velocity v0 toward target T, at t seconds since the retarget:
 * offset = T + (x0 − T + (v0 + ω(x0 − T)) × t) × e^(−ω × t),
 * velocity = (v0 − ω × (v0 + ω(x0 − T)) × t) × e^(−ω × t).
 */
export function springStep(state: SpringState, target: number, dt: number): SpringState {
  const w = SPRING.omega;
  const c1 = state.offset - target;
  const c2 = state.velocity + w * c1;
  const e = Math.exp(-w * dt);
  const offset = target + (c1 + c2 * dt) * e;
  const velocity = (state.velocity - w * c2 * dt) * e;
  return { offset, velocity };
}

/** Settled within 0.5px of the target and slower than 10 px/s. */
export function springSettled(state: SpringState, target: number): boolean {
  return Math.abs(state.offset - target) < SPRING.settleDistance && Math.abs(state.velocity) < SPRING.settleVelocity;
}

/**
 * Drive the spring on the browser animation-frame clock. Retargeting
 * carries the current offset and velocity into the new target.
 */
export interface SpringHandle {
  retarget: (target: number) => void;
  cancel: () => SpringState;
}

export function runSpring(
  start: SpringState,
  target: number,
  onFrame: (offset: number) => void,
  onSettled: (final: SpringState) => void
): SpringHandle {
  let state = { ...start };
  let currentTarget = target;
  let raf = 0;
  let stopped = false;
  let last = performance.now();
  const tick = (now: number): void => {
    if (stopped) return;
    const dt = Math.min((now - last) / 1000, 0.064);
    last = now;
    state = springStep(state, currentTarget, dt);
    onFrame(state.offset);
    if (springSettled(state, currentTarget)) {
      state = { offset: currentTarget, velocity: 0 };
      onFrame(currentTarget);
      onSettled(state);
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    retarget: (newTarget: number) => {
      currentTarget = newTarget;
      if (stopped) {
        stopped = false;
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
    cancel: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      return state;
    },
  };
}
