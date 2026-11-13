// Small DOM helpers: typed element creation and focus management for dialogs. DP-41.

export interface ElementAttrs {
  [key: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: ElementAttrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value as Record<string, string>)) {
        node.dataset[dataKey] = dataValue;
      }
    } else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'value') {
      (node as unknown as { value: unknown }).value = value;
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Keeps Tab and Shift+Tab inside the dialog; Escape closes and returns focus to the opener. */
export function trapFocus(container: HTMLElement, onClose: () => void): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusables = (): HTMLElement[] => {
    const nodes = container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    return [...nodes].filter((node) => !node.hasAttribute('disabled') && node.offsetParent !== null);
  };
  window.setTimeout(() => {
    const first = focusables()[0];
    first?.focus();
  }, 0);
  let closed = false;
  const keydown = (event: KeyboardEvent) => {
    if (closed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  // Escape is heard at the document level so it works wherever focus sits.
  document.addEventListener('keydown', keydown, true);
  // The dialog itself also keeps the tab ring inside.
  container.addEventListener('keydown', keydown);
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', keydown, true);
    container.removeEventListener('keydown', keydown);
    onClose();
    opener?.focus();
  };
  return close;
}

/** Time rules: HH:MM today, otherwise D Mon HH:MM. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return hhmm;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${hhmm}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
