import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { SHELVES } from './model.ts';
import type { Shelf } from './model.ts';

/** What is being dragged: a field chip from the field list, or a pill from a shelf. */
export type DragItem = { kind: 'field'; name: string } | { kind: 'pill'; shelf: Shelf; index: number };

/** Where it was released: a shelf and the place among its pills. */
export interface Drop {
  shelf: Shelf;
  index: number;
}

const THRESHOLD = 4;

function isShelf(value: string | undefined): value is Shelf {
  return SHELVES.some((shelf) => shelf === value);
}

function shelfAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y);
  return hit instanceof Element ? hit.closest<HTMLElement>('[data-shelf]') : null;
}

/** The place among a shelf's pills before which the pointer sits, reading the pills left to right, row by row. */
function placeAt(list: HTMLElement, x: number, y: number): number {
  const pills = [...list.querySelectorAll<HTMLElement>(':scope > [data-pill-item]')];
  const before = pills.findIndex((pill) => {
    const box = pill.getBoundingClientRect();
    return y < box.top || (y <= box.bottom && x < box.left + box.width / 2);
  });
  return before < 0 ? pills.length : before;
}

/**
 * Pointer-event dragging (never HTML drag and drop). A press becomes a drag once the pointer has moved 4 pixels; the
 * shelf list under the pointer carries `data-drop="true"`; releasing over a shelf calls `onDrop`, anywhere else cancels.
 * A press that moves less is left to the element's own click.
 */
export function useShelfDrag(onDrop: (item: DragItem, drop: Drop) => void) {
  const dropped = useRef(onDrop);
  dropped.current = onDrop;

  return useCallback((event: ReactPointerEvent<HTMLElement>, item: DragItem, label: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const origin = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let ghost: HTMLDivElement | null = null;
    let over: HTMLElement | null = null;

    const mark = (next: HTMLElement | null) => {
      if (next === over) return;
      over?.removeAttribute('data-drop');
      next?.setAttribute('data-drop', 'true');
      over = next;
    };

    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== event.pointerId) return;
      if (!ghost) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < THRESHOLD) return;
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = label;
        ghost.setAttribute('aria-hidden', 'true');
        document.body.append(ghost);
        document.body.dataset.dragging = 'true';
      }
      moved.preventDefault();
      ghost.style.transform = `translate(${moved.clientX + 12}px, ${moved.clientY + 12}px)`;
      mark(shelfAt(moved.clientX, moved.clientY));
    };

    const swallowClick = (click: MouseEvent) => {
      click.stopPropagation();
      click.preventDefault();
    };

    const end = (ended: PointerEvent) => {
      if (ended.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!ghost) return;
      ghost.remove();
      delete document.body.dataset.dragging;
      const target = ended.type === 'pointerup' ? over : null;
      mark(null);
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      window.addEventListener('pointerdown', () => window.removeEventListener('click', swallowClick, { capture: true }), {
        capture: true,
        once: true,
      });
      const shelf = target?.dataset.shelf;
      if (target && isShelf(shelf)) dropped.current(item, { shelf, index: placeAt(target, ended.clientX, ended.clientY) });
      else origin.focus();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, []);
}
