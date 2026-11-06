import { h, type VNode } from './runtime.js';

type Attrs = Record<string, unknown> & { children?: unknown[] };

export function jsx(type: string | ((p: Record<string, unknown>) => VNode | VNode[]), attrs: Attrs, key?: unknown): VNode {
  const { children, ...rest } = attrs ?? {};
  const kids: unknown[] = Array.isArray(children) ? children : children !== undefined ? [children] : [];
  const node = h(type, rest as Record<string, unknown>, ...kids);
  if (key !== undefined) (node.props as Record<string, unknown>).key = key;
  return node;
}
export const jsxs = jsx;
export { Fragment } from './runtime.js';
