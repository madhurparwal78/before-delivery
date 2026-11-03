// A small element builder: attributes, listeners and children in one call.
type Child = Node | string | null | undefined | false;
type Listener = (event: Event) => void;
type Attrs = Record<string, string | number | boolean | null | undefined | Listener>;

function apply(el: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value !== null && value !== undefined) el.setAttribute(key, String(value));
  }
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function replace(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}

/** A named live region (`role=status`), visible on the page. */
export function statusRegion(name: string, className = "status"): HTMLDivElement {
  return h("div", { role: "status", "aria-label": name, "aria-live": "polite", class: className });
}

/** Writes text into a live region. */
export function say(region: HTMLElement, text: string): void {
  region.textContent = text;
}

let counter = 0;
export const uid = (prefix: string): string => `${prefix}-${(counter += 1)}`;

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
