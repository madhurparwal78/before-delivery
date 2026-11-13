/** DOM helpers shared by every screen. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | null> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function announce(id: string, text: string): void {
  const region = document.getElementById(id);
  if (region === null) return;
  region.textContent = "";
  // force re-announce even when the text is unchanged
  window.requestAnimationFrame(() => { region.textContent = text; });
}

/** Position copy: `<label>: page <p>, x <x>, y <y>, width <w>, height <h>` to 3 decimals. */
export function positionCopy(field: { label: string; page: number; x: number; y: number; w: number; h: number }): string {
  const f = (n: number) => n.toFixed(3);
  return `${field.label}: page ${field.page}, x ${f(field.x)}, y ${f(field.y)}, width ${f(field.w)}, height ${f(field.h)}`;
}

export function fieldFractionStyle(field: { x: number; y: number; w: number; h: number }): string {
  return `left:${field.x * 100}%; top:${field.y * 100}%; width:${field.w * 100}%; height:${field.h * 100}%;`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scrolls so the element's top sits at 30–40% of the viewport height. */
export function scrollToFieldTop(target: Element, opts: { smooth?: boolean } = {}): void {
  const rect = target.getBoundingClientRect();
  const absoluteTop = rect.top + window.scrollY;
  const desired = absoluteTop - window.innerHeight * 0.35;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const finalY = Math.max(0, Math.min(desired, max));
  const behavior = prefersReducedMotion() || opts.smooth === false ? "auto" : "smooth";
  window.scrollTo({ top: finalY, behavior });
}

export function formUtcTime(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Code-point length. */
export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function truncateToCodePoints(s: string, max: number): string {
  return Array.from(s).slice(0, max).join("");
}

export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase();
}
