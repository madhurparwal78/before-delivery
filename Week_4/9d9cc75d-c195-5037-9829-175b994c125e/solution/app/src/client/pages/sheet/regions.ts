import { useEffect } from 'react';
import type { RefObject } from 'react';

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function firstFocusable(region: HTMLElement): HTMLElement {
  const found = [...region.querySelectorAll<HTMLElement>(TABBABLE)].find((element) => element.getClientRects().length > 0);
  return found ?? region;
}

/**
 * F6 and Shift+F6 move focus to the first focusable element of the next or previous `[data-region]` under `root`, in
 * document order, wrapping at both ends. It works from any control in a region; inside a dialog or menu it does nothing.
 */
export function useRegionKeys(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F6' || !root.current) return;
      const active = document.activeElement;
      if (active instanceof Element && active.closest('[role="dialog"], [role="menu"]')) return;
      const regions = [...root.current.querySelectorAll<HTMLElement>('[data-region]')].filter(
        (region) => region.getClientRects().length > 0,
      );
      if (regions.length === 0) return;
      event.preventDefault();
      const at = regions.findIndex((region) => active instanceof Node && region.contains(active));
      const step = event.shiftKey ? -1 : 1;
      const next = at < 0 ? (event.shiftKey ? regions.length - 1 : 0) : (at + step + regions.length) % regions.length;
      const region = regions[next];
      if (region) firstFocusable(region).focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [root]);
}
