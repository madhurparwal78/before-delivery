import { useEffect } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * F6 moves focus to the first focusable element of the next `[data-f6]` region in page order, Shift+F6 to the
 * previous one, and both wrap. While a dialog is open the dialog keeps the keyboard.
 */
export function useRegionCycle(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F6' || document.querySelector('[role="dialog"]')) return;
      const regions = [...document.querySelectorAll<HTMLElement>('[data-f6]')];
      if (regions.length === 0) return;
      event.preventDefault();
      const here = regions.findIndex((region) => region.contains(document.activeElement));
      const step = event.shiftKey ? -1 : 1;
      const start = here < 0 && event.shiftKey ? 0 : here;
      const next = regions[(start + step + regions.length) % regions.length];
      next?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
