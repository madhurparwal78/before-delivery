// A very small DOM builder. Text always goes in as text nodes, never as markup.

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === 'class') el.className = String(value);
    else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(value));
  }
  append(el, children);
  return el;
}

function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

export function replaceChildren(parent: Element, ...children: Child[]): void {
  parent.textContent = '';
  append(parent, children);
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, props: Record<string, string | number> = {}, ...children: (SVGElement | null)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(props)) el.setAttribute(name, String(value));
  for (const child of children) if (child) el.appendChild(child);
  return el;
}

export const byId = (id: string): HTMLElement | null => document.getElementById(id);
export const isWide = (): boolean => window.matchMedia('(min-width: 768px)').matches;
