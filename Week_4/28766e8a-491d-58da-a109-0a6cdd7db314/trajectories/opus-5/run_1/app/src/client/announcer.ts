import { h } from './dom.js';

let region: HTMLElement | null = null;

/** `#announcer` is the one polite live region and carries every announcement. */
export function announcer(): HTMLElement {
  region ??= h('div', { id: 'announcer', 'aria-live': 'polite', 'aria-atomic': 'true' });
  return region;
}

export function announce(message: string): void {
  const node = announcer();
  // Replacing the text on a later frame makes repeated identical messages speak again.
  node.textContent = '';
  requestAnimationFrame(() => {
    node.textContent = message;
  });
}
