// A small DOM builder: h("button", { class: "pill", onclick }, "Save build").
export type Child = Node | string | number | null | undefined | false | Child[];
type Value = string | number | boolean | null | undefined | ((event: never) => void);
export type Attrs = Record<string, Value>;

const PROPERTIES = new Set(["value", "checked", "disabled", "selected", "hidden", "indeterminate"]);

function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

function apply(el: Element, attrs: Attrs | null | undefined): void {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === "style" && typeof value === "string") (el as HTMLElement).style.cssText = value;
    else if (PROPERTIES.has(key)) (el as unknown as Record<string, unknown>)[key] = value;
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value !== null && value !== undefined) el.setAttribute(key, String(value));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

let ids = 0;
export function uid(prefix: string): string {
  ids += 1;
  return `${prefix}-${ids}`;
}

export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const EASE = {
  decelerate: "cubic-bezier(0, 0, 0.2, 1)",
  accelerate: "cubic-bezier(0.4, 0, 1, 1)",
  inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

/** Evaluates a CSS cubic-bezier(x1, y1, x2, y2) timing curve at progress x, solved by bisection on x. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const curve = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (curve(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return curve(y1, y2, (lo + hi) / 2);
  };
}

export const CURVES = {
  decelerate: bezier(0, 0, 0.2, 1),
  accelerate: bezier(0.4, 0, 1, 1),
  inOut: bezier(0.4, 0, 0.2, 1),
};

/**
 * Calls `frame` on every animation frame for `ms` of page time with the eased progress, ending with
 * `frame(1, true)`. Frame-driven on requestAnimationFrame and performance.now, so it follows the page clock.
 * Returns a function that stops it where it is.
 */
export function tween(ms: number, curve: (x: number) => number, frame: (progress: number, done: boolean) => void): () => void {
  const start = performance.now();
  let handle = 0;
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / ms);
    frame(curve(t), t >= 1);
    if (t < 1) handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
