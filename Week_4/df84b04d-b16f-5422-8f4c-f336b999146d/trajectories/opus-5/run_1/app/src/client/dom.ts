type Attributes = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined;

/** Builds an element with attributes and children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttributes(node, attributes);
  append(node, children);
  return node;
}

export function setAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function append(node: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

/** A simple line icon, drawn from a path so no outside asset is needed. */
export function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

export const icons = {
  back: 'M15 5 8 12l7 7',
  forward: 'M9 5l7 7-7 7',
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  board: 'M4 5h5v14H4zM15 5h5v9h-5z',
  share: 'M12 4v10M8 8l4-4 4 4M5 14v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4',
  download: 'M12 4v10m-4-4 4 4 4-4M5 19h14',
  undo: 'M9 7 5 11l4 4M5 11h8a5 5 0 1 1 0 10h-3',
  redo: 'M15 7l4 4-4 4M19 11h-8a5 5 0 1 0 0 10h3',
  indent: 'M10 6h10M10 12h10M10 18h10M4 9l3 3-3 3',
  outdent: 'M10 6h10M10 12h10M10 18h10M7 9l-3 3 3 3',
  up: 'M12 19V5m-6 6 6-6 6 6',
  down: 'M12 5v14m6-6-6 6-6-6',
  collapse: 'M5 9l7 7 7-7',
  complete: 'M5 13l4 4L19 7',
  zoomIn: 'M5 12h10m-4-4 4 4-4 4M19 5v14',
  zoomOut: 'M19 12H9m4-4-4 4 4 4M5 5v14',
  mirror: 'M12 4v16M8 8 4 12l4 4M16 8l4 4-4 4',
  trash: 'M5 7h14M9 7V5h6v2m-8 0 1 12h8l1-12',
  at: 'M15.5 12a3.5 3.5 0 1 1-3.5-3.5 3.5 3.5 0 0 1 3.5 3.5v1.5a2 2 0 0 0 4 0V12a7.5 7.5 0 1 0-3 6',
  menu: 'M4 7h16M4 12h16M4 17h16'
} as const;
