/** The one easing of the product and every published step; CSS reads it as the custom property --ease. */
const EASING_POINTS = [0.22, 1, 0.36, 1] as const;
export const EASING = `cubic-bezier(${EASING_POINTS.join(", ")})`;

export type StepName =
  | "lamp"
  | "label-mask"
  | "paint"
  | "needle-sweep"
  | "part-lift"
  | "needle-settle"
  | "camera-to-part"
  | "dissolve";

/** Published durations in milliseconds. */
export const STEP_MS: Record<StepName, number> = {
  lamp: 180,
  "label-mask": 320,
  paint: 320,
  "needle-sweep": 420,
  "part-lift": 480,
  "needle-settle": 560,
  "camera-to-part": 640,
  dissolve: 120,
};

/** Page feedback: hover and press shift colour over the first, dialogs and sheets enter and leave over the second. */
export const HOVER_MS = 180;
export const DIALOG_MS = 320;

/** Solves the published curve for a progress x in 0..1 (Newton steps with a bisection fallback). */
export function ease(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = EASING_POINTS;
  const bezier = (t: number, a: number, b: number): number =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0;
  let high = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    const at = bezier(t, x1, x2);
    if (Math.abs(at - x) < 1e-6) break;
    if (at < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return bezier(t, y1, y2);
}
