import { useEffect, type RefObject } from 'react';

/**
 * One Tab stop for a group of controls: the first item (or the last focused one)
 * is reachable with Tab, and arrow keys move between the rest.
 */
export function useRovingTabIndex(
  container: RefObject<HTMLElement | null>,
  selector: string,
): void {
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const apply = (): void => {
      const items = [...node.querySelectorAll<HTMLElement>(selector)];
      if (items.length === 0) return;
      const focused = items.find((item) => item === document.activeElement);
      const chosen = focused ?? items.find((item) => !item.hasAttribute('disabled')) ?? items[0];
      for (const item of items) {
        const wanted = item === chosen ? 0 : -1;
        if (item.tabIndex !== wanted) item.tabIndex = wanted;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(node, { childList: true, subtree: true });
    node.addEventListener('focusin', apply);
    return () => {
      observer.disconnect();
      node.removeEventListener('focusin', apply);
    };
  }, [container, selector]);
}
