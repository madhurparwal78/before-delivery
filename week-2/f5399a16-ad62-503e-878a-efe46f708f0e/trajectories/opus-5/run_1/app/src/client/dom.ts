/**
 * A keyed patcher. A refresh changes the page by updating existing elements in
 * place, never by rebuilding a screen, so focus, selection, scroll and open
 * dialogs all survive and moved elements keep their identity for motion.
 */
export type Props = Record<string, unknown>;

export type VNode = {
  tag: string;
  key: string | null;
  props: Props;
  children: Child[];
};

export type Child = VNode | string | number | false | null | undefined;

const LISTENERS = Symbol('listeners');
const PREVIOUS = Symbol('previous');

type Patched = Element & {
  [LISTENERS]?: Map<string, EventListener>;
  [PREVIOUS]?: VNode;
};

export function h(tag: string, props: Props = {}, ...children: Child[]): VNode {
  return {
    tag,
    key: typeof props['key'] === 'string' ? props['key'] : null,
    props,
    children: children.flat(4) as Child[],
  };
}

export function text(value: string | number): string {
  return String(value);
}

function create(node: VNode): Element {
  return document.createElement(node.tag);
}

function applyProps(element: Patched, props: Props, previous: Props): void {
  for (const name of Object.keys(previous)) {
    if (name in props || name === 'key') continue;
    if (name.startsWith('on')) {
      removeListener(element, name);
      continue;
    }
    element.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(props)) {
    if (name === 'key') continue;
    if (name.startsWith('on')) {
      setListener(element, name, value as EventListener);
      continue;
    }
    if (name === 'value' && element instanceof HTMLInputElement) {
      if (element.value !== String(value) && document.activeElement !== element) {
        element.value = String(value);
      }
      continue;
    }
    if (name === 'value' && element instanceof HTMLTextAreaElement) {
      if (element.value !== String(value) && document.activeElement !== element) {
        element.value = String(value);
      }
      continue;
    }
    if (name === 'checked' && element instanceof HTMLInputElement) {
      element.checked = value === true;
      continue;
    }
    if (name === 'indeterminate' && element instanceof HTMLInputElement) {
      element.indeterminate = value === true;
      continue;
    }
    if (name === 'selectedValue' && element instanceof HTMLSelectElement) {
      if (element.value !== String(value)) element.value = String(value);
      continue;
    }
    if (value === false || value === null || value === undefined) {
      element.removeAttribute(name);
      continue;
    }
    const wanted = value === true ? '' : String(value);
    if (element.getAttribute(name) !== wanted) element.setAttribute(name, wanted);
  }
}

function setListener(element: Patched, name: string, handler: EventListener): void {
  const type = name.slice(2).toLowerCase();
  let listeners = element[LISTENERS];
  if (!listeners) {
    listeners = new Map();
    element[LISTENERS] = listeners;
  }
  const held = listeners.get(type);
  if (held) element.removeEventListener(type, held);
  element.addEventListener(type, handler);
  listeners.set(type, handler);
}

function removeListener(element: Patched, name: string): void {
  const type = name.slice(2).toLowerCase();
  const held = element[LISTENERS]?.get(type);
  if (held) {
    element.removeEventListener(type, held);
    element[LISTENERS]?.delete(type);
  }
}

function keyOf(child: Child, index: number): string {
  if (child === null || child === undefined || child === false) return `empty-${index}`;
  if (typeof child === 'string' || typeof child === 'number') return `text-${index}`;
  return child.key === null ? `${child.tag}-${index}` : `${child.tag}#${child.key}`;
}

/** Reconciles a parent's children, reusing and moving existing nodes. */
function patchChildren(parent: Element, children: Child[]): void {
  const existing = new Map<string, Node>();
  for (const node of [...parent.childNodes]) {
    const key = (node as { __key?: string }).__key;
    if (key !== undefined) existing.set(key, node);
  }

  const wanted: Node[] = [];
  for (const [index, child] of children.entries()) {
    if (child === null || child === undefined || child === false) continue;
    const key = keyOf(child, index);
    if (typeof child === 'string' || typeof child === 'number') {
      let node = existing.get(key);
      if (!(node instanceof Text)) {
        node = document.createTextNode(String(child));
        (node as unknown as { __key: string }).__key = key;
      } else if (node.data !== String(child)) {
        node.data = String(child);
      }
      wanted.push(node);
      continue;
    }
    let element = existing.get(key);
    if (!(element instanceof Element) || element.tagName.toLowerCase() !== child.tag) {
      element = create(child);
      (element as unknown as { __key: string }).__key = key;
    }
    patchElement(element as Patched, child);
    wanted.push(element);
  }

  // Place the wanted nodes in order, moving only what is out of place.
  let cursor = parent.firstChild;
  for (const node of wanted) {
    if (cursor === node) {
      cursor = cursor.nextSibling;
      continue;
    }
    parent.insertBefore(node, cursor);
  }
  while (cursor !== null) {
    const next = cursor.nextSibling;
    if (!wanted.includes(cursor)) parent.removeChild(cursor);
    cursor = next;
  }
}

function patchElement(element: Patched, node: VNode): void {
  const previous = element[PREVIOUS];
  applyProps(element, node.props, previous?.props ?? {});
  element[PREVIOUS] = node;
  if (node.props['html'] !== undefined) {
    const wanted = String(node.props['html']);
    if (element.innerHTML !== wanted) element.innerHTML = wanted;
    return;
  }
  patchChildren(element, node.children);
}

/** Patches a mounted root in place. */
export function render(root: Element, children: Child[]): void {
  patchChildren(root, children);
}

export function on<K extends keyof HTMLElementEventMap>(
  name: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): Props {
  return { [`on${name}`]: handler as EventListener };
}
