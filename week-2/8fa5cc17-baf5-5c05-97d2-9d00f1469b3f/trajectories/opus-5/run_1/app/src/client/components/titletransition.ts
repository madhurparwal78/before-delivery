import { prefersReducedMotion } from '../dom';
import { animate, fadeIn } from '../anim';
import { REDUCED_FADE_MS, TITLE_TRANSITION_MS } from '../../shared/motion';

let pending: DOMRect | null = null;

/** Opening an object from a card moves its title into the page heading. */
export function startTitleTransition(titleNode: HTMLElement): void {
  pending = titleNode.getBoundingClientRect();
}

export function playTitleTransition(heading: HTMLElement): void {
  const from = pending;
  pending = null;
  if (from === null) return;
  if (prefersReducedMotion()) {
    fadeIn(heading, REDUCED_FADE_MS);
    return;
  }
  const to = heading.getBoundingClientRect();
  if (to.width === 0) return;
  const scale = from.width / to.width;
  animate(
    heading,
    [
      {
        transformOrigin: 'top left',
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`,
      },
      { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1)' },
    ],
    TITLE_TRANSITION_MS,
  );
}
