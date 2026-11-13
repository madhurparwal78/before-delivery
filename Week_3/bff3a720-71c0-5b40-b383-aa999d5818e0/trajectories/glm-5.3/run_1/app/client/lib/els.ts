/**
 * The JSX runtime: `h` builds real DOM nodes. Children flatten; pages render
 * once and update by targeted DOM edits.
 */
type Child = unknown;

export function h(tag: string, propsOrChild?: Record<string, unknown> | Child | null, ...rest: Child[]): HTMLElement {
  const node = document.createElement(tag);
  if (isProps(propsOrChild)) apply(node, propsOrChild);
  else if (propsOrChild !== undefined && propsOrChild !== null) append(node, [propsOrChild]);
  append(node, rest);
  return node;
}

function isProps(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Node) && typeof v !== 'function';
}

function apply(node: HTMLElement, props: Record<string, unknown> | null): void {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value') (node as unknown as { value: unknown }).value = v as unknown;
    else if (k === 'checked') (node as unknown as { checked: unknown }).checked = Boolean(v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
}

function append(node: HTMLElement, children: unknown[]): void {
  for (const child of children.flat(Infinity) as unknown[]) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else if (typeof child === 'string') node.append(document.createTextNode(child));
    else if (typeof child === 'number') node.append(document.createTextNode(String(child)));
    else if (typeof child === 'function') { const r = (child as () => HTMLElement)(); if (r) node.append(r); }
    else node.append(child as Node);
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

