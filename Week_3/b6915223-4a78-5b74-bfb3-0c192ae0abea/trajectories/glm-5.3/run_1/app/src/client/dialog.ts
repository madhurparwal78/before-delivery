export interface FocusTrapOptions {
  dialog: HTMLElement;
  onClose: () => void;
  initialFocus?: HTMLElement | null;
  returnFocus: HTMLElement;
}

export function focusTrap(options: FocusTrapOptions): void {
  const { dialog, onClose, initialFocus, returnFocus } = options;
  const selector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const focusables = (): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );

  const focusFirst = (): void => {
    const target = initialFocus ?? focusables()[0] ?? null;
    (target ?? dialog).focus();
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || active === dialog || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || active === dialog || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const close = (): void => {
    dialog.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('focusin', handleFocusin, true);
    onClose();
    returnFocus.focus();
  };

  const handleFocusin = (event: FocusEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    if (dialog.contains(target)) return;
    const items = focusables();
    if (items.length === 0) return;
    items[0].focus();
  };

  dialog.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('focusin', handleFocusin, true);
  focusFirst();
}

export function announceOnce(region: HTMLElement, text: string): void {
  region.textContent = '';
  window.requestAnimationFrame(() => {
    region.textContent = text;
  });
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function pendingButton(button: HTMLButtonElement, pendingText: string, action: () => Promise<void>): Promise<void> {
  const original = button.textContent ?? '';
  button.disabled = true;
  button.textContent = pendingText;
  return action().finally(() => {
    button.disabled = false;
    button.textContent = original;
  });
}
