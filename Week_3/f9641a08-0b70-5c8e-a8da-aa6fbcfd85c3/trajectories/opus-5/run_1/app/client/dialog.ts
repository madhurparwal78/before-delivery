import { qs, qsa, runStates } from './core.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="slider"], [role="radio"]';

const openers = new Map<string, HTMLElement>();

function focusable(dialog: HTMLElement): HTMLElement[] {
  return qsa<HTMLElement>(FOCUSABLE, dialog).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );
}

export function dialogByName(name: string): HTMLElement | null {
  return qs<HTMLElement>(`[data-dialog="${name}"]`);
}

export function openDialog(name: string, opener?: HTMLElement | null): void {
  const dialog = dialogByName(name);
  if (dialog === null) return;
  if (opener !== undefined && opener !== null) openers.set(name, opener);
  dialog.setAttribute('open', '');
  dialog.removeAttribute('inert');
  runStates(dialog, 'opening', 'open', 320);
  const first = focusable(dialog)[0];
  if (first !== undefined) first.focus();
  else dialog.focus();
}

export function closeDialog(name: string): void {
  const dialog = dialogByName(name);
  if (dialog === null) return;
  dialog.removeAttribute('open');
  runStates(dialog, 'closing', 'closed', 320);
  const opener = openers.get(name);
  if (opener !== undefined && document.contains(opener)) opener.focus();
}

export function isOpen(dialog: HTMLElement): boolean {
  return dialog.hasAttribute('open');
}

export function setupDialogs(): void {
  for (const dialog of qsa<HTMLElement>('[data-dialog]')) {
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    dialog.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(dialog.dataset.dialog ?? '');
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(dialog);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const open = qsa<HTMLElement>('[data-dialog][open]');
    const topmost = open[open.length - 1];
    if (topmost === undefined) return;
    event.preventDefault();
    closeDialog(topmost.dataset.dialog ?? '');
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    const opener = target.closest<HTMLElement>('[data-dialog-open]');
    if (opener !== null) {
      event.preventDefault();
      openDialog(opener.dataset.dialogOpen ?? '', opener);
      return;
    }
    const closer = target.closest<HTMLElement>('[data-dialog-close]');
    if (closer !== null) {
      event.preventDefault();
      closeDialog(closer.dataset.dialogClose ?? '');
    }
  });

  const menuButton = qs<HTMLElement>('[data-menu-open]');
  if (menuButton !== null) {
    menuButton.addEventListener('click', () => openDialog('menu', menuButton));
  }

  setupSwipeToClose();
}

function setupSwipeToClose(): void {
  for (const dialog of qsa<HTMLElement>('[data-dialog="filters"], [data-dialog="bag"], [data-dialog="menu"]')) {
    let startY = 0;
    dialog.addEventListener(
      'touchstart',
      (event: TouchEvent) => {
        startY = event.touches[0]?.clientY ?? 0;
      },
      { passive: true }
    );
    dialog.addEventListener(
      'touchend',
      (event: TouchEvent) => {
        const endY = event.changedTouches[0]?.clientY ?? 0;
        if (endY - startY > 40) closeDialog(dialog.dataset.dialog ?? '');
      },
      { passive: true }
    );
  }
}

export function registerOpener(name: string, opener: HTMLElement): void {
  openers.set(name, opener);
}
