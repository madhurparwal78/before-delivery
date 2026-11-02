import { useEffect, useSyncExternalStore } from 'react';
import { type AppState, store } from './store.ts';

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

function resolveFocusTarget(key: string): HTMLElement | null {
  if (key === 'tag-radio-checked') {
    return document.querySelector<HTMLElement>('[data-focus-key^="radio:tag:"][aria-checked="true"]');
  }
  return document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
}

/** Moves focus to the control the store asked for, once it has painted. */
export function usePendingFocus(pendingFocus: string | null): void {
  useEffect(() => {
    if (pendingFocus === null) return;
    const target = resolveFocusTarget(pendingFocus);
    if (target !== null) {
      target.focus();
      store.clearPendingFocus();
      return;
    }
    const frame = requestAnimationFrame(() => {
      resolveFocusTarget(pendingFocus)?.focus();
      store.clearPendingFocus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus]);
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab wrap inside the panel and never reach the page behind it. */
export function useFocusTrap(
  container: HTMLElement | null,
  onEscape: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || container === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [container, onEscape, active]);
}
