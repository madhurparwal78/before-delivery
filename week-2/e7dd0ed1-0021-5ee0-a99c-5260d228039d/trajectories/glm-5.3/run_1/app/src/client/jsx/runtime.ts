// Minimal JSX runtime: h() returns virtual trees; render() patches the DOM.
export interface VNode {
  type: string | ((props: Record<string, unknown>) => VNode | VNode[]);
  props: Record<string, unknown>;
  children: VNode[];
}

// Fragments render as a transparent wrapper (CSS display:contents).
export const Fragment: (props: Record<string, unknown>) => VNode[] = () => [];

export function h(
  type: string | ((props: Record<string, unknown>) => VNode | VNode[]),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): VNode {
  if (type === Fragment) {
    return { type: 'fs-frag', props: props ?? {}, children: flatten(children) };
  }
  return { type, props: props ?? {}, children: flatten(children) };
}

function flatten(children: unknown[]): VNode[] {
  const out: VNode[] = [];
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) { for (const v of flatten(c)) out.push(v); continue; }
    out.push(toVNode(c));
  }
  return out;
}

function toVNode(c: unknown): VNode {
  if (c !== null && typeof c === 'object' && (c as VNode).type !== undefined) return c as VNode;
  return { type: '#text', props: { value: String(c) }, children: [] };
}
