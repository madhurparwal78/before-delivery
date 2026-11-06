/**
 * Dialog controller — the single place for focus trapping, opener focus
 * restore and Escape. Uses the native dialog element so the page behind is
 * inert automatically. When the opener is gone on close, focus moves to the
 * fallback the caller names (a screen or pane heading).
 */
export interface DialogHandle {
  dialog: HTMLDialogElement;
  close(result?: unknown): void;
}

export type DialogResult = 'cancel' | 'submit' | 'removed-opener';

interface StackEntry {
  dialog: HTMLDialogElement;
  opener: HTMLElement | null;
  fallback: HTMLElement | null;
}

const openStack: StackEntry[] = [];

export function focusFirstField(dialog: HTMLDialogElement): void {
  const control = dialog.querySelector<HTMLElement>('input, select, textarea, button:not([data-keep])');
  (control ?? dialog).focus();
}

export function openDialog(options: {
  name: string;
  build: (dialog: HTMLDialogElement, close: (result: DialogResult) => void) => void;
  opener: HTMLElement | null;
  fallback?: HTMLElement | null;
  onClose?: (result: DialogResult) => void;
  focusKeepButton?: boolean;
  escape?: boolean;
}): DialogHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'lq';
  dialog.setAttribute('aria-label', options.name);
  const entry: StackEntry = { dialog, opener: options.opener, fallback: options.fallback ?? null };
  const handle: DialogHandle = {
    dialog,
    close: (result?: unknown) => {
      const resolved = (result as DialogResult) ?? 'cancel';
      if (!dialog.open) return;
      dialog.close();
      const index = openStack.findIndex((candidate) => candidate.dialog === dialog);
      if (index >= 0) openStack.splice(index, 1);
      options.onClose?.(resolved);
      if (options.opener && document.contains(options.opener)) {
        options.opener.focus();
      } else if (entry.fallback && document.contains(entry.fallback)) {
        entry.fallback.focus();
      }
    },
  };
  options.build(dialog, (result) => handle.close(result));
  document.body.append(dialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (options.escape === false) return;
    handle.close('cancel');
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || active === dialog) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  dialog.showModal();
  openStack.push(entry);
  if (options.focusKeepButton) {
    const keep = dialog.querySelector<HTMLButtonElement>('[data-keep]');
    (keep ?? dialog).focus();
  } else {
    focusFirstField(dialog);
  }
  return handle;
}

export function hasOpenDialog(): boolean {
  return openStack.length > 0;
}
