// Shared page furniture: announcements, toasts, alerts, dialogs and forms.
import { h, clear } from './dom.js';
import { MOTION, runMotion, prefersReduced } from './motion.js';

// Exactly one polite announcements region per page.
export function announcements(): HTMLElement {
  let region = document.getElementById('announcements');
  if (!region) {
    region = h('div', { id: 'announcements', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
    document.body.appendChild(region);
  }
  return region;
}

export function announce(text: string): void {
  const region = announcements();
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = text;
  }, 10);
}

let toastTimer: number | undefined;
let toastSeconds = 5;

export function setToastSeconds(seconds: number): void {
  toastSeconds = seconds;
}

export function toast(text: string): HTMLElement {
  let host = document.getElementById('cb-toast');
  if (!host) {
    host = h('div', { id: 'cb-toast' });
    document.body.appendChild(host);
  }
  clear(host as HTMLElement);
  const element = h('div', { class: 'toast', ...motionAttrsToast(false) }, text);
  host.appendChild(element);
  runMotion(element, MOTION.toast);
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element.setAttribute('data-state', 'closing');
    window.setTimeout(() => {
      element.setAttribute('data-state', 'closed');
      element.remove();
    }, prefersReduced() ? 0 : MOTION.toast.ms);
  }, toastSeconds * 1000);
  return element;
}

function motionAttrsToast(opening: boolean): Record<string, string> {
  const reduced = prefersReduced();
  return {
    'data-motion': 'toast',
    'data-motion-ms': reduced ? '0' : '200',
    'data-state': opening ? 'opening' : 'open',
  };
}

export function alertBand(text: string | null): HTMLElement {
  let host = document.getElementById('cb-alert');
  if (!host) {
    host = h('div', { id: 'cb-alert' });
    document.body.appendChild(host);
  }
  clear(host as HTMLElement);
  if (text === null) return host as HTMLElement;
  const element = h('div', { role: 'alert', class: 'alert-band' }, text);
  host.appendChild(element);
  return element;
}

export function fieldError(field: string, message: string | null): HTMLElement | null {
  const existing = document.getElementById(`error-${field}`);
  if (existing) existing.remove();
  if (!message) return null;
  return h('p', { id: `error-${field}`, class: 'field-error' }, message);
}

// A dialog that traps focus, closes on Escape and returns focus to its opener.
export function openDialog(
  name: string,
  build: (dialog: HTMLDialogElement) => HTMLElement,
  opener: HTMLElement,
): HTMLDialogElement {
  const dialog = h('dialog', { 'aria-label': name, class: name === 'Filters' ? 'bottom-sheet' : '' }) as HTMLDialogElement;
  document.body.appendChild(dialog);
  const content = build(dialog);
  dialog.appendChild(content);
  dialog.addEventListener('close', () => {
    opener.focus();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.showModal();
  const firstControl = dialog.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  (firstControl ?? dialog).focus();
  return dialog;
}

export interface PendingState {
  setWorking: (text: string) => void;
  clear: () => void;
}

export function pendingButton(button: HTMLElement, captionHost: HTMLElement | null): PendingState {
  const original = button.getAttribute('aria-disabled') !== 'true';
  return {
    setWorking: (text: string) => {
      button.setAttribute('aria-disabled', 'true');
      (button as HTMLButtonElement).disabled = true;
      if (captionHost) {
        clear(captionHost);
        captionHost.appendChild(document.createTextNode(` ${text}`));
      }
      announce(text);
    },
    clear: () => {
      if (original) {
        button.setAttribute('aria-disabled', 'false');
        (button as HTMLButtonElement).disabled = false;
      }
      if (captionHost) clear(captionHost);
    },
  };
}
