import { h } from './dom';

interface DialogHandle { element: HTMLDialogElement; close(): void }

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: the first control takes focus, Tab wraps inside, Escape closes and returns focus to the control that opened it.
 * `onEscape` runs on Escape before the dialog closes.
 */
export function openDialog(name: string, content: Node[], options: { alert?: boolean; onClose?: () => void } = {}): DialogHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const element = h('dialog', { 'aria-label': name, class: 'dialog', role: options.alert ? 'alertdialog' : undefined }, ...content);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    element.close();
    element.remove();
    options.onClose?.();
    opener?.focus();
  };
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...element.querySelectorAll<HTMLElement>(focusable)].filter((c) => c.getAttribute('aria-hidden') !== 'true');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  element.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(element);
  element.showModal();
  element.querySelector<HTMLElement>(focusable)?.focus();
  return { element, close };
}

export function dialogButtons(...buttons: HTMLButtonElement[]): HTMLElement {
  return h('div', { class: 'dialog-actions' }, ...buttons);
}
