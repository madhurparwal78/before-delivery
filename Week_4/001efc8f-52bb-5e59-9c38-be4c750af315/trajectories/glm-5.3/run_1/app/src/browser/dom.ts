const cache = new Map<string, string>();

/** Loads a Lucide icon from the app's own origin, once per name. */
export async function icon(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  try {
    const res = await fetch(`/assets/icons/${name}.svg`);
    if (!res.ok) {
      cache.set(name, '');
      return '';
    }
    const svg = await res.text();
    const stripped = svg.replace(/<\?xml[^>]*\?>/g, '');
    cache.set(name, stripped);
    return stripped;
  } catch {
    cache.set(name, '');
    return '';
  }
}

export function el(tag: string, attrs?: Record<string, string | null>, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svgEl(svg: string, cls?: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `icon ${cls ?? ''}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = svg;
  return span;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
