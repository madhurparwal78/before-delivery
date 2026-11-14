import { isLocked } from '../locking.ts';

/**
 * Dragging an item with a mouse or finger moves it among its siblings and reports the drop.
 * Moving an element in the document ends its pointer capture, so the drag listens on the document.
 */
export function enableDrag(item: HTMLElement, list: HTMLElement, onDrop: (from: number, to: number) => void): void {
  const siblings = (): HTMLElement[] => [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement);

  function follow(event: PointerEvent): void {
    const next = siblings().find((sibling) => {
      if (sibling === item) return false;
      const box = sibling.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    if (next !== item.nextElementSibling) list.insertBefore(item, next ?? null);
  }

  item.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isLocked(item) || (event.target instanceof Element && event.target.closest('button'))) return;
    const from = siblings().indexOf(item);
    item.setAttribute('data-dragging', 'true');
    const finish = (): void => {
      document.removeEventListener('pointermove', follow);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      item.removeAttribute('data-dragging');
      item.focus();
      const to = siblings().indexOf(item);
      if (to !== from) onDrop(from, to);
    };
    document.addEventListener('pointermove', follow);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  });
}
