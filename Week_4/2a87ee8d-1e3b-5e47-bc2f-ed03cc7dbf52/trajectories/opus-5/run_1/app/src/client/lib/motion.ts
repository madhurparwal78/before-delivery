/**
 * Every motion in the product is one of these. Each only moves, scales, rotates or fades
 * elements, never changes layout, and is created through the Web Animations API so it
 * appears in the page's list of running animations and can be paused or stepped.
 *
 * The one exception is a note following the pointer during a drag; a spring settle is
 * computed in advance and played as one animation.
 */

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const EASE_OUT = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const EASE_SETTLE = 'cubic-bezier(0.16, 0.84, 0.44, 1)';

function play(
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation {
  return element.animate(keyframes, { fill: 'none', ...options });
}

/** Hero mesh drift: one full cycle every 24 seconds, within 6 percent of the hero's size. */
export function heroMeshDrift(element: Element): Animation | null {
  if (prefersReducedMotion()) return null;
  const animation = play(
    element,
    [
      { transform: 'translate3d(-3%, -2%, 0) scale(1.06)' },
      { transform: 'translate3d(3%, 2%, 0) scale(1.06)' },
      { transform: 'translate3d(-3%, -2%, 0) scale(1.06)' },
    ],
    { duration: 24_000, iterations: Infinity, easing: 'ease-in-out', fill: 'both' },
  );
  return animation;
}

/** Card entrance: notes rise slightly and fade in one after another in Tab order. */
export function cardEntrance(elements: readonly Element[]): Animation[] {
  if (elements.length === 0) return [];
  if (prefersReducedMotion()) return [];
  const step = 18;
  const span = 560;
  const gap = elements.length > 1 ? Math.min(step, span / (elements.length - 1)) : 0;
  // All entrance animations are created together, each with a start delay equal to its
  // offset, so the stagger does not depend on frame timing.
  return elements.map((element, index) =>
    play(
      element,
      [
        { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 240, delay: index * gap, easing: EASE_OUT, fill: 'backwards' },
    ),
  );
}

/** A new note or card back fades in from slightly smaller. */
export function noteLands(element: Element): Animation | null {
  if (prefersReducedMotion()) return null;
  return play(
    element,
    [
      { opacity: 0, transform: 'scale(0.94)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    { duration: 190, easing: EASE_OUT },
  );
}

/** Lift: a picked-up note grows slightly and its shadow deepens. */
export function liftNote(element: HTMLElement): Animation | null {
  element.classList.add('note-lifted');
  if (prefersReducedMotion()) return null;
  return play(element, [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }], {
    duration: 140,
    easing: EASE_OUT,
    fill: 'forwards',
  });
}

export function dropNote(element: HTMLElement): void {
  element.classList.remove('note-lifted');
}

const SPRING_STIFFNESS = 400;
const SPRING_DAMPING = 32;
const SPRING_REST = 0.5;

/**
 * Spring drop: the note springs into its resting place from its release speed, overshooting
 * a little and settling. Stiffness 400, damping 32, unit mass; it ends when the note is
 * within half a pixel of rest, and within 0.6 seconds.
 */
export function springSettle(
  element: Element,
  from: { x: number; y: number },
  velocity: { x: number; y: number },
): Animation | null {
  if (prefersReducedMotion()) return null;
  const frames = springFrames(from, velocity);
  if (frames.length < 2) return null;
  return play(
    element,
    frames.map((frame) => ({ transform: `translate3d(${frame.x}px, ${frame.y}px, 0)` })),
    { duration: frames.length * (1000 / 60), easing: 'linear' },
  );
}

/** Integrates the spring in advance, so the settle plays as one browser-managed animation. */
function springFrames(
  from: { x: number; y: number },
  velocity: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const stepSeconds = 1 / 60;
  const maxFrames = Math.round(0.6 / stepSeconds);
  let x = from.x;
  let y = from.y;
  let vx = velocity.x;
  let vy = velocity.y;
  const frames: Array<{ x: number; y: number }> = [{ x, y }];
  for (let frame = 0; frame < maxFrames; frame += 1) {
    vx += (-SPRING_STIFFNESS * x - SPRING_DAMPING * vx) * stepSeconds;
    vy += (-SPRING_STIFFNESS * y - SPRING_DAMPING * vy) * stepSeconds;
    x += vx * stepSeconds;
    y += vy * stepSeconds;
    frames.push({ x, y });
    if (Math.hypot(x, y) < SPRING_REST && Math.hypot(vx, vy) < SPRING_REST * 10) break;
  }
  frames.push({ x: 0, y: 0 });
  return frames;
}

/**
 * Snap-back: a failed move glides back to its saved spot over about 0.3 seconds and the
 * accent outline flashes once and fades over a second.
 */
export function snapBack(element: HTMLElement, from: { x: number; y: number }): Animation[] {
  const animations: Animation[] = [];
  if (prefersReducedMotion()) {
    element.classList.add('note-snapped');
    window.setTimeout(() => element.classList.remove('note-snapped'), 1000);
    return animations;
  }
  animations.push(
    play(
      element,
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 300, easing: EASE_OUT },
    ),
  );
  animations.push(
    play(
      element,
      [
        { outlineColor: 'rgba(180, 68, 28, 1)' },
        { outlineColor: 'rgba(180, 68, 28, 0)' },
      ],
      { duration: 1000, easing: 'ease-out' },
    ),
  );
  return animations;
}

/** Cursor glide: a collaborator's cursor and halo glide to each new position. */
export function cursorGlide(
  element: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Animation | null {
  if (prefersReducedMotion()) return null;
  return play(
    element,
    [
      { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
      { transform: `translate3d(${to.x}px, ${to.y}px, 0)` },
    ],
    { duration: 100, easing: 'linear', fill: 'forwards' },
  );
}

/** Sheets and drawers slide in from their edge quickly and leave faster. */
export function sheetIn(element: Element, edge: 'left' | 'right' | 'bottom'): Animation | null {
  if (prefersReducedMotion()) return null;
  const offsets: Record<typeof edge, string> = {
    left: 'translate3d(-100%, 0, 0)',
    right: 'translate3d(100%, 0, 0)',
    bottom: 'translate3d(0, 100%, 0)',
  };
  return play(element, [{ transform: offsets[edge] }, { transform: 'translate3d(0,0,0)' }], {
    duration: 250,
    easing: EASE_SETTLE,
  });
}

/** Dialogs fade in with a slight rise. */
export function dialogIn(element: Element): Animation | null {
  if (prefersReducedMotion()) return null;
  return play(
    element,
    [
      { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 190, easing: EASE_OUT },
  );
}

/** A usage meter's bar grows or shrinks from its previous fill to the new one. */
export function meterFill(element: Element, fromRatio: number, toRatio: number): Animation | null {
  if (prefersReducedMotion()) return null;
  return play(
    element,
    [{ transform: `scaleX(${fromRatio})` }, { transform: `scaleX(${toRatio})` }],
    { duration: 600, easing: EASE_SETTLE, fill: 'forwards' },
  );
}

/**
 * Number tickers: each digit column rolls to its new value while the accessible text already
 * holds the final value.
 */
export function rollDigits(element: HTMLElement, previous: string, next: string): Animation[] {
  if (prefersReducedMotion() || previous === next) return [];
  const columns = element.querySelectorAll('[data-digit]');
  const animations: Animation[] = [];
  columns.forEach((column, index) => {
    const before = previous[index];
    const after = next[index];
    if (before === after) return;
    animations.push(
      play(
        column,
        [
          { transform: 'translate3d(0, -0.5em, 0)', opacity: 0 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ],
        { duration: 400, easing: EASE_SETTLE },
      ),
    );
  });
  return animations;
}

/** The pricing toggle's thumb slides to the chosen term. */
export function toggleThumb(element: Element, fromOffset: number, toOffset: number): Animation | null {
  if (prefersReducedMotion()) return null;
  return play(
    element,
    [
      { transform: `translate3d(${fromOffset}px, 0, 0)` },
      { transform: `translate3d(${toOffset}px, 0, 0)` },
    ],
    { duration: 250, easing: EASE_OUT, fill: 'forwards' },
  );
}

const REVEAL_FLIP_MS = 420;
const REVEAL_RANK_GAP_MS = 24;
const REVEAL_MAX_SPAN_MS = 480;
const REVEAL_CROSSFADE_MS = 150;

export interface RevealCard {
  readonly element: HTMLElement;
  /** Distance from the frame's centre to the card's centre. */
  readonly distance: number;
}

/**
 * Face-down reveal. Each frame runs its own wave; cards are ranked by distance from the
 * frame's centre, rank 0 starts first and each later rank starts 24ms after the one before.
 * A frame with more than 21 ranks shortens the gap evenly so the last rank starts no later
 * than 0.48 seconds after the first. Each wave finishes within 0.9 seconds.
 */
export function revealWave(cards: readonly RevealCard[], onHalfway: (element: HTMLElement) => void): Animation[] {
  if (cards.length === 0) return [];

  // Cards at equal distance share a rank.
  const distances = [...new Set(cards.map((card) => round(card.distance)))].sort((a, b) => a - b);
  const rankOf = new Map(distances.map((distance, index) => [distance, index]));
  const rankCount = distances.length;
  const gap = rankCount > 1 ? Math.min(REVEAL_RANK_GAP_MS, REVEAL_MAX_SPAN_MS / (rankCount - 1)) : 0;

  if (prefersReducedMotion()) {
    // Every card switches to its front at once with a short crossfade.
    return cards.map((card) => {
      onHalfway(card.element);
      return card.element.animate([{ opacity: 0.25 }, { opacity: 1 }], {
        duration: REVEAL_CROSSFADE_MS,
        easing: 'linear',
      });
    });
  }

  const animations: Animation[] = [];
  for (const card of cards) {
    const rank = rankOf.get(round(card.distance)) ?? 0;
    const delay = rank * gap;
    // The card turns on its vertical axis, quickly at first and settling softly.
    const flip = card.element.animate(
      [
        { transform: 'perspective(800px) rotateY(0deg)' },
        { transform: 'perspective(800px) rotateY(90deg)', offset: 0.5 },
        { transform: 'perspective(800px) rotateY(180deg)' },
      ],
      { duration: REVEAL_FLIP_MS, delay, easing: EASE_SETTLE, fill: 'backwards' },
    );
    // At the half-way point the outline-only back is swapped for the yellow front.
    window.setTimeout(() => onHalfway(card.element), delay + REVEAL_FLIP_MS / 2);
    animations.push(flip);
  }
  return animations;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
