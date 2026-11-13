const CONTROL = [0.22, 1, 0.36, 1] as const;

/** The one easing used by every page and scene animation. */
export const EASING = `cubic-bezier(${CONTROL.join(', ')})`;

function bezier(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

/** Progress of the published curve at elapsed fraction `x` of a step. */
export function ease(x: number): number {
  const clamped = x <= 0 ? 0 : x >= 1 ? 1 : x;
  let low = 0;
  let high = 1;
  let t = clamped;
  for (let i = 0; i < 24; i += 1) {
    const value = bezier(t, CONTROL[0], CONTROL[2]);
    if (value < clamped) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return bezier(t, CONTROL[1], CONTROL[3]);
}
