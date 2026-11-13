import { timers } from '../../shared/rules';

export function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`Missing element ${selector}`);
  }
  return found;
}

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let toggle = false;

/** Say something in the page's one polite live region, at once. */
export function announce(message: string): void {
  const region = document.getElementById('announcer');
  if (region !== null) {
    toggle = !toggle;
    // A zero-width mark makes a repeated message a change, so it is read out again.
    region.textContent = message + (toggle ? '​' : '');
  }
}

/** A transient notice: shown bottom-left, faded after the notice timer. Its announcement stays in the live region. */
function notice(message: string): void {
  const host = document.getElementById('notices');
  if (host === null) {
    return;
  }
  const element = document.createElement('p');
  element.className = 'notice';
  element.textContent = message;
  host.append(element);
  let waiting: number | undefined;
  const start = (): void => {
    waiting = window.setTimeout(() => {
      element.classList.add('fading');
      window.setTimeout(() => element.remove(), timers.accordion);
    }, timers.noticeFade);
  };
  element.addEventListener('mouseenter', () => window.clearTimeout(waiting));
  element.addEventListener('mouseleave', start);
  start();
}

/** Announce a result and show it as a notice. */
export function tell(message: string): void {
  announce(message);
  notice(message);
}

export function setBusy(button: HTMLElement, busy: boolean): void {
  if (busy) {
    button.setAttribute('aria-busy', 'true');
  } else {
    button.removeAttribute('aria-busy');
  }
}

export const isTextField = (element: Element | null): boolean =>
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'submit'].includes(element.type)) ||
  (element instanceof HTMLElement && element.isContentEditable);

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter((element) => {
    const index = element.getAttribute('tabindex');
    return !element.hasAttribute('disabled') && !element.hasAttribute('hidden') && (index === null || Number(index) >= 0) && !element.closest('[hidden], [inert]') && !(element instanceof HTMLInputElement && element.type === 'hidden');
  });
}

/** Keep Tab and Shift+Tab inside `container`. */
export function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') {
    return;
  }
  const items = focusables(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (!container.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/** Copy text with the clipboard API, or with a selected field where that API is not offered (plain-HTTP pages). */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) {
    throw new Error('copy failed');
  }
}

/** A random key for one request, from the values every browser can draw. */
export function randomKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
