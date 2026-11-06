// Tiny DOM helpers for hand-built screens.

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (value === true) node.setAttribute(key, "");
    else if (value !== false) node.setAttribute(key, value as string);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
};

export const clear = (node: Element): void => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

export const status = (role: string, id: string): HTMLDivElement => {
  const node = el("div", { role, id, class: "status-live", "aria-live": "polite" });
  return node;
};

// Sets text on a live region; assigning the same text twice still announces
// when the node is rebuilt, so a fresh text node replaces the old content.
export const announce = (node: HTMLElement, text: string): void => {
  clear(node);
  node.append(text);
};

export const focusable = (root: HTMLElement): HTMLElement[] => {
  const selector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
};

// Wraps Tab inside a dialog so focus never escapes (Interactions, Dialogs).
export const trapFocus = (container: HTMLElement, event: KeyboardEvent): void => {
  if (event.key !== "Tab") return;
  const items = focusable(container);
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
};
