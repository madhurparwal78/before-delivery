import { all, one } from './dom.js';

function focusable(scope: ParentNode): HTMLElement[] {
  return all<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    scope,
  );
}

export function startDisclosures(): void {
  const menuButton = one<HTMLButtonElement>('[data-menu-button]');
  const nav = one('.primary-nav');
  if (menuButton !== null && nav !== null) {
    menuButton.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  const modelsButton = one<HTMLButtonElement>('[data-models-button]');
  const modelsMenu = one('[data-models-menu]');
  if (modelsButton !== null && modelsMenu !== null) {
    const close = (): void => {
      modelsMenu.hidden = true;
      modelsButton.setAttribute('aria-expanded', 'false');
    };
    modelsButton.addEventListener('click', () => {
      const open = modelsMenu.hidden;
      modelsMenu.hidden = !open;
      modelsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || modelsMenu.hidden) return;
      close();
      modelsButton.focus();
    });
    document.addEventListener('click', (event) => {
      if (modelsMenu.hidden) return;
      const target = event.target as Node;
      if (modelsButton.contains(target) || modelsMenu.contains(target)) return;
      close();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const nav = one('.primary-nav');
    const button = one<HTMLButtonElement>('[data-menu-button]');
    if (nav === null || button === null || !nav.classList.contains('is-open')) return;
    nav.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  });
}

export function manageDialog(
  dialog: HTMLDialogElement,
  opener: HTMLElement,
  safe?: HTMLElement | null,
): void {
  dialog.addEventListener('close', () => opener.focus());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const stops = focusable(dialog);
    if (stops.length === 0) return;
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.showModal();
  const target = safe ?? focusable(dialog)[0] ?? null;
  if (target !== null) target.focus();
}

export function startConsoleDialogs(): void {
  for (const host of all('.dialog-host')) {
    const opener = one<HTMLButtonElement>('[data-dialog-open]', host);
    const dialog = one<HTMLDialogElement>('[data-dialog]', host);
    if (opener === null || dialog === null) continue;
    opener.addEventListener('click', () => manageDialog(dialog, opener));
    const cancel = one<HTMLButtonElement>('[data-dialog-cancel]', dialog);
    if (cancel !== null) cancel.addEventListener('click', () => dialog.close());
  }
}
