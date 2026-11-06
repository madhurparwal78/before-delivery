// A small typed helper for building DOM, plus the few shared bits of markup.

type Child = Node | string | null | undefined | false;
type Handler = (event: Event) => void;
type Attrs = Record<string, string | number | boolean | null | undefined | Handler>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "class") el.className = String(value);
    else if (name === "value" && "value" in el) (el as HTMLInputElement).value = String(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  append(el, children.flat());
  return el;
}

export function append(parent: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child);
  }
}

let nextId = 0;
export function uid(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/** A live region that exists from first render; its text is set when an action finishes. */
export function statusRegion(name: string, className = "result"): HTMLParagraphElement {
  return h("p", { role: "status", "aria-label": name, class: className });
}

/** Mono uppercase label text. */
export function label(text: string): HTMLSpanElement {
  return h("span", { class: "label" }, text);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide icon paths (ISC licence), drawn at 20 px with a 2 px stroke. */
const ICONS = {
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  logOut: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  camera: [
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
    "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  ],
} as const;

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "square", "stroke-linejoin": "miter", "aria-hidden": "true", class: "icon" })) {
    svg.setAttribute(k, v);
  }
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The empty-state drawing: a pegboard hook with nothing hanging on it (original). */
function emptyHook(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 48 48", width: "48", height: "48", "aria-hidden": "true", class: "empty__art" })) svg.setAttribute(k, v);
  const shapes: [string, Record<string, string>][] = [
    ["circle", { cx: "12", cy: "10", r: "2.5", class: "empty__hole" }],
    ["circle", { cx: "36", cy: "10", r: "2.5", class: "empty__hole" }],
    ["circle", { cx: "12", cy: "38", r: "2.5", class: "empty__hole" }],
    ["circle", { cx: "36", cy: "38", r: "2.5", class: "empty__hole" }],
    ["path", { d: "M24 8v10a8 8 0 1 0 8 8", class: "empty__hook" }],
  ];
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

export function emptyState(text: string): HTMLDivElement {
  return h("div", { class: "empty" }, emptyHook(), h("p", { class: "label" }, text));
}

export function loadingLine(): HTMLParagraphElement {
  return h("p", { class: "loading label" }, "Loading");
}

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Plays the one-off orange underline sweep on a row that just arrived. */
export function markArrived(row: Element): void {
  row.classList.remove("arrived");
  void (row as HTMLElement).offsetWidth;
  row.classList.add("arrived");
}
