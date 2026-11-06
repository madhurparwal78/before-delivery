/** Every timing value and physical constant of a motion, stated once. */

export const QUIRE_CURVE = 'cubic-bezier(0.2, 0, 0, 1)';

export const MORPH_MS = 280;
export const TETHER_MS = 180;
export const NUMERAL_MS = 160;
export const MORPH_CANCEL_MS = 160;
export const ARRIVAL_MARK_MS = 2000;
export const BLOCK_GAP_MS = 180;
export const CARD_TURN_MS = 420;
export const CARD_ROW_MS = 160;
export const CARD_ROW_DELAY_MS = 210;
export const CARD_ROW_STAGGER_MS = 60;
export const CARD_PERSPECTIVE_PX = 900;
export const CARD_WIDE_THRESHOLD_PX = 320;
export const TITLE_TRANSITION_MS = 280;
export const RESULTS_SLIDE_MS = 240;
export const RESULTS_FADE_MS = 160;
export const DAILY_REVEAL_MS = 320;
export const REDUCED_FADE_MS = 120;
export const BOARD_LIVE_SLIDE_MS = 240;
export const BOARD_REFUSAL_SLIDE_MS = 160;
export const TIMELINE_DECAY_MS = 325;
export const TIMELINE_SNAP_MS = 200;
export const TIMELINE_COLUMN_WIDTH = 280;
export const TIMELINE_COLUMN_GAP = 16;
export const TIMELINE_COLUMN_PITCH = TIMELINE_COLUMN_WIDTH + TIMELINE_COLUMN_GAP;
export const TIMELINE_VELOCITY_WINDOW_MS = 100;
export const TIMELINE_COAST_CUTOFF = 0.02;
export const HEAT_FULL_BLOCKS = 6;
export const PRESENCE_REPORT_MS = 100;
export const SAVE_DEBOUNCE_MS = 500;
export const SEARCH_DEBOUNCE_MS = 200;
export const BOARD_NUDGE_SAVE_MS = 400;
export const UNDO_COALESCE_MS = 1000;
export const UNDO_STACK_LIMIT = 100;
export const DRAG_THRESHOLD_PX = 4;

export const SPRING_STIFFNESS = 400;
export const SPRING_DAMPING = 40;
export const SPRING_MASS = 1;
/** Critically damped, so the rate is both √(stiffness/mass) and damping/(2·mass). */
export const SPRING_RATE = SPRING_DAMPING / (2 * SPRING_MASS);
export const SPRING_SETTLE_OFFSET = 0.5;
export const SPRING_SETTLE_VELOCITY = 10;

/** The critically damped spring of the library drawer and the margin sheet. */
export function springAt(
  start: number,
  startVelocity: number,
  target: number,
  seconds: number,
): { offset: number; velocity: number } {
  const omega = SPRING_RATE;
  const delta = start - target;
  const decay = Math.exp(-omega * seconds);
  const offset = target + (delta + (startVelocity + omega * delta) * seconds) * decay;
  const velocity = (startVelocity - omega * (startVelocity + omega * delta) * seconds) * decay;
  return { offset, velocity };
}

export function springSettled(offset: number, velocity: number, target: number): boolean {
  return Math.abs(offset - target) < SPRING_SETTLE_OFFSET && Math.abs(velocity) < SPRING_SETTLE_VELOCITY;
}

/** The timeline coast: the offset `t` milliseconds after release. */
export function coastOffset(releaseOffset: number, velocity: number, elapsedMs: number): number {
  return releaseOffset + velocity * TIMELINE_DECAY_MS * (1 - Math.exp(-elapsedMs / TIMELINE_DECAY_MS));
}

export function coastVelocity(velocity: number, elapsedMs: number): number {
  return velocity * Math.exp(-elapsedMs / TIMELINE_DECAY_MS);
}

export function snapTarget(offset: number): number {
  return TIMELINE_COLUMN_PITCH * Math.round(offset / TIMELINE_COLUMN_PITCH);
}

/** The cubic Bézier of the Quire curve, evaluated for scripted motion. */
export function quireEase(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const x1 = 0.2;
  const y1 = 0;
  const x2 = 0;
  const y2 = 1;
  let low = 0;
  let high = 1;
  let guess = clamped;
  for (let i = 0; i < 24; i += 1) {
    const x =
      3 * (1 - guess) * (1 - guess) * guess * x1 + 3 * (1 - guess) * guess * guess * x2 + guess * guess * guess;
    if (Math.abs(x - clamped) < 1e-6) break;
    if (x < clamped) low = guess;
    else high = guess;
    guess = (low + high) / 2;
  }
  return 3 * (1 - guess) * (1 - guess) * guess * y1 + 3 * (1 - guess) * guess * guess * y2 + guess * guess * guess;
}
