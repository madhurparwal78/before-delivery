// Tiny DOM builder used by every screen.
import {
  Bookmark, BookmarkCheck, Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CircleAlert, Clock, Download, Gavel,
  Lock, LogOut, Plus, Search, Trash2, Upload, UserCheck, UserPlus, X,
} from "lucide";

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, ...children);
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function replace(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, ...children);
}

const ICONS = {
  bookmark: Bookmark, "bookmark-check": BookmarkCheck, check: Check, "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight, "chevron-up": ChevronUp, "chevron-down": ChevronDown, alert: CircleAlert, clock: Clock,
  download: Download, gavel: Gavel, lock: Lock, "log-out": LogOut, plus: Plus, search: Search, trash: Trash2,
  upload: Upload, "user-check": UserCheck, "user-plus": UserPlus, x: X,
} as const;

export type IconName = keyof typeof ICONS;
const SVG = "http://www.w3.org/2000/svg";

/** A decorative Lucide icon; every control that carries one also carries a text label. */
export function icon(name: IconName, size = 18): SVGSVGElement {
  const [, , children = []] = ICONS[name];
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false", class: "icon" })) {
    svg.setAttribute(k, String(v));
  }
  for (const [tag, attrs] of children) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  }
  return svg;
}

export function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A small drawn contact-sheet glyph for empty lists. */
export function emptyGlyph(): SVGSVGElement {
  const glyph = svg("svg", { width: 56, height: 44, viewBox: "0 0 56 44", "aria-hidden": "true", class: "empty-glyph" }) as SVGSVGElement;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      glyph.append(svg("rect", { x: 2 + col * 18, y: 2 + row * 21, width: 16, height: 19, fill: "none",
        stroke: "currentColor", "stroke-width": 1 }));
    }
  }
  glyph.append(svg("path", { d: "M6 36 C 16 28, 30 44, 50 30", fill: "none", stroke: "currentColor", "stroke-width": 1.5,
    "stroke-linecap": "round", class: "empty-glyph-mark" }));
  return glyph;
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Writes a status line; repeated identical messages are re-announced. */
export function say(region: HTMLElement, text: string): void {
  if (region.textContent === text) region.textContent = "";
  region.textContent = text;
}
