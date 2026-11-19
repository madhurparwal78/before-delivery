import { createElement, type IconNode } from "lucide";

export type Child = Node | string | number | null | undefined | false | Child[];
type AttrValue = string | number | boolean | null | undefined;
type Attrs = Record<string, AttrValue | ((event: Event) => void)>;

function apply(el: Element, attrs: Attrs | null | undefined): void {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value !== null && value !== undefined) el.setAttribute(key, String(value));
  }
}

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.append(child);
    else if (child !== null && child !== undefined && child !== false) el.append(String(child));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function icon(node: IconNode, size = 18): SVGElement {
  return createElement(node, { "aria-hidden": "true", width: size, height: size, "stroke-width": 1.75, focusable: "false" });
}

export function replace(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
