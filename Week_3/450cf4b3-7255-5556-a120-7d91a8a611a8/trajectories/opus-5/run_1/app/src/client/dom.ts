export interface ElementOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: ReadonlyArray<Node>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(name, value);
  }
  for (const child of options.children ?? []) node.append(child);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

/** Writes text only when it changed, so in-place updates never disturb the page. */
export function setText(node: Element, text: string): boolean {
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
}

/** Conflict and refusal copy is the only copy drawn in tomato. */
export function setMessage(node: Element, text: string, kind: 'plain' | 'conflict'): void {
  setText(node, text);
  node.className = kind === 'conflict' ? 'refusal-copy' : 'outcome-copy';
}

export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type CancelTween = () => void;

/** Frame-by-frame tween used for heights and numerals. */
export function tween(
  from: number,
  to: number,
  durationMs: number,
  onFrame: (value: number) => void,
): CancelTween {
  if (prefersReducedMotion() || durationMs <= 0 || from === to) {
    onFrame(to);
    return () => undefined;
  }
  let frame = 0;
  const started = performance.now();
  const step = (at: number): void => {
    const progress = Math.min(1, (at - started) / durationMs);
    const eased = 1 - (1 - progress) * (1 - progress);
    onFrame(from + (to - from) * eased);
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

export function focusElement(node: HTMLElement | null): void {
  if (node === null) return;
  requestAnimationFrame(() => {
    node.focus();
  });
}
