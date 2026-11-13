import type { Easing, EasingName, SpringEasing } from './types';

export const EASING_NAMES: EasingName[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'glide',
  'anticipate',
  'elastic',
  'bouncy',
];

export const EASING_DISPLAY: Record<EasingName, string> = {
  linear: 'Linear',
  ease: 'Ease',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in-out',
  glide: 'Glide',
  anticipate: 'Anticipate',
  elastic: 'Elastic',
  bouncy: 'Bouncy',
};

const BEZIERS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  glide: [0.22, 1, 0.36, 1],
  anticipate: [0.36, 0, 0.66, -0.56],
};

export const SPRING_DEFAULTS: SpringEasing = {
  type: 'spring',
  stiffness: 170,
  damping: 26,
  mass: 1,
};

export const SPRING_RANGES = {
  stiffness: { min: 1, max: 1000, step: 1, shiftStep: 10, field: 'Spring stiffness' },
  damping: { min: 0, max: 100, step: 1, shiftStep: 10, field: 'Spring damping' },
  mass: { min: 0.1, max: 10, step: 0.1, shiftStep: 1, field: 'Spring mass' },
} as const;

function bezierAxis(t: number, p1: number, p2: number): number {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  const a = 1 - c - b;
  return ((a * t + b) * t + c) * t;
}

function bezierSlope(t: number, p1: number, p2: number): number {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  const a = 1 - c - b;
  return (3 * a * t + 2 * b) * t + c;
}

export function cubicBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 12; i += 1) {
    const currentX = bezierAxis(t, x1, x2) - x;
    if (Math.abs(currentX) < 1e-9) break;
    const slope = bezierSlope(t, x1, x2);
    if (Math.abs(slope) < 1e-9) break;
    t -= currentX / slope;
  }
  if (t < 0 || t > 1 || Number.isNaN(t)) {
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < 60; i += 1) {
      const currentX = bezierAxis(t, x1, x2);
      if (currentX < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
  }
  return bezierAxis(t, y1, y2);
}

export function elastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((10 * t - 0.75) * (2 * Math.PI)) / 3) + 1;
}

export function bouncy(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const n = 7.5625;
  const d = 2.75;
  let x = t;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) {
    x -= 1.5 / d;
    return n * x * x + 0.75;
  }
  if (x < 2.5 / d) {
    x -= 2.25 / d;
    return n * x * x + 0.9375;
  }
  x -= 2.625 / d;
  return n * x * x + 0.984375;
}

/** Semi-implicit Euler spring position after the given number of 1/60 s steps. */
export function springAt(spring: SpringEasing, steps: number): number {
  let x = 0;
  let v = 0;
  const count = Math.max(0, Math.floor(steps));
  for (let i = 0; i < count; i += 1) {
    const a = (-spring.stiffness * (x - 1) - spring.damping * v) / spring.mass;
    v += a / 60;
    x += v / 60;
  }
  return x;
}

export function isSpring(easing: Easing): easing is SpringEasing {
  return typeof easing === 'object' && easing !== null && easing.type === 'spring';
}

/** Eases a normalised 0..1 progress. Spring easings are handled by frame count elsewhere. */
export function ease(name: EasingName, t: number): number {
  if (name === 'elastic') return elastic(t);
  if (name === 'bouncy') return bouncy(t);
  if (name === 'linear') return Math.max(0, Math.min(1, t));
  const bezier = BEZIERS[name];
  return cubicBezier(t, bezier[0], bezier[1], bezier[2], bezier[3]);
}

export function easingDisplayName(easing: Easing): string {
  return isSpring(easing) ? 'Spring' : EASING_DISPLAY[easing];
}

export function isEasingName(value: unknown): value is EasingName {
  return typeof value === 'string' && (EASING_NAMES as string[]).includes(value);
}

export function parseEasing(value: unknown): Easing | null {
  if (isEasingName(value)) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === 'spring'
  ) {
    const raw = value as { stiffness?: unknown; damping?: unknown; mass?: unknown };
    const stiffness = typeof raw.stiffness === 'number' ? raw.stiffness : SPRING_DEFAULTS.stiffness;
    const damping = typeof raw.damping === 'number' ? raw.damping : SPRING_DEFAULTS.damping;
    const mass = typeof raw.mass === 'number' ? raw.mass : SPRING_DEFAULTS.mass;
    if (
      stiffness < SPRING_RANGES.stiffness.min ||
      stiffness > SPRING_RANGES.stiffness.max ||
      damping < SPRING_RANGES.damping.min ||
      damping > SPRING_RANGES.damping.max ||
      mass < SPRING_RANGES.mass.min ||
      mass > SPRING_RANGES.mass.max
    ) {
      return null;
    }
    return { type: 'spring', stiffness, damping, mass };
  }
  return null;
}
