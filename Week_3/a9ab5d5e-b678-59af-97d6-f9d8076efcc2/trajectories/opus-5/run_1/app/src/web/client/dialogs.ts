import { el, trapFocus } from './dom';

export interface Modal {
  element: HTMLElement;
  alert(message: string | null): void;
  close(): void;
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
    backdrop.remove();
    options.opener?.focus();
    options.onClose?.();
  }

  return {
    element: dialog,
    alert(message: string | null): void {
      alertRegion.textContent = message ?? '';
    },
    close,
  };
}
