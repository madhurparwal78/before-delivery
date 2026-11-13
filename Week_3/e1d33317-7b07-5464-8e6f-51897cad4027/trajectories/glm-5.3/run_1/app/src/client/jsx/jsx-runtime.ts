/**
 * A minimal JSX runtime: createElement builds a virtual tree of plain objects
 * and render() turns it into a real DOM. The workspace re-renders sections by
 * replacing their contents, which keeps the code small and predictable.
 */
export interface VNode {
  type: string | ((props: Record<string, unknown>) => VNode);
  props: Record<string, unknown>;
  children?: unknown[];
}

export function createElement(
  type: string | ((props: Record<string, unknown>) => VNode),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): VNode {
  return { type, props: props ?? {}, children };
}

export function render(vnode: VNode): Node {
  if (typeof vnode.type === 'function') {
    const component = vnode.type as (props: Record<string, unknown>) => VNode;
    return render(component({ ...vnode.props, children: vnode.children }));
  }
  if (vnode.type === '#fragment') {
    const frag = document.createDocumentFragment();
    for (const child of flatten(vnode.children)) {
      frag.appendChild(typeof child === 'string' ? document.createTextNode(child) : render(child));
    }
    return frag;
  }
  const el = document.createElement(vnode.type as string);
  for (const [key, value] of Object.entries(vnode.props)) {
    if (key === 'children') continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'ref' && typeof value === 'object' && value !== null) {
      (value as { current: Element | null }).current = el;
    } else if (key === 'dangerouslySetInnerHTML' && typeof value === 'object' && value !== null) {
      el.innerHTML = (value as { __html: string }).__html;
    } else if (key === 'class' || key === 'className') {
      el.setAttribute('class', String(value));
    } else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '');
    } else if (value !== undefined && value !== null) {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of flatten(vnode.children)) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(render(child));
    }
  }
  return el;
}

function flatten(children: unknown[] | undefined): (VNode | string)[] {
  const out: (VNode | string)[] = [];
  const walk = (value: unknown): void => {
    if (value === null || value === undefined || value === false) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === 'object' && typeof (value as VNode).type === 'string') {
      out.push(value as VNode);
    } else if (typeof value === 'object' && typeof (value as VNode).type === 'function') {
      out.push(value as VNode);
    } else {
      out.push(String(value));
    }
  };
  for (const child of children ?? []) walk(child);
  return out;
}

export function Fragment(props: Record<string, unknown>): VNode {
  return { type: '#fragment', props: {}, children: props.children as unknown[] };
}
