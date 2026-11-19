import { ensureOrder } from './dom.js';
import { RANK_MILLIS, reducedMotion } from './motion.js';

/**
 * Moves list items to a new order while keeping every node: each item travels from where
 * it was to where it now is, and the list reports `moving` until all have arrived.
 */
export function reorderInPlace(
  list: HTMLElement,
  orderedItems: HTMLElement[],
  onSettled?: () => void,
): void {
  const before = new Map<HTMLElement, number>();
  for (const item of orderedItems) before.set(item, item.offsetTop);

  ensureOrder(list, orderedItems);

  if (reducedMotion()) {
    list.dataset['phase'] = 'settled';
    onSettled?.();
    return;
  }

  let moved = false;
  for (const item of orderedItems) {
    const start = before.get(item);
    if (start === undefined) continue;
    const shift = start - item.offsetTop;
    if (shift === 0) continue;
    moved = true;
    item.style.transition = 'none';
    item.style.transform = `translateY(${shift}px)`;
  }

  if (!moved) {
    list.dataset['phase'] = 'settled';
    onSettled?.();
    return;
  }

  list.dataset['phase'] = 'moving';
  requestAnimationFrame(() => {
    for (const item of orderedItems) {
      item.style.transition = `transform ${RANK_MILLIS}ms cubic-bezier(0.2,0.8,0.2,1)`;
      item.style.transform = 'translateY(0)';
    }
    window.setTimeout(() => {
      for (const item of orderedItems) {
        item.style.transition = '';
        item.style.transform = '';
      }
      list.dataset['phase'] = 'settled';
      onSettled?.();
    }, RANK_MILLIS);
  });
}
