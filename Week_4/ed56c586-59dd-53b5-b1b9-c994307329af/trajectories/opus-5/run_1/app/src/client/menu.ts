/** The mobile menu dialog. */

import { need, queryAll } from './dom.js';
import { createModal } from './modal.js';

const CLOSE_SLIDE_MS = 250;

export const setUpMenu = (): void => {
  const button = need<HTMLButtonElement>('[data-menu-button]');
  const layer = need<HTMLElement>('[data-dialog-layer="menu"]');
  const dialog = need<HTMLElement>('[data-menu-dialog]');
  const backdrop = need<HTMLElement>('[data-menu-backdrop]');
  const closeButton = need<HTMLButtonElement>('[data-menu-close]');
  const links = queryAll<HTMLAnchorElement>('.menu-link', dialog);

  const modal = createModal({
    layer,
    dialog,
    backdrop,
    closeDelayMs: CLOSE_SLIDE_MS,
    onClose: () => button.setAttribute('aria-expanded', 'false'),
  });

  button.addEventListener('click', () => {
    if (modal.isOpen()) {
      modal.close();
      return;
    }
    const first = links[0];
    if (first === undefined) return;
    button.setAttribute('aria-expanded', 'true');
    modal.open(button, first);
  });

  closeButton.addEventListener('click', () => modal.close());

  // A chosen link closes the menu at once; the jump then lands on the heading.
  for (const link of links) {
    link.addEventListener('click', () => modal.close({ keepFocus: true, immediate: true }));
  }
};
