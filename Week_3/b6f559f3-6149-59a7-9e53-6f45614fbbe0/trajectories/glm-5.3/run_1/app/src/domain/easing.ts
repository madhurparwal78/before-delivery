// Easing presets, given exactly as published.
import type { Easing, EasingName, SpringSpec } from './types.js';

export interface BezierSpec {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const BEZIER: Record<Exclude<EasingName, 'elastic' | 'bouncy'>, BezierSpec> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  glide: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 },
  anticipate: { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 },
};

function cubicBezierY(x: number, b: BezierSpec): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Solve for t with x(t) = x by bisection on the parametric curve.
  const cx = (t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * b.x1 + 3 * u * t * t * b.x2 + t * t * t;
  };
  const cy = (t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * b.y1 + 3 * u * t * t * b.y2 + t * t * t;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cx(mid) < x) lo = mid;
    else hi = mid;
  }
  return cy((lo + hi) / 2);
}

export function elastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((10 * t - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

export function bouncy(t: number): number {
  // Standard out-bounce with n = 7.5625 and d = 2.75.
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
}

export function springValue(spec: SpringSpec, steps: number): number {
  let x = 0;
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const a = (-spec.stiffness * (x - 1) - spec.damping * v) / spec.mass;
    v += a / 60;
    x += v / 60;
  }
  return x;
}

export function easingValue(e: Easing, t: number, steps?: number): number {
  if (typeof e === 'string') {
    switch (e) {
      case 'elastic':
        return elastic(t);
      case 'bouncy':
        return bouncy(t);
      default:
        return cubicBezierY(t, BEZIER[e]);
    }
  }
  // Spring ignores segment length: E is x after (frame − start keyframe frame) steps.
  return springValue(e, Math.max(0, steps ?? 0));
}
