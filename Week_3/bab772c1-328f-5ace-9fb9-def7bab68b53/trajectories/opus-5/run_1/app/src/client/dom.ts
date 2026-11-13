/** Small DOM helpers used by every screen. */

type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (name === "class") {
      node.className = String(value);
      continue;
    }
    if (name === "text") {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}

export function liveRegion(name: string): HTMLElement {
  return el("p", {
    role: "status",
    "aria-live": "polite",
    "aria-label": name,
    class: "live",
  });
}

export function announce(region: HTMLElement, message: string): void {
  region.textContent = message;
}

export function fieldError(input: HTMLElement, message: string | null): void {
  const id = `${input.id}-error`;
  const existing = document.getElementById(id);
  if (message === null) {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    existing?.remove();
    return;
  }
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", id);
  if (existing) {
    existing.textContent = message;
    return;
  }
  const error = el("p", { id, class: "field-error", text: message });
  input.insertAdjacentElement("afterend", error);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function forcedColours(): boolean {
  return window.matchMedia("(forced-colors: active)").matches;
}

/** Keeps Tab and Shift+Tab inside a dialog or drawer. */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
