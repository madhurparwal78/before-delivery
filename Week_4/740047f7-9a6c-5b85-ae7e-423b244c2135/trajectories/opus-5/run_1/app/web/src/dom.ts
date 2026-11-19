export type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | number | null | undefined | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child = null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  append(node, children);
  return node;
}

function setAttrs(node: HTMLElement, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(key);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

export function append(parent: Node, children: Child): void {
  if (children === null || children === undefined) return;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return;
  }
  if (children instanceof Node) {
    parent.appendChild(children);
    return;
  }
  parent.appendChild(document.createTextNode(String(children)));
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/// Replaces text only when it changed, so updating in place never disturbs
/// keyboard focus, selection or the caret.
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setAttr(node: HTMLElement, key: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(key)) node.removeAttribute(key);
  } else if (node.getAttribute(key) !== value) {
    node.setAttribute(key, value);
  }
}

export function icon(kind: "arrow" | "alert" | "menu" | "copy" | "download"): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const paths: Record<string, string> = {
    arrow: "M5 12h14M13 6l6 6-6 6",
    alert: "M12 4l9 16H3zM12 10v5M12 17.5v.5",
    menu: "M4 9h16M4 15h16",
    copy: "M9 9h11v11H9zM4 4h11v3M4 4v11h3",
    download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  };
  path.setAttribute("d", paths[kind]);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isTouch(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

export function layout(): "phone" | "tablet" | "laptop" {
  const width = window.innerWidth;
  if (width < 600) return "phone";
  if (width < 1100) return "tablet";
  return "laptop";
}

/// Characters as people count them: extended grapheme clusters.
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function graphemeCount(text: string): number {
  if (!segmenter) return Array.from(text).length;
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}
