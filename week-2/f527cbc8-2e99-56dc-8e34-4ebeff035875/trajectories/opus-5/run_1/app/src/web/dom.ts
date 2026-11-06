/** Small DOM helpers: element building, focus traps and the published motion. */

export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else if (name.startsWith('data-') || name.startsWith('aria-')) node.setAttribute(name, String(value));
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Money and angles that change on screen count over 440 ms and land on the exact value. */
export function countTo(node: HTMLElement, from: number, to: number, format: (value: number) => string): void {
  node.textContent = format(to);
  if (reducedMotion() || from === to) return;
  const started = performance.now();
  const duration = 440;
  const step = (frame: number): void => {
    const progress = Math.min(1, (frame - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    const value = from + (to - from) * eased;
    // The accessible text is final from the start, so only a decorative span moves.
    const visual = node.querySelector('[data-count]');
    if (visual instanceof HTMLElement) visual.textContent = format(progress === 1 ? to : value);
    if (progress < 1) requestAnimationFrame(step);
  };
  const visual = node.querySelector('[data-count]');
  if (visual instanceof HTMLElement) requestAnimationFrame(step);
}

/**
 * A number whose accessible text is final from the start while a decorative span
 * counts to it. Inside an already-hidden line the spoken copy is left out, because
 * the line carries its own.
 */
export function countingNumber(
  value: number,
  format: (value: number) => string,
  options: { spoken?: boolean } = {},
): HTMLElement {
  const wrapper = el('span', { class: 'num' });
  wrapper.append(el('span', { 'aria-hidden': 'true', 'data-count': '', text: format(value) }));
  if (options.spoken !== false) {
    wrapper.append(el('span', { class: 'visually-hidden', text: format(value) }));
  }
  return wrapper;
}

export function setCountingNumber(
  wrapper: HTMLElement,
  from: number,
  to: number,
  format: (value: number) => string,
): void {
  const hidden = wrapper.querySelector('.visually-hidden');
  if (hidden instanceof HTMLElement) hidden.textContent = format(to);
  const visual = wrapper.querySelector('[data-count]');
  if (!(visual instanceof HTMLElement)) return;
  if (reducedMotion() || from === to) {
    visual.textContent = format(to);
    return;
  }
  const started = performance.now();
  const step = (frame: number): void => {
    const progress = Math.min(1, (frame - started) / 440);
    const eased = 1 - (1 - progress) ** 3;
    visual.textContent = format(progress === 1 ? to : from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Marks an element while a published sequence plays, for exactly as long as it plays. */
export function playSequence(node: HTMLElement, name: string, durationMs: number): void {
  if (reducedMotion()) return;
  node.setAttribute('data-anim', name);
  window.setTimeout(() => node.removeAttribute('data-anim'), durationMs);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export interface DialogHandle {
  root: HTMLElement;
  close: () => void;
}

export interface DialogOptions {
  title: string;
  body: (Node | string)[];
  /** Focus starts here; otherwise on the first field. */
  initialFocus?: () => HTMLElement | null;
  onClose?: () => void;
  /** The control to return focus to when the dialog closes. */
  opener?: HTMLElement | null;
}

/**
 * A dialog whose focus is trapped from the first frame and which returns focus to its
 * opener when it closes.
 */
export function openDialog(options: DialogOptions): DialogHandle {
  const dialog = el('div', {
    class: 'dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.title,
  });
  dialog.append(el('h2', { text: options.title }));
  for (const child of options.body) dialog.append(typeof child === 'string' ? document.createTextNode(child) : child);

  const scrim = el('div', { class: 'scrim' }, [dialog]);
  document.body.append(scrim);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    dialog.classList.add('closing');
    const finish = (): void => {
      scrim.remove();
      options.onClose?.();
      options.opener?.focus();
    };
    if (reducedMotion()) finish();
    else window.setTimeout(finish, 240);
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!scrim.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(dialog);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);

  const target = options.initialFocus?.() ?? focusableIn(dialog)[0] ?? dialog;
  target.focus();

  return { root: dialog, close };
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const whole = Math.trunc(Math.abs(cents) / 100);
  const part = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${sign}${whole.toLocaleString('en-US')}.${part}`;
}

export function money(cents: number): string {
  return `$${dollars(cents)}`;
}

export function angle(value: number): string {
  return `${value.toFixed(1)}\u00b0`;
}

/**
 * A load that lasts more than 120 ms shows skeleton rows of the same height as real
 * rows, removed when the load ends. They are placed inside the host that the content
 * will fill, so the shift from skeleton to content stays within the published limit.
 */
export async function withSkeleton<T>(
  host: HTMLElement,
  rowCount: number,
  load: () => Promise<T>,
): Promise<T> {
  const placeholder = el(
    'div',
    { 'aria-hidden': 'true' },
    Array.from({ length: rowCount }, () => el('div', { class: 'skeleton-row' })),
  );
  const timer = window.setTimeout(() => host.append(placeholder), 120);
  try {
    return await load();
  } finally {
    window.clearTimeout(timer);
    placeholder.remove();
  }
}

/** Rows and panels fade in and rise 8 pixels, each starting 40 ms after the one before. */
export function staggerIn(nodes: readonly HTMLElement[]): void {
  if (reducedMotion()) return;
  nodes.slice(0, 6).forEach((node, index) => {
    node.classList.add('rise');
    node.style.animationDelay = `${index * 40}ms`;
    window.setTimeout(() => {
      node.classList.remove('rise');
      node.style.animationDelay = '';
    }, 240 + index * 40);
  });
}
