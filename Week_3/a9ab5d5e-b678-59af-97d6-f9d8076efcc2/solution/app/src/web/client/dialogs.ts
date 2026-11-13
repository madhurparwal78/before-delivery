import { el, trapFocus } from './dom';

interface Modal {
  element: HTMLElement;
  showAlert(message: string | null): void;
  close(): void;
}

const openModals = new Set<Modal>();

/** A screen change takes any open dialog with it. */
export function closeAllModals(): void {
  for (const modal of [...openModals]) modal.close();
}

/** A modal dialog that keeps Tab inside itself and returns focus to its opener. */
export function openModal(options: {
  title: string;
  content: HTMLElement[];
  actions: HTMLElement[];
  opener: HTMLElement | null;
  onClose?: () => void;
}): Modal {
  const alertRegion = el('p', { role: 'alert', class: 'dialog-alert' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title, class: 'dialog' }, [
    el('h2', { class: 'dialog-title', text: options.title }),
    alertRegion,
    ...options.content,
    el('div', { class: 'dialog-actions' }, options.actions),
  ]);
  const backdrop = el('div', { class: 'dialog-backdrop' }, [dialog]);
  document.body.append(backdrop);
  const first = dialog.querySelector<HTMLElement>('input, select, textarea, button');
  first?.focus();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(dialog, event);
  };
  backdrop.addEventListener('keydown', onKeyDown);

  function close(): void {
    openModals.delete(modal);
    backdrop.remove();
    options.opener?.focus();
    options.onClose?.();
  }

  const modal: Modal = {
    element: dialog,
    showAlert(message: string | null): void {
      alertRegion.textContent = message ?? '';
    },
    close,
  };
  openModals.add(modal);
  return modal;
}
