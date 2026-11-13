import { prefersReducedMotion } from './dom.js';

/**
 * All motion starts fast and decelerates into place, with no overshoot. With reduced motion
 * every slide is removed and things appear, leave and change place at once.
 */

const EASE = 'cubic-bezier(0.16, 0.84, 0.3, 1)';

export const TIMING = {
  shutterClose: 180,
  shutterOpen: 180,
  scroll: 300,
  screenSlide: 240,
  dialogOpen: 200,
  dialogClose: 120,
  rowSlide: 200,
  knobSettle: 180,
} as const;

function animate(
  node: Element,
  keyframes: Keyframe[],
  duration: number,
): Animation | null {
  if (prefersReducedMotion()) return null;
  return node.animate(keyframes, { duration, easing: EASE, fill: 'both' });
}

/** The new stop's photo slides horizontally into its resting place. */
export function tileSlide(photo: Element, direction: 1 | -1): Animation | null {
  const offset = 32 * direction;
  return animate(
    photo,
    [
      { transform: `translateX(${offset}px)` },
      { transform: 'translateX(0px)' },
    ],
    TIMING.shutterOpen,
  );
}

/** A screen reached through the Deck navigation slides in from the side of travel. */
export function screenSlide(main: Element, direction: 1 | -1): void {
  animate(
    main,
    [
      { transform: `translateX(${48 * direction}px)`, opacity: 0 },
      { transform: 'translateX(0px)', opacity: 1 },
    ],
    TIMING.screenSlide,
  );
}

export function dialogOpenSlide(dialog: Element): void {
  animate(
    dialog,
    [
      { transform: 'translateY(40px)', opacity: 0 },
      { transform: 'translateY(0px)', opacity: 1 },
    ],
    TIMING.dialogOpen,
  );
}

export function dialogCloseSlide(dialog: Element, done: () => void): void {
  const animation = animate(
    dialog,
    [
      { transform: 'translateY(0px)', opacity: 1 },
      { transform: 'translateY(40px)', opacity: 0 },
    ],
    TIMING.dialogClose,
  );
  if (!animation) {
    done();
    return;
  }
  animation.addEventListener('finish', done, { once: true });
}

/** Rows that change place slide to their new positions instead of jumping. */
export function slideRowsFrom(
  rows: Map<Element, DOMRect>,
): void {
  if (prefersReducedMotion()) return;
  for (const [row, before] of rows) {
    const after = row.getBoundingClientRect();
    const shift = before.top - after.top;
    if (Math.abs(shift) < 1) continue;
    row.animate(
      [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0px)' }],
      { duration: TIMING.rowSlide, easing: EASE },
    );
  }
}

/** A row leaving a list slides out to the left before the rows below close the gap. */
export function slideRowOut(row: HTMLElement, done: () => void): void {
  if (prefersReducedMotion()) {
    done();
    return;
  }
  const width = row.getBoundingClientRect().width;
  const animation = row.animate(
    [
      { transform: 'translateX(0px)', opacity: 1 },
      { transform: `translateX(${-width}px)`, opacity: 0 },
    ],
    { duration: TIMING.rowSlide, easing: EASE, fill: 'forwards' },
  );
  animation.addEventListener('finish', done, { once: true });
}

export function measureRows(rows: Iterable<Element>): Map<Element, DOMRect> {
  const measured = new Map<Element, DOMRect>();
  for (const row of rows) measured.set(row, row.getBoundingClientRect());
  return measured;
}
