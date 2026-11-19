import { useCallback, useRef, type KeyboardEvent } from 'react';

interface RovingOptions {
  orientation: 'horizontal' | 'vertical';
  /** Wrap from the last item to the first and back. */
  wrap?: boolean;
  /** Home and End jump to the first and last item. */
  homeEnd?: boolean;
}

/** Moves focus among the items for an arrow, Home or End key. Returns true when it handled the key. */
export function moveRovingFocus(event: KeyboardEvent, items: HTMLElement[], options: RovingOptions): boolean {
  if (items.length === 0) return false;
  const forward = options.orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const backward = options.orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  const current = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (event.key === forward) next = current + 1;
  else if (event.key === backward) next = current - 1;
  else if (options.homeEnd && event.key === 'Home') next = 0;
  else if (options.homeEnd && event.key === 'End') next = items.length - 1;
  else return false;
  if (options.wrap) next = (next + items.length) % items.length;
  else next = Math.min(items.length - 1, Math.max(0, next));
  event.preventDefault();
  items[next]?.focus();
  return true;
}

/**
 * Roving focus for a container: spread `onKeyDown` on it and attach `ref`. The items are the elements
 * matching `selector` inside it that are not disabled.
 */
export function useRovingFocus<Container extends HTMLElement>(selector: string, options: RovingOptions) {
  const ref = useRef<Container>(null);
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(selector) ?? [])].filter((item) => !item.hasAttribute('disabled'));
      moveRovingFocus(event, items, options);
    },
    [selector, options.orientation, options.wrap, options.homeEnd],
  );
  return { ref, onKeyDown };
}
