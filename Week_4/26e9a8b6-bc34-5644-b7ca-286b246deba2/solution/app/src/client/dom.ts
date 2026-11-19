type Child = Node | string | null | false | undefined;
type Value = string | number | boolean | EventListener | null | undefined;

/** Builds an element: `on…` props are listeners, `class` sets the class, booleans are bare attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, Value> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') element.className = String(value);
    else if (key === 'value') (element as unknown as HTMLInputElement).value = String(value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

function append(parent: Element, children: Child[]): void {
  for (const child of children) if (child !== null && child !== false && child !== undefined) parent.append(child);
}

export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function currentPath(): string {
  return location.pathname + location.search;
}

/** A box that scrolls only when its content overflows: it joins the Tab order exactly then, so a keyboard can scroll it. */
export function scrollsByKeyboard(box: HTMLElement): HTMLElement {
  const check = () => {
    if (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1) box.tabIndex = 0;
    else box.removeAttribute('tabindex');
  };
  const watch = new ResizeObserver(check);
  watch.observe(box);
  for (const child of box.children) watch.observe(child);
  return box;
}
