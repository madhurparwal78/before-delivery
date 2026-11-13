// DOM helpers shared by the screens: element creation, focus management, live regions.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function focusable(container: HTMLElement): HTMLElement[] {
  const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), a[href]';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function focusFirst(container: HTMLElement): void {
  const first = focusable(container)[0];
  if (first) first.focus();
}

export function focusNode(node: HTMLElement | null | undefined): void {
  if (node) {
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    node.focus();
  }
}

/** Trap Tab inside the dialog so focus never leaves it while open. */
export function trapTab(container: HTMLElement, onEscape?: () => void): void {
  container.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Escape' && onEscape) {
      keyboard.preventDefault();
      onEscape();
      return;
    }
    if (keyboard.key !== 'Tab') return;
    const items = focusable(container);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (keyboard.shiftKey && document.activeElement === first) {
      keyboard.preventDefault();
      last.focus();
    } else if (!keyboard.shiftKey && document.activeElement === last) {
      keyboard.preventDefault();
      first.focus();
    }
  });
}

/** Count Unicode code points, as the server does. */
export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${frac.toString().padStart(2, '0')}`;
}

/** Agency-local date and HH:MM from an ISO instant string. */
export function localDateOf(iso: string): string {
  return iso.slice(0, 10);
}

export function localTimeOf(iso: string): string {
  return iso.slice(11, 16);
}

export function formatBytes(n: number): string {
  return n.toLocaleString('en-US');
}

export function withThousandSeparators(n: number): string {
  return n.toLocaleString('en-US');
}
