// Small DOM helpers shared by every screen.
export type Attrs = Record<string, unknown>;

export function el(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "value") {
      (node as HTMLInputElement).value = String(value);
    } else if (key === "checked") {
      (node as HTMLInputElement).checked = Boolean(value);
    } else if (key === "selected") {
      (node as HTMLOptionElement).selected = Boolean(value);
    } else if (key === "dataset") {
      for (const [dataKey, dataValue] of Object.entries(value as Record<string, string>)) {
        node.dataset[dataKey] = dataValue;
      }
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function status(name: string, ...children: (Node | string | null | undefined)[]): HTMLElement {
  return el("div", { class: "status", role: "status", "aria-label": name }, ...children);
}

export function region(name: string, ...children: (Node | string | null | undefined)[]): HTMLElement {
  return el("section", { class: "region", role: "region", "aria-label": name }, ...children);
}

export function heading(level: number, ...children: (Node | string | null | undefined)[]): HTMLElement {
  return el(`h${level}`, { class: "heading" }, ...children);
}

export function focusable(node: HTMLElement): HTMLElement {
  node.tabIndex = -1;
  return node;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
