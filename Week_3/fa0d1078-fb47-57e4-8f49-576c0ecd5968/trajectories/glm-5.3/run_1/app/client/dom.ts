// Small DOM helpers used across the client. Every element the app renders is
// created here so attributes stay predictable for tests.

export type Attrs = Record<string, string | boolean | number | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (value === true) node.setAttribute(name, '');
    else if (value !== false) node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clearChildren(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

export function qsOpt<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector) ?? null;
}

export function text(t: string): Text {
  return document.createTextNode(t);
}

// The one polite live region on every page. To repeat the same sentence, the
// page clears the text first and sets it again on the next animation frame.
export function announce(sentence: string): void {
  const region = qsOpt<HTMLElement>('#announcer');
  if (!region) return;
  if (region.textContent === sentence) {
    region.textContent = '';
    requestAnimationFrame(() => {
      region.textContent = sentence;
    });
    return;
  }
  region.textContent = sentence;
}
