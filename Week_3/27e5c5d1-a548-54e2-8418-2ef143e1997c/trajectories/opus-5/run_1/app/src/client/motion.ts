import type { MoverColour } from '../shared/types';
import { prefersReducedMotion } from './lib/dom';
import { requestRender, state } from './store';

const CHIP_VISIBLE_MS = 2000;
const CHIP_FADE_MS = 400;

interface ChipTimers {
  fade: number;
  remove: number;
}

const timers = new Map<string, ChipTimers>();

/** Each card's mover chip keeps its own time. */
export function showMover(cardId: string, mover: { displayName: string; initials: string; colour: MoverColour }): void {
  const existing = timers.get(cardId);
  if (existing !== undefined) {
    window.clearTimeout(existing.fade);
    window.clearTimeout(existing.remove);
  }
  state.movers.set(cardId, { ...mover, fading: false });
  const fade = window.setTimeout(() => {
    const chip = state.movers.get(cardId);
    if (chip === undefined) return;
    state.movers.set(cardId, { ...chip, fading: true });
    requestRender();
  }, CHIP_VISIBLE_MS);
  const remove = window.setTimeout(() => {
    state.movers.delete(cardId);
    timers.delete(cardId);
    requestRender();
  }, CHIP_VISIBLE_MS + CHIP_FADE_MS + 100);
  timers.set(cardId, { fade, remove });
  requestRender();
}

export function clearMovers(): void {
  for (const entry of timers.values()) {
    window.clearTimeout(entry.fade);
    window.clearTimeout(entry.remove);
  }
  timers.clear();
  state.movers.clear();
}

export type CardRects = Map<string, DOMRect>;

export function captureCardRects(root: ParentNode): CardRects {
  const rects: CardRects = new Map();
  for (const node of root.querySelectorAll<HTMLElement>('[data-card-id]')) {
    const id = node.dataset['cardId'];
    if (id !== undefined) rects.set(id, node.getBoundingClientRect());
  }
  return rects;
}

/** Moves each card from where it was on screen to where it is now, in one movement. */
export function playHandOffGlide(root: ParentNode, before: CardRects): void {
  if (prefersReducedMotion()) return;
  for (const node of root.querySelectorAll<HTMLElement>('[data-card-id]')) {
    const id = node.dataset['cardId'];
    if (id === undefined) continue;
    const previous = before.get(id);
    if (previous === undefined) continue;
    const current = node.getBoundingClientRect();
    const deltaX = previous.left - current.left;
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
    node.style.transition = 'none';
    node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    requestAnimationFrame(() => {
      node.style.transition = 'transform 320ms cubic-bezier(0.2, 0, 0.1, 1)';
      node.style.transform = 'translate(0px, 0px)';
      window.setTimeout(() => {
        node.style.transition = '';
        node.style.transform = '';
      }, 340);
    });
  }
}
