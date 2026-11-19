import { h } from './dom.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab past the last control wraps to the first and Shift+Tab before the first wraps to the last. */
export function keepFocusInside(dialog: HTMLDialogElement): void {
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const stops = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );
    if (stops.length === 0) return;
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    }
  });
}

export interface DialogHandle {
  element: HTMLDialogElement;
  problem: HTMLElement;
  close(): void;
  showProblem(message: string): void;
}

export interface DialogOptions {
  label: string;
  heading?: string;
  /** Focus returns to the control that opened the dialog. */
  restoreFocus: () => void;
  /** The announcer shared with the screen, so a refusal inside a dialog is announced too. */
  announce?: (message: string) => void;
}

/**
 * Every dialog keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to its
 * opener, which a modal dialog element does natively.
 */
export function openDialog(options: DialogOptions, build: (handle: DialogHandle) => Node[]): DialogHandle {
  const problem = h('div', { class: 'alert', role: 'alert', 'aria-label': 'Dialog problem' });
  const element = h('dialog', { 'aria-label': options.label, class: 'mullion-dialog' }) as HTMLDialogElement;

  const handle: DialogHandle = {
    element,
    problem,
    close: () => {
      element.close();
    },
    showProblem: (message: string) => {
      problem.textContent = message;
      options.announce?.(message);
    },
  };

  if (options.heading) element.append(h('h2', { text: options.heading }));
  element.append(problem);
  for (const node of build(handle)) element.append(node);

  element.addEventListener('close', () => {
    element.remove();
    options.restoreFocus();
  });

  keepFocusInside(element);
  document.body.append(element);
  element.showModal();
  return handle;
}

export function cancelButton(handle: DialogHandle, label = 'Cancel'): HTMLElement {
  return h('button', { type: 'button', text: label, onclick: () => handle.close() });
}
