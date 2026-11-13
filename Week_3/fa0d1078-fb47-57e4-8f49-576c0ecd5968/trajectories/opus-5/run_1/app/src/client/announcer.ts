import { el } from './dom';

let region: HTMLElement | null = null;

export function announcerElement(): HTMLElement {
  region ??= el('div', { id: 'announcer', role: 'status', 'aria-live': 'polite' });
  return region;
}

/** One polite live region, which repeats a sentence by clearing it first. */
export function announce(sentence: string): void {
  const node = announcerElement();
  if (node.textContent === sentence) {
    node.textContent = '';
    requestAnimationFrame(() => {
      node.textContent = sentence;
    });
    return;
  }
  node.textContent = sentence;
}
