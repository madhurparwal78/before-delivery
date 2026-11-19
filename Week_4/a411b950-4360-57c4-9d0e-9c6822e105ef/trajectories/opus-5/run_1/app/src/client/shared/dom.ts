type Attributes = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined;

export function el<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Attributes = {},
  children: Child[] = [],
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableChildren(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/** Keeps Tab and Shift+Tab inside the dialog and closes it on Escape. */
export function trapFocus(dialog: HTMLElement, onEscape: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableChildren(dialog);
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', onKeyDown);
  return () => dialog.removeEventListener('keydown', onKeyDown);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Re-renders without moving focus: a control that survives the render keeps it, and a
 * rebuilt control is found again by its accessible name.
 */
export function preserveFocus(render: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const name = active?.getAttribute('aria-label') ?? null;
  const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
  const start = field?.selectionStart ?? null;
  const end = field?.selectionEnd ?? null;

  render();

  if (active === null || active === document.body) return;
  if (document.contains(active)) active.focus();
  else if (name !== null) {
    document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(name)}"]`)?.focus();
  }
  if (field !== null && document.activeElement === field && start !== null && end !== null) {
    field.setSelectionRange(start, end);
  }
}
