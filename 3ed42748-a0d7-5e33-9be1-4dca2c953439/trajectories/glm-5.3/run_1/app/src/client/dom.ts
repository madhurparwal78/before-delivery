// Small DOM helpers, Lucide icons, and the app's motion preference.

import { iconNodes } from "./icons/nodes.js";

export type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h(tag: string, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined>): HTMLElement {
  const el = document.createElement(tag);
  apply(el, attrs);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function apply(el: HTMLElement, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as (e: Event) => void);
    } else if (key === "class") {
      el.setAttribute("class", String(value));
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

/** A Lucide icon drawn in ink. */
export function icon(name: keyof typeof iconNodes, size = 18): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of iconNodes[name]) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

// The reduced-motion preference, read live (DP-75).
export class MotionPreference {
  private readonly query = matchMedia("(prefers-reduced-motion: reduce)");
  private listeners: Array<(reduced: boolean) => void> = [];

  constructor() {
    this.query.addEventListener("change", () => {
      for (const l of this.listeners) l(this.query.matches);
    });
  }

  get reduced(): boolean {
    return this.query.matches;
  }

  onChange(listener: (reduced: boolean) => void): void {
    this.listeners.push(listener);
  }
}

/** Eases: start quickly, settle softly, never overshoot. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The elapsed fraction of a duration, clamped. */
export function progress(startMs: number, durationMs: number, now: number): number {
  return clamp((now - startMs) / durationMs, 0, 1);
}
