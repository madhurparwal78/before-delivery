import { useCallback, useRef, useState } from 'react';
import { Ftpl } from '../../shared/feedback.ts';

/**
 * Moving something to a destination, shared by photo slots, tray cells, album
 * holes, baskets and replacement slots.
 *
 * - Touch or pointer dragging moves the real source under the finger, and
 *   dropping on a destination stages the move. Releasing anywhere else, or
 *   cancelling, leaves the prior draft exactly as it was.
 * - Tapping a source and then a destination stages the same move.
 * - Keyboard: Space picks the source up, Enter on a destination stages it,
 *   Escape cancels the pickup.
 *
 * A staged move is only ever a draft; it takes effect through a review dialog.
 */

export interface MoveApi {
  /** The source currently picked up, if any. */
  held: string | null;
  /** Props for a draggable source button. */
  source: (key: string) => {
    'aria-pressed': boolean;
    draggable: boolean;
    onClick: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  /** Props for a destination button or region. */
  destination: (key: string) => {
    onClick: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onDragOver: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
  };
  cancel: () => void;
}

export function useMove(onStage: (source: string, destination: string) => void): MoveApi {
  const [held, setHeld] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);

  const stage = useCallback(
    (source: string, destination: string) => {
      onStage(source, destination);
      setHeld(null);
      dragging.current = null;
    },
    [onStage],
  );

  const source = useCallback(
    (key: string) => ({
      'aria-pressed': held === key,
      draggable: true,
      onClick: () => setHeld((was) => (was === key ? null : key)),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          setHeld((was) => (was === key ? null : key));
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setHeld(null);
        }
      },
      onDragStart: (event: React.DragEvent) => {
        dragging.current = key;
        setHeld(key);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', key);
      },
      // Releasing anywhere that is not a destination leaves the draft alone.
      onDragEnd: () => {
        dragging.current = null;
        setHeld(null);
      },
    }),
    [held],
  );

  const destination = useCallback(
    (key: string) => ({
      onClick: () => {
        if (held) stage(held, key);
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Enter' && held) {
          event.preventDefault();
          stage(held, key);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setHeld(null);
        }
      },
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const moved = event.dataTransfer.getData('text/plain') || dragging.current;
        if (moved) stage(moved, key);
      },
    }),
    [held, stage],
  );

  return { held, source, destination, cancel: () => setHeld(null) };
}

/**
 * Reordering a list (D02 and H02). Space picks the focused item up, the arrows
 * move it one place with focus following, Enter drops it and Escape returns it
 * to where it was. Touch dragging an item up or down reorders it too. Each
 * changed place is announced.
 */
export interface ReorderApi {
  held: string | null;
  item: (key: string) => {
    'aria-pressed': boolean;
    draggable: boolean;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onDragStart: (event: React.DragEvent) => void;
    onDragOver: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}

export function useReorder(
  order: string[],
  setOrder: (next: string[]) => void,
  options: { announce: (copy: string) => void; labelOf: (key: string) => string },
): ReorderApi {
  const [held, setHeld] = useState<string | null>(null);
  const before = useRef<string[] | null>(null);
  const dragging = useRef<string | null>(null);

  const moveTo = useCallback(
    (key: string, to: number) => {
      const from = order.indexOf(key);
      if (from < 0 || to < 0 || to >= order.length || to === from) return;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, key);
      setOrder(next);
      options.announce(Ftpl.reorder(options.labelOf(key), to + 1, next.length));
    },
    [order, setOrder, options],
  );

  const item = useCallback(
    (key: string) => ({
      'aria-pressed': held === key,
      draggable: true,
      onKeyDown: (event: React.KeyboardEvent) => {
        const at = order.indexOf(key);
        if (event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          if (held === key) {
            setHeld(null);
            before.current = null;
          } else {
            setHeld(key);
            before.current = [...order];
          }
          return;
        }
        if (held !== key) return;
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveTo(key, at - 1);
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveTo(key, at + 1);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          setHeld(null);
          before.current = null;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (before.current) setOrder(before.current);
          setHeld(null);
          before.current = null;
        }
      },
      onDragStart: (event: React.DragEvent) => {
        dragging.current = key;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', key);
      },
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const moved = event.dataTransfer.getData('text/plain') || dragging.current;
        if (moved && moved !== key) moveTo(moved, order.indexOf(key));
      },
      onDragEnd: () => {
        dragging.current = null;
      },
    }),
    [held, moveTo, order, setOrder],
  );

  return { held, item };
}

/** Focus follows a moved item, so the keyboard path never loses its place. */
export function focusItem(container: HTMLElement | null, key: string): void {
  const target = container?.querySelector<HTMLElement>(`[data-item="${CSS.escape(key)}"]`);
  target?.focus();
}
