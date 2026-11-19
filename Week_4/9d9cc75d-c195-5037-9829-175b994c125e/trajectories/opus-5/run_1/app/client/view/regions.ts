import { focusables } from '../dom.js';

/** F6 and Shift+F6 move between the page's named regions, wrapping, without trapping Tab. */
export function wireRegions(root: HTMLElement, regions: () => HTMLElement[]): void {
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'F6') return;
    const list = regions().filter((region) => region.isConnected);
    if (list.length === 0) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const current = list.findIndex((region) => active !== null && region.contains(active));
    const step = event.shiftKey ? -1 : 1;
    const next = list[(current + step + list.length) % list.length];
    const roving = next.querySelector<HTMLElement>('[tabindex="0"]');
    const target = roving ?? focusables(next)[0] ?? next;
    if (target.getAttribute('tabindex') === null && !focusables(next).includes(target)) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus();
  });
}
