import { fadeIn, fadeOut } from './motion.js';

export interface ElementOptions {
  class?: string;
  text?: string;
  testid?: string;
  attrs?: Record<string, string>;
  data?: Record<string, string>;
  on?: Record<string, (event: Event) => void>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.class !== undefined) element.className = options.class;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.testid !== undefined) element.dataset['testid'] = options.testid;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    element.setAttribute(name, value);
  }
  for (const [name, value] of Object.entries(options.data ?? {})) {
    element.dataset[name] = value;
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    element.addEventListener(name, handler);
  }
  element.append(...children);
  return element;
}

export function button(
  label: string,
  onClick: () => void,
  options: ElementOptions = {},
): HTMLButtonElement {
  const element = el('button', { ...options, text: label });
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

/** A primary action marks itself busy while the request it started is pending. */
export async function withBusy(
  control: HTMLButtonElement,
  action: () => Promise<void>,
): Promise<void> {
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  try {
    await action();
  } finally {
    control.disabled = false;
    control.removeAttribute('aria-busy');
  }
}

export function field(
  label: string,
  input: HTMLInputElement | HTMLTextAreaElement,
  description?: HTMLElement,
): HTMLElement {
  const id = `field-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const labelElement = el('label', { class: 'well-label', text: label, attrs: { for: id } });
  const wrapper = el('div', { class: 'field' }, [labelElement, input]);
  if (description !== undefined) wrapper.append(description);
  return wrapper;
}

/** A field error is a tear-off slip pinned under its field and named as its description. */
export function slip(text: string): HTMLElement {
  return el('p', { class: 'slip', text });
}

export function attachSlip(
  input: HTMLInputElement | HTMLTextAreaElement,
  holder: HTMLElement,
  text: string | null,
): void {
  holder.replaceChildren();
  if (text === null) {
    input.removeAttribute('aria-describedby');
    input.removeAttribute('aria-invalid');
    return;
  }
  const element = slip(text);
  element.id = `${input.id}-error`;
  holder.append(element);
  input.setAttribute('aria-describedby', element.id);
  input.setAttribute('aria-invalid', 'true');
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

export interface Dialog {
  element: HTMLElement;
  close: () => void;
}

const stack: Dialog[] = [];

/** Every dialog traps Tab, closes on Escape or backdrop, and gives focus back. */
export function openDialog(options: {
  label: string;
  className?: string;
  opener: HTMLElement | null;
  build: (dialog: Dialog) => (Node | string)[];
  onClose?: () => void;
}): Dialog {
  const backdrop = el('div', { class: 'backdrop' });
  const element = el('div', {
    class: `dialog ${options.className ?? ''}`.trim(),
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.label },
  });

  const dialog: Dialog = {
    element,
    close: () => {
      if (!backdrop.isConnected) return;
      stack.splice(stack.indexOf(dialog), 1);
      document.removeEventListener('keydown', onKeyDown, true);
      void fadeOut(element).then(() => backdrop.remove());
      options.onClose?.();
      options.opener?.focus();
    },
  };

  function onKeyDown(event: KeyboardEvent): void {
    // Only the dialog on top answers Escape and keeps Tab inside itself.
    if (stack[stack.length - 1] !== dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(element);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  element.append(...options.build(dialog));
  backdrop.append(element);
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) dialog.close();
  });
  document.body.append(backdrop);
  document.addEventListener('keydown', onKeyDown, true);
  stack.push(dialog);
  fadeIn(element);
  focusables(element)[0]?.focus();
  return dialog;
}

/** A long press of half a second opens the letter actions; shorter does nothing. */
export function onLongPress(element: HTMLElement, action: () => void): void {
  let timer: number | null = null;
  const cancel = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    cancel();
    timer = window.setTimeout(() => {
      timer = null;
      action();
    }, 500);
  });
  for (const name of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove']) {
    element.addEventListener(name, cancel);
  }
  element.addEventListener('contextmenu', (event) => event.preventDefault());
}

export function svg(markup: string, className: string): HTMLElement {
  const holder = el('span', { class: className, attrs: { 'aria-hidden': 'true' } });
  holder.innerHTML = markup;
  return holder;
}

/** The plain avatar, drawn in code. */
export function plainAvatar(): HTMLElement {
  return svg(
    `<svg viewBox="0 0 48 48" width="48" height="48" focusable="false">
       <rect width="48" height="48" fill="#ffffff"/>
       <circle cx="24" cy="18" r="8" fill="#11152b"/>
       <path d="M8 44c0-9 7-14 16-14s16 5 16 14z" fill="#11152b"/>
     </svg>`,
    'avatar plain',
  );
}

export function monogram(): HTMLElement {
  return svg(
    `<svg viewBox="0 0 48 48" width="40" height="40" focusable="false">
       <text x="24" y="33" text-anchor="middle" font-family="'Zilla Slab', serif"
             font-size="28" font-weight="600" fill="#11152b">Hp</text>
     </svg>`,
    'monogram',
  );
}

export function diamond(): HTMLElement {
  return svg(
    `<svg viewBox="0 0 8 8" width="8" height="8" focusable="false">
       <path d="M4 0l4 4-4 4-4-4z" fill="#11152b"/>
     </svg>`,
    'diamond',
  );
}

/** A white aerogramme sheet: airmail stripe edge, fold perforations, flat offset. */
export function sheet(options: { class?: string; folds?: boolean } = {}): {
  outer: HTMLElement;
  inner: HTMLElement;
} {
  const inner = el('div', { class: 'sheet-inner' });
  if (options.folds !== false) {
    inner.append(
      el('span', { class: 'fold fold-one', attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'fold fold-two', attrs: { 'aria-hidden': 'true' } }),
    );
  }
  const outer = el('div', { class: `sheet ${options.class ?? ''}`.trim() }, [inner]);
  return { outer, inner };
}
