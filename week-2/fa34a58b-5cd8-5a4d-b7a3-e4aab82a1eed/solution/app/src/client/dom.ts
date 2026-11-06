// Small DOM helpers: elements are always built with textContent, never from HTML strings.

type Attrs = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  setAttrs(element, attrs);
  append(element, children);
  return element;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  setAttrs(element, attrs);
  append(element, children);
  return element;
}

function setAttrs(element: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") element.addEventListener(name.slice(2), value);
    else if (name === "class") element.setAttribute("class", String(value));
    else element.setAttribute(name, value === true ? "" : String(value));
  }
}

function append(element: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/** Text with every numeral run set in the mono face with tabular figures. */
export function num(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(/\d+(?:[:.,]\d+)*/g)) {
    const index = match.index ?? 0;
    if (index > last) fragment.append(text.slice(last, index));
    const span = document.createElement("span");
    span.className = "num";
    span.textContent = match[0];
    fragment.append(span);
    last = index + match[0].length;
  }
  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}

/** Replaces an element's content with text whose numerals are mono. */
export function setNum(element: Element, text: string): void {
  if (element.textContent === text) return;
  element.replaceChildren(num(text));
}

export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

let counter = 0;
export const uid = (prefix: string): string => `${prefix}-${(counter += 1)}`;

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export const phone = window.matchMedia("(max-width: 599.98px)");

/** One brief cyan outline pulse on an element whose value the server just changed. */
export function pulse(element: Element): void {
  if (reducedMotion.matches) return;
  element.animate(
    [{ outlineColor: "rgba(155, 235, 255, 0.95)" }, { outlineColor: "rgba(155, 235, 255, 0)" }],
    { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}

/** An empty list's note with a small drafted room outline. */
export function emptyNote(text: string): HTMLParagraphElement {
  const glyph = s("svg", { class: "empty-glyph", viewBox: "0 0 40 32", width: 40, height: 32, "aria-hidden": "true", focusable: "false" },
    s("rect", { x: 4, y: 4, width: 32, height: 24 }), s("path", { d: "M18 28v-9h10" }));
  return h("p", { class: "empty" }, glyph, h("span", {}, text));
}
