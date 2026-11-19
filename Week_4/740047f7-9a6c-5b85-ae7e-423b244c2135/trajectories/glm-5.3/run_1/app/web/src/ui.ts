// Small DOM and formatting helpers shared by every page.

type TypedTag =
  | 'button' | 'input' | 'select' | 'textarea' | 'canvas' | 'a' | 'div' | 'span'
  | 'table' | 'tr' | 'td' | 'th' | 'ul' | 'li' | 'p' | 'h1' | 'h2' | 'h3' | 'label'
  | 'dialog' | 'footer' | 'nav' | 'option' | 'svg';

export function h<T extends TypedTag = 'div'>(tag: T, attrs?: Record<string, unknown>, ...children: (Node | string | null | undefined | false)[]): TypedEl<T> {
  const el = document.createElement(tag) as TypedEl<T>;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v as string;
      else if (k === 'text') el.textContent = v as string;
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export type TypedEl<T extends string> =
  T extends 'button' ? HTMLButtonElement :
  T extends 'input' ? HTMLInputElement :
  T extends 'select' ? HTMLSelectElement :
  T extends 'textarea' ? HTMLTextAreaElement :
  T extends 'canvas' ? HTMLCanvasElement :
  T extends 'option' ? HTMLOptionElement :
  HTMLElement;

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Typed element helpers so callers get the right interface back. */
export function btn(attrs?: Record<string, unknown>, ...children: (Node | string | null | undefined | false)[]): HTMLButtonElement {
  return h('button', attrs, ...children) as HTMLButtonElement;
}
export function input(attrs?: Record<string, unknown>): HTMLInputElement {
  return h('input', attrs) as HTMLInputElement;
}
export function select(attrs?: Record<string, unknown>): HTMLSelectElement {
  return h('select', attrs) as HTMLSelectElement;
}

/** User-perceived character count: extended grapheme clusters, one per cluster. */
export function perceivedLen(text: string): number {
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let n = 0;
  for (const _ of seg.segment(text)) n++;
  return n;
}

export function fmtDec(v: number, decimals: number): string {
  return v.toFixed(decimals);
}

export function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

export function utcDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function utcTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

export function utcStamp(iso: string): string {
  return `${utcDate(iso)} ${utcTime(iso)}`;
}

/** h and m of a remaining-seconds count, whole hours first, rounded down. */
export function hoursMinutes(seconds: number): { h: number; m: number } {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds - h * 3600) / 60);
  return { h, m };
}

export function clockFromSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** Half away from zero, matching the server's rounding. */
export function roundHalf(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  const scaled = v * f;
  const r = scaled < 0 ? -Math.floor(-scaled + 0.5) : Math.floor(scaled + 0.5);
  return r / f;
}

export function wrapBearing(b: number): number {
  let x = ((b % 360) + 360) % 360;
  if (x >= 360) x -= 360;
  return x;
}

/** Camera bearing the net-wall face shows, halves rounding up. */
export function cameraDisplay(azimuth: number): number {
  const wrapped = wrapBearing(azimuth + 0.5);
  return Math.floor(((wrapped % 360) + 360) % 360);
}

export function countWord(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTouch(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function liveStatus(id: string, role: string, label: string): HTMLElement {
  return h('div', { class: 'status num', id, role, 'aria-label': label });
}

export const alertIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 3 L22 20 L2 20 Z M12 10 v5 M12 18 v0.5');
  svg.append(path);
  return svg;
};

/** A status line that can hold either plain text or the published error style. */
export function setStatus(node: HTMLElement, text: string, isError = false) {
  clear(node);
  if (isError) {
    node.append(alertIcon(), ' ' + text);
    node.classList.add('err');
  } else {
    node.classList.remove('err');
    node.textContent = text;
  }
}
