/**
 * DOM helpers. The JSX factory builds real DOM nodes, and Lucide icon nodes
 * are turned into inline SVG.
 */

export type Child = Node | string | number | boolean | null | undefined | Array<Child>;

function appendChild(parent: Node, child: Child): void {
  if (child === null || child === undefined || typeof child === "boolean") return;
  if (Array.isArray(child)) {
    for (const c of child) appendChild(parent, c);
    return;
  }
  if (typeof child === "string" || typeof child === "number") {
    parent.appendChild(document.createTextNode(String(child)));
    return;
  }
  parent.appendChild(child);
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "g",
  "defs",
  "use",
  "polyline",
  "polygon",
]);

export interface StyleProps {
  [property: string]: string | number | undefined;
}

/** The JSX factory: builds a real element with the given props and children. */
export function h(
  tag: string,
  props: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElement {
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  applyProps(el as HTMLElement, props);
  for (const child of children) appendChild(el as HTMLElement, child);
  return el as HTMLElement;
}

export function Fragment(_props: null, ...children: Child[]): Array<Node | string> {
  const out: Array<Node | string> = [];
  const collect = (child: Child): void => {
    if (child === null || child === undefined || child === false || child === true) return;
    if (Array.isArray(child)) {
      for (const c of child) collect(c);
      return;
    }
    out.push(child as Node | string);
  };
  for (const child of children) collect(child);
  return out;
}

function applyProps(el: HTMLElement, props: Record<string, unknown> | null): void {
  if (props === null) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") {
      el.setAttribute("class", String(value));
      continue;
    }
    if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value as StyleProps)) {
        if (v === undefined) continue;
        (el.style as unknown as Record<string, string | number>)[prop] = v;
      }
      continue;
    }
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      continue;
    }
    if (key === "dataset" && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, string>)) {
        el.setAttribute(`data-${k}`, v);
      }
      continue;
    }
    if (key === "checked" || key === "value" || key === "selected" || key === "disabled") {
      if (key === "value") {
        (el as unknown as { value: string }).value = String(value);
      } else if (key === "disabled" && value === true) {
        (el as unknown as { disabled: boolean }).disabled = true;
      } else if (key === "checked" && value === true) {
        (el as unknown as { checked: boolean }).checked = true;
      } else if (key === "selected" && value === true) {
        (el as unknown as { selected: boolean }).selected = true;
      }
      continue;
    }
    if (value === true) {
      el.setAttribute(key, "");
      continue;
    }
    el.setAttribute(key, String(value));
  }
}

/** A Lucide icon as an inline SVG. */
export function icon(name: string, size = 18): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const node = (lucideIcons as Record<string, Array<[string, Record<string, string>]>>)[name];
  if (node !== undefined) {
    for (const [tag, attrs] of node) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) {
        shape.setAttribute(k, v);
      }
      svg.appendChild(shape);
    }
  }
  return svg;
}

/** The Lucide icon data, injected at build time (see vite.config.ts). */
declare const lucideIcons: Record<string, unknown>;

export function el(tag: string): HTMLElement {
  return document.createElement(tag);
}

/** Formats an instant like "Oct 20, 2026, 2:00 PM" in the given zone. */
export function formatInstant(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** A month label like "March 2027" from a YYYY-MM value. */
export function monthLabel(month: string): string {
  const [year, mm] = month.split("-");
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[Number.parseInt(mm ?? "1", 10) - 1] ?? ""} ${year}`;
}

export function twoDecimals(value: number): string {
  return value.toFixed(2);
}
