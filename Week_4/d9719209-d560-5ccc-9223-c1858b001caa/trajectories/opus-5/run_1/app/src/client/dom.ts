export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function on<K extends keyof HTMLElementEventMap>(
  target: EventTarget,
  type: K | string,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler as EventListener, options);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function displayDepth(): number {
  return window.innerWidth >= 768 ? 8 : 5;
}

const TOAST_LIFETIME_MS = 5000;

function toast(message: string, assertive: boolean): void {
  const stack = qs('#toast-stack');
  if (!stack) return;
  const item = document.createElement('p');
  item.className = assertive ? 'toast toast-alert' : 'toast';
  item.textContent = message;
  stack.append(item);
  window.setTimeout(() => item.remove(), TOAST_LIFETIME_MS);
}

/** Every announcement goes to one live region and to a visible toast, and never moves focus. */
export function announce(message: string): void {
  const region = qs('#live-status');
  if (region) region.textContent = message;
  toast(message, false);
}

export function alertAnnounce(message: string): void {
  const region = qs('#live-alert');
  if (region) region.textContent = message;
  toast(message, true);
}

export function setFieldError(input: HTMLElement | null, message: string | null): void {
  if (!input) return;
  const error = document.getElementById(`${input.id}-error`);
  if (message === null) {
    input.removeAttribute('aria-invalid');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
    return;
  }
  input.setAttribute('aria-invalid', 'true');
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
}

/** Marks every refused field and moves focus to the first one. */
export function applyFieldErrors(form: HTMLElement, fields: Record<string, string>): void {
  const inputs = qsa<HTMLInputElement | HTMLTextAreaElement>('input, textarea, select', form);
  for (const input of inputs) setFieldError(input, null);
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = inputs.find((candidate) => candidate.name === name || candidate.id === name) ?? null;
    if (!input) continue;
    setFieldError(input, message);
    if (first === null) first = input;
  }
  if (first) first.focus();
}

export function setPressed(button: HTMLElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  button.classList.toggle('is-pressed', pressed);
}

export function focusable(root: ParentNode): HTMLElement[] {
  return qsa<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    root,
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

export function parseFragment(markup: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}
