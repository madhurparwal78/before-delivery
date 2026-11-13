import { MOTION, reducedMotion, tween } from './motion.js';
import type { AdvanceMotion } from './liveStore.js';

const cardOf = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-match-id="${id}"]`);

// A copy of the winner's name travels from its card to its slot in the next card in 320 ms.
export function runAdvance(motion: AdvanceMotion): void {
  if (reducedMotion()) return;
  const from = cardOf(motion.fromMatchId);
  const to = cardOf(motion.toMatchId);
  if (!from || !to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const mover = document.createElement('span');
  mover.className = 'advance-name';
  mover.dataset['motion'] = 'advance';
  mover.textContent = motion.name;
  document.body.append(mover);
  const w = mover.offsetWidth;
  const h = mover.offsetHeight;
  const startX = a.left + a.width / 2 - w / 2;
  const startY = a.top + a.height / 2 - h / 2;
  const endX = b.left + b.width / 2 - w / 2;
  const endY = b.top + b.height / 2 - h / 2;
  const place = (p: number): void => {
    mover.style.transform = `translate(${startX + (endX - startX) * p}px, ${startY + (endY - startY) * p}px)`;
  };
  place(0);
  tween(MOTION.advance, place, () => mover.remove());
}

// Leaving the page drops any name still travelling.
export function advanceCleanup(): void {
  document.querySelectorAll('[data-motion="advance"]').forEach((el) => el.remove());
}
