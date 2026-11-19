import { h, trapFocus } from './dom.js';

export interface Modal {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  close(): void;
}

let openCount = 0;

/** The one centred dialog style, plus the bottom sheet, with a focus trap and an inert page behind. */
export function openModal(options: {
  title: string;
  opener?: HTMLElement | null;
  sheet?: boolean;
  onEscape?: () => void;
  onClose?: () => void;
}): Modal {
  const root = document.getElementById('app')!;
  const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`;
  const body = h('div', { class: 'dialog-body' });
  const panel = h(
    'div',
    {
      class: options.sheet === true ? 'sheet' : 'dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    },
    [h('h2', { class: 'dialog-title', id: titleId, text: options.title }), body],
  );
  const backdrop = h('div', { class: 'backdrop' }, [panel]);
  document.body.append(backdrop);
  openCount += 1;
  root.setAttribute('inert', '');

  const close = (): void => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    openCount -= 1;
    if (openCount === 0) root.removeAttribute('inert');
    options.onClose?.();
    options.opener?.focus();
  };

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (options.onEscape === undefined) close();
      else options.onEscape();
      return;
    }
    trapFocus(panel, event);
  });

  return { element: panel, body, close };
}

export function dialogActions(children: HTMLElement[]): HTMLElement {
  return h('div', { class: 'dialog-actions' }, children);
}

export function primaryButton(label: string, onActivate: () => void): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'button primary', text: label });
  button.addEventListener('click', onActivate);
  return button;
}

export function plainButton(label: string, onActivate: () => void): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'button', text: label });
  button.addEventListener('click', onActivate);
  return button;
}

/** Marks a submit button busy while its request is in flight and ignores repeat presses. */
export function withBusy(button: HTMLButtonElement, work: () => Promise<void>): () => void {
  let running = false;
  return () => {
    if (running) return;
    running = true;
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    void work().finally(() => {
      running = false;
      button.removeAttribute('aria-busy');
      button.disabled = false;
    });
  };
}

export function fieldError(field: string): HTMLElement {
  const node = h('p', { class: 'field-error', hidden: true });
  node.dataset['field'] = field;
  return node;
}

export function showFieldErrors(container: HTMLElement, fields: Record<string, string>): void {
  for (const node of container.querySelectorAll<HTMLElement>('.field-error')) {
    const key = node.dataset['field'];
    const message = key === undefined ? undefined : fields[key];
    node.textContent = message ?? '';
    node.toggleAttribute('hidden', message === undefined);
  }
}
