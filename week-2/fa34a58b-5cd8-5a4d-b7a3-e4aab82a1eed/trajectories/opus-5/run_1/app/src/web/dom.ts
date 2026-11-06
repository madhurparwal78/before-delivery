import { icon, type IconName } from './icons';

export const SHEET_TRANSITION_MS = 320;
const PULSE_MS = 440;

/** Parses an icon's markup into a node, so it never lands in a control's name as text. */
export function svgIcon(name: IconName): Node {
  const template = document.createElement('template');
  template.innerHTML = icon(name).trim();
  const node = template.content.firstChild;
  if (!node) throw new Error(`Icon ${name} did not parse`);
  return node;
}

export function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

export function find<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isWideViewport(): boolean {
  return window.matchMedia('(min-width: 1280px)').matches;
}

export function pulse(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  element.classList.remove('pulse');
  void element.offsetWidth;
  element.classList.add('pulse');
  window.setTimeout(() => element.classList.remove('pulse'), PULSE_MS);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="slider"], [role="switch"]';

export function focusableIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0,
  );
}

export interface SheetHandle {
  readonly name: string;
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  close: () => void;
}

interface OpenSheet extends SheetHandle {
  opener: HTMLElement | null;
  closeTimer: number | null;
}

const stack: OpenSheet[] = [];

function backdrop(): HTMLElement {
  return must<HTMLElement>('[data-backdrop]');
}

function syncBackdrop(): void {
  const open = stack.some((sheet) => sheet.closeTimer === null);
  backdrop().hidden = !open;
  backdrop().classList.toggle('shown', open);
}

export function openSheet(options: {
  name: string;
  opener: HTMLElement | null;
  className?: string;
}): SheetHandle {
  const existing = stack.find((sheet) => sheet.name === options.name);
  if (existing) {
    // Reopening a sheet while it is still closing leaves it open.
    if (existing.closeTimer !== null) {
      window.clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
      existing.element.classList.remove('closing');
      existing.element.classList.add('shown');
      syncBackdrop();
    }
    return existing;
  }

  const body = el('div', { class: 'sheet-body' });
  const element = el(
    'div',
    {
      class: `sheet ${options.className ?? ''}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
    },
    [body],
  );
  must<HTMLElement>('[data-sheet-root]').append(element);

  const sheet: OpenSheet = {
    name: options.name,
    element,
    body,
    opener: options.opener,
    closeTimer: null,
    close: () => closeSheet(sheet),
  };
  stack.push(sheet);

  requestAnimationFrame(() => element.classList.add('shown'));
  if (prefersReducedMotion()) element.classList.add('shown');
  syncBackdrop();

  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeSheet(sheet);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(element);
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
  });

  return sheet;
}

export function focusFirstIn(sheet: SheetHandle): void {
  const items = focusableIn(sheet.element);
  (items[0] ?? sheet.element).focus();
}

function closeSheet(sheet: OpenSheet): void {
  if (sheet.closeTimer !== null) return;
  // A closing sheet stops blocking the page at once.
  sheet.element.classList.add('closing');
  sheet.element.classList.remove('shown');
  syncBackdrop();
  const opener = sheet.opener;
  const finish = (): void => {
    const index = stack.indexOf(sheet);
    if (index >= 0) stack.splice(index, 1);
    sheet.element.remove();
    syncBackdrop();
  };
  if (prefersReducedMotion()) {
    finish();
  } else {
    sheet.closeTimer = window.setTimeout(finish, SHEET_TRANSITION_MS);
  }
  if (opener && document.body.contains(opener)) opener.focus();
}

export function closeTopSheet(): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const sheet = stack[index] as OpenSheet;
    if (sheet.closeTimer === null) {
      closeSheet(sheet);
      return;
    }
  }
}

export function installSheetDismissal(): void {
  backdrop().addEventListener('click', () => closeTopSheet());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTopSheet();
  });
}
