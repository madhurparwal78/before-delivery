type Attributes = Record<string, string | number | boolean | null | undefined | EventListener>;
export type Child = Node | string | number | null | undefined | false | Child[];

const appendChild = (parent: Node, child: Child): void => {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) appendChild(parent, item);
    return;
  }
  parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
};

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2), value as EventListener);
      continue;
    }
    if (key === 'value' && element instanceof HTMLInputElement) {
      element.value = String(value);
      continue;
    }
    element.setAttribute(key, value === true ? '' : String(value));
  }
  appendChild(element, children);
  return element;
};

export const svg = (markup: string, label: string, extra: Record<string, string> = {}): HTMLElement => {
  const holder = h('span', { role: 'img', 'aria-label': label, class: 'object', ...extra });
  holder.innerHTML = markup;
  return holder;
};

export const clear = (node: HTMLElement): void => {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
};

export const focusable = (root: HTMLElement): HTMLElement[] =>
  [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null || element === document.activeElement);

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
