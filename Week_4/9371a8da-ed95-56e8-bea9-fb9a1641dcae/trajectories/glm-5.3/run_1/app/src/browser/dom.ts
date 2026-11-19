export type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') {
      node.addEventListener(key.replace(/^on/, ''), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'value') {
      (node as unknown as { value: unknown }).value = value;
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else if (key.startsWith('aria-') || key === 'role' || key === 'href' || key === 'id' || key === 'for' || key.startsWith('data-')) {
      node.setAttribute(key, String(value));
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

export function textEl(s: string): Text {
  return document.createTextNode(s);
}

export function focusable(el: HTMLElement | null): boolean {
  return el !== null && el.isConnected;
}

/** Hold Tab inside a container, wrapping forward and backward. */
export function trapTab(container: HTMLElement, ev: KeyboardEvent): boolean {
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
  if (focusables.length === 0) return false;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (ev.shiftKey) {
    if (active === first || active === container || !container.contains(active)) {
      last.focus();
      return true;
    }
  } else if (active === last) {
    first.focus();
    return true;
  }
  return false;
}

export function focusFirst(container: HTMLElement): HTMLElement | null {
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
  if (focusables.length > 0) {
    focusables[0].focus();
    return focusables[0];
  }
  container.setAttribute('tabindex', '-1');
  container.focus();
  return container;
}

/** The mention list for @handle completion inside a Comment or Reply box. */
export interface MentionState {
  open: boolean;
  prefix: string;
  highlighted: number;
  options: { id: string; handle: string; displayName: string }[];
}

export function mentionState(): MentionState {
  return { open: false, prefix: '', highlighted: 0, options: [] };
}

export function updateMention(
  state: MentionState,
  value: string,
  caret: number,
  members: { id: string; handle: string; displayName: string }[],
): void {
  const before = value.slice(0, caret);
  const m = /(?:^|\s)@([a-z0-9]*)$/.exec(before);
  if (!m) {
    state.open = false;
    state.prefix = '';
    state.options = [];
    return;
  }
  const prefix = m[1];
  state.open = true;
  state.prefix = prefix;
  state.options = members.filter((mem) => mem.handle.startsWith(prefix));
  state.highlighted = state.options.length > 0 ? 0 : -1;
}

export function applyMention(
  state: MentionState,
  textarea: HTMLTextAreaElement,
): boolean {
  if (!state.open || state.highlighted < 0) return false;
  const chosen = state.options[state.highlighted];
  if (!chosen) return false;
  const value = textarea.value;
  const caret = textarea.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const m = /(?:^|\s)@([a-z0-9]*)$/.exec(before);
  if (!m) return false;
  const atStart = m.index + (m[0].length - m[1].length - 1);
  const replacement = `@${chosen.handle} `;
  const next = value.slice(0, atStart) + replacement + value.slice(caret);
  textarea.value = next;
  const pos = atStart + replacement.length;
  textarea.setSelectionRange(pos, pos);
  state.open = false;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
