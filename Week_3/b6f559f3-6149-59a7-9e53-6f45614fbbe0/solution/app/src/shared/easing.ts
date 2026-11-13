import { FRAMES_PER_SECOND } from './format';
import type { Easing, EasingName, SpringEasing } from './types';

type Bezier = readonly [number, number, number, number];

const BEZIERS: Record<Exclude<EasingName, 'elastic' | 'bouncy'>, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  glide: [0.22, 1, 0.36, 1],
  anticipate: [0.36, 0, 0.66, -0.56],
};

export const SPRING_DEFAULTS: SpringEasing = { type: 'spring', stiffness: 170, damping: 26, mass: 1 };

function bezierAt(p1: number, p2: number, s: number): number {
  const inverse = 1 - s;
  return 3 * inverse * inverse * s * p1 + 3 * inverse * s * s * p2 + s * s * s;
}

function cubicBezier([x1, y1, x2, y2]: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (bezierAt(x1, x2, mid) < x) low = mid;
    else high = mid;
  }
  return bezierAt(y1, y2, (low + high) / 2);
}

function elastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((10 * t - 0.75) * 2 * Math.PI) / 3) + 1;
}

function bouncy(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
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

/** Spring position after `steps` fixed steps of 1/60 s, running from 0 toward 1. */
function spring({ stiffness, damping, mass }: SpringEasing, steps: number): number {
  let x = 0;
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a / FRAMES_PER_SECOND;
    x += v / FRAMES_PER_SECOND;
  }
  return x;
}

function isSpring(easing: Easing): easing is SpringEasing {
  return typeof easing === 'object';
}

/** Eased progress for `t` in 0..1; a spring ignores `t` and reads its own `frames` since the start keyframe. */
export function ease(easing: Easing, t: number, frames: number): number {
  if (isSpring(easing)) return spring(easing, frames);
  if (easing === 'elastic') return elastic(t);
  if (easing === 'bouncy') return bouncy(t);
  return cubicBezier(BEZIERS[easing], t);
}

/** The glide curve that eases follow-light values back to rest. */
export function glide(t: number): number {
  return cubicBezier(BEZIERS.glide, t);
}
