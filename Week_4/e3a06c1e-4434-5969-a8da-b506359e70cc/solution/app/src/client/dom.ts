// A small typed element builder: h("button", { class: "primary", onclick }, "Save").
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2), value);
    else if (value === true) element.setAttribute(name, "");
    else element.setAttribute(name, String(value));
  }
  append(element, ...children);
  return element;
}

function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

/** Sets text only when it changes, so a polite live region announces each message once. */
export function say(region: Element, text: string): void {
  if (region.textContent !== text) region.textContent = text;
}

const SVG = "http://www.w3.org/2000/svg";

export function svg(tag: string, attrs: Record<string, string | number>, ...children: SVGElement[]): SVGElement {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  for (const child of children) element.appendChild(child);
  return element;
}

const ICONS: Record<string, string> = {
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  play: "M8 5v14l11-7z",
  stop: "M7 7h10v10H7z",
  copy: "M9 9h10v10H9zM5 15V5h10",
  plus: "M12 5v14M5 12h14",
  key: "M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
  out: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
};

/** An inline stroke icon, hidden from assistive technology (its control carries the name). */
export function icon(name: keyof typeof ICONS): SVGElement {
  const path = svg("path", { d: ICONS[name] });
  const root = svg("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "icon" }, path);
  if (name === "play" || name === "stop") root.setAttribute("fill", "currentColor");
  return root;
}

let ids = 0;
export const uid = (prefix: string) => `${prefix}-${++ids}`;

/** A labelled text field with its error line linked through aria-describedby. */
export function field(label: string, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, hint?: string): { root: HTMLElement; error: (message: string | null) => void } {
  const id = input.id || uid("field");
  input.id = id;
  const errorId = `${id}-error`;
  const hintId = hint ? `${id}-hint` : null;
  const error = h("p", { class: "field-error", id: errorId, hidden: true });
  input.setAttribute("aria-describedby", [hintId, errorId].filter(Boolean).join(" "));
  const root = h("div", { class: "field" }, h("label", { for: id }, label), hint ? h("p", { class: "hint", id: hintId! }, hint) : null, input, error);
  return {
    root,
    error: (message) => {
      error.hidden = !message;
      error.textContent = message ?? "";
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    },
  };
}

/**
 * Gives a data table explicit ARIA roles and labels each cell with its column header, so the
 * stacked-card layout used on phones keeps the table's semantics and shows what each figure is.
 */
export function cardTable(table: HTMLTableElement): void {
  const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
  table.setAttribute("role", "table");
  table.querySelectorAll("thead, tbody").forEach((group) => group.setAttribute("role", "rowgroup"));
  for (const row of table.querySelectorAll("tr")) {
    row.setAttribute("role", "row");
    [...row.children].forEach((cell, i) => {
      if (cell.tagName === "TH") cell.setAttribute("role", cell.getAttribute("scope") === "row" ? "rowheader" : "columnheader");
      else {
        cell.setAttribute("role", "cell");
        if (headers[i] && !cell.hasAttribute("colspan")) cell.setAttribute("data-label", headers[i]);
      }
    });
  }
}

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
