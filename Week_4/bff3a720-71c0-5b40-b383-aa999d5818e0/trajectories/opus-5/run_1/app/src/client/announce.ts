import { h } from './dom.js';
import { runMotion } from './motion.js';
import { pageConfig } from './state.js';

let announcer: HTMLElement | null = null;
let notifications: HTMLElement | null = null;

export function mountRegions(announceRegion: HTMLElement, toastRegion: HTMLElement): void {
  announcer = announceRegion;
  notifications = toastRegion;
}

/** The one polite live region of the page. */
export function announce(text: string): void {
  if (!announcer) return;
  if (announcer.textContent !== text) {
    announcer.textContent = text;
    return;
  }
  // Repeating the same words needs a clear first, or the region says nothing.
  announcer.textContent = '';
  window.setTimeout(() => {
    if (announcer) announcer.textContent = text;
  }, 20);
}

export interface ToastOptions {
  undo?: { onUndo: () => void };
}

export function toast(message: string, options: ToastOptions = {}): void {
  if (!notifications) return;
  const undoButton = options.undo
    ? h('button', { type: 'button', class: 'toast-undo', text: 'Undo' })
    : null;
  const element = h('div', { class: 'toast' }, h('span', { text: message }), undoButton);
  notifications.appendChild(element);
  runMotion(element, 'toast');
  const leave = () => {
    window.clearTimeout(timer);
    element.remove();
  };
  if (undoButton && options.undo) {
    undoButton.addEventListener('click', () => {
      options.undo?.onUndo();
      leave();
    });
  }
  const timer = window.setTimeout(leave, pageConfig().toast_seconds * 1000);
}

/** The error or outage copy for the request a control sent, beside that control. */
export function setAlert(slot: HTMLElement, message: string | null): void {
  slot.textContent = '';
  slot.removeAttribute('role');
  if (!message) return;
  slot.setAttribute('role', 'alert');
  slot.textContent = message;
}

export function setFieldErrors(
  form: HTMLElement,
  fields: Record<string, string> | undefined,
): void {
  for (const slot of form.querySelectorAll<HTMLElement>('[data-field-error]')) {
    slot.textContent = '';
    slot.removeAttribute('role');
  }
  if (!fields) return;
  for (const [field, message] of Object.entries(fields)) {
    const slot = form.querySelector<HTMLElement>(`[data-field-error="${field}"]`);
    if (slot) {
      slot.setAttribute('role', 'alert');
      slot.textContent = message;
    }
  }
}

const busy = new WeakSet<HTMLElement>();

/** While a request is in flight the control reads `Working` and ignores presses. */
export async function withPending<T>(
  control: HTMLElement,
  run: () => Promise<T>,
): Promise<T | null> {
  if (busy.has(control)) return null;
  busy.add(control);
  const label = control.textContent ?? '';
  control.textContent = 'Working';
  control.setAttribute('aria-busy', 'true');
  try {
    return await run();
  } finally {
    control.textContent = label;
    control.removeAttribute('aria-busy');
    busy.delete(control);
  }
}
