// Motion timings, the Quire curve, the drawer and sheet spring and the timeline coast.

export const QUIRE_CURVE_CSS = 'cubic-bezier(0.2, 0, 0, 1)';
const CURVE_X1 = 0.2;
const CURVE_Y1 = 0;
const CURVE_X2 = 0;
const CURVE_Y2 = 1;

function bezier(s: number, p1: number, p2: number): number {
  const r = 1 - s;
  return 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s;
}

/** The Quire curve as a function of linear progress; x(s) is strictly increasing, so bisection is exact to 1e-12. */
export function quireEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, CURVE_X1, CURVE_X2) < t) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, CURVE_Y1, CURVE_Y2);
}

// Margin Tether.
export const MORPH_MS = 280;
export const TETHER_MS = 180;
export const NUMERAL_MS = 160;
export const NUMERAL_FLASH_MS = 1000;
export const REFUSAL_SHRINK_MS = 167;

/** A tether pulled back from dash offset `o` returns to 1 over 180 × (1 − o) ms. */
export function tetherReverseMs(offset: number): number {
  return TETHER_MS * (1 - offset);
}

// Pages, cards and lists.
export const REVEAL_MS = 320;
export const FADE_MS = 120;
export const PRESS_MS = 100;
export const CARD_TURN_MS = 420;
export const CARD_PERSPECTIVE_PX = 900;
export const CARD_ROW_MS = 160;
export const CARD_ROW_FIRST_DELAY_MS = 210;
export const CARD_ROW_STEP_MS = 60;
export const CARD_ROW_RISE_PX = 8;
export const TITLE_MS = 280;
export const ROW_SLIDE_MS = 240;
export const ROW_FADE_MS = 160;
export const GAP_MS = 180;
export const ARRIVAL_MARK_MS = 2000;
/** Saved-query text is checked this long after the last keystroke (at most a fifth of a second). */
/** Searches and query checks start this long after the last keystroke (the brief allows a fifth of a second). */
export const SEARCH_DELAY_MS = 150;

/** Delay of back row `k` after the card turn starts. */
export function cardRowDelay(k: number): number {
  return CARD_ROW_FIRST_DELAY_MS + CARD_ROW_STEP_MS * k;
}

// Board.
export const BOARD_SLIDE_MS = 240;
export const BOARD_REFUSAL_SLIDE_MS = 160;

// Graph.
export const FLY_MS = 600;
export const NODE_GROW_MS = 280;
export const EDGE_DRAW_MS = 400;
export const SCOPE_DIM_MS = 180;

// Drawers and sheets: critically damped spring (stiffness 400, mass 1; damping 40 = 2·√(k·m)).
export const SPRING_STIFFNESS = 400;
export const SPRING_MASS = 1;
export const SPRING_OMEGA = Math.sqrt(SPRING_STIFFNESS / SPRING_MASS);
export const SPRING_REST_PX = 0.5;
export const SPRING_REST_SPEED = 10;

export interface SpringState {
  offset: number;
  velocity: number;
}

/** Offset (px) and velocity (px/s) `t` seconds after a retarget from `x0`, `v0` towards `target`. */
export function springAt(x0: number, v0: number, target: number, t: number): SpringState {
  const w = SPRING_OMEGA;
  const k = v0 + w * (x0 - target);
  const e = Math.exp(-w * t);
  return { offset: target + (x0 - target + k * t) * e, velocity: (v0 - w * k * t) * e };
}

export function springSettled(offset: number, velocity: number, target: number): boolean {
  return Math.abs(offset - target) < SPRING_REST_PX && Math.abs(velocity) < SPRING_REST_SPEED;
}

// Timeline coast and snap.
export const TIMELINE_COLUMN_PX = 296;
export const TIMELINE_SNAP_MS = 200;
export const COAST_TAU_MS = 325;
export const COAST_STOP_SPEED = 0.02;
export const COAST_REFERENCE_MS = 100;

export interface DragSample {
  t: number;
  offset: number;
}

/** Release velocity in px/ms from the drag's pointer samples (oldest first). */
export function coastVelocity(samples: readonly DragSample[]): number {
  const last = samples[samples.length - 1];
  if (last === undefined) return 0;
  let ref = samples[0] ?? last;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i];
    if (s !== undefined && last.t - s.t >= COAST_REFERENCE_MS) {
      ref = s;
      break;
    }
  }
  const dt = last.t - ref.t;
  return dt === 0 ? 0 : (last.offset - ref.offset) / dt;
}

export function coastOffset(releaseOffset: number, v0: number, tMs: number): number {
  return releaseOffset + v0 * COAST_TAU_MS * (1 - Math.exp(-tMs / COAST_TAU_MS));
}

export function coastDone(v0: number, tMs: number): boolean {
  return Math.abs(v0 * Math.exp(-tMs / COAST_TAU_MS)) < COAST_STOP_SPEED;
}

/** The nearest column start. */
export function snapOffset(offset: number, column: number = TIMELINE_COLUMN_PX): number {
  return column * Math.round(offset / column);
}
