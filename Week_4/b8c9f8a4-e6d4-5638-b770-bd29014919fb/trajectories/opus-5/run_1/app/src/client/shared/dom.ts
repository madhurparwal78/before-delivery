export type Attrs = Record<string, string | number | boolean | null | undefined>;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  for (const child of children) node.append(child);
  return node;
};

export const applyAttrs = (node: Element, attrs: Attrs): void => {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (name === 'class') node.setAttribute('class', String(value));
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
};

export const svgFrom = (markup: string): SVGElement => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = markup;
  const svg = wrapper.firstElementChild;
  if (svg === null) throw new Error('That markup held no element');
  return svg as SVGElement;
};

export const clear = (node: Element): void => {
  node.replaceChildren();
};

export const qs = <T extends Element>(root: ParentNode, selector: string): T | null =>
  root.querySelector<T>(selector);

export const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing element ${selector}`);
  return found;
};

/** Moves focus to a heading or control, making a heading focusable only while it holds focus. */
export const focusTarget = (node: HTMLElement): void => {
  if (node.tabIndex < 0 && !node.hasAttribute('tabindex')) {
    node.setAttribute('tabindex', '-1');
  }
  node.focus({ preventScroll: true });
};

/** Brings a section into view and moves focus to its heading. */
export const goToSection = (section: HTMLElement, heading: HTMLElement): void => {
  section.scrollIntoView({ behavior: 'auto', block: 'start' });
  focusTarget(heading);
};

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusableWithin = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0,
  );

export const setPending = (control: HTMLElement, pending: boolean): void => {
  if (pending) {
    control.setAttribute('aria-disabled', 'true');
    control.dataset.pending = 'true';
  } else {
    control.removeAttribute('aria-disabled');
    delete control.dataset.pending;
  }
};

export const isPending = (control: HTMLElement): boolean => control.dataset.pending === 'true';

/** A press on a pending control sends nothing. */
export const onPress = (control: HTMLElement, handler: () => void): void => {
  control.addEventListener('click', (event) => {
    event.preventDefault();
    if (isPending(control)) return;
    handler();
  });
};

export const viewportIsPhone = (): boolean => window.innerWidth <= 767;
