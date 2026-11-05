import { manageDialog, one } from './dom.js';

/** Below 768 the studio navigation lives inside the Studio menu sheet. */
const dialog = one<HTMLDialogElement>('[data-studio-menu-dialog]');
const button = one<HTMLButtonElement>('[data-open-studio-menu]');
const nav = one<HTMLElement>('[data-studio-nav]');

if (dialog !== null && button !== null && nav !== null) {
  const slot = one<HTMLElement>('[data-studio-menu-slot]', dialog);
  const home = nav.parentElement;
  const next = nav.nextElementSibling;
  const handle = manageDialog(dialog, () => button);
  button.addEventListener('click', () => {
    slot?.append(nav);
    handle.open();
  });
  one<HTMLButtonElement>('[data-close-studio-menu]', dialog)?.addEventListener('click', () => {
    handle.close();
    home?.insertBefore(nav, next);
  });
}
