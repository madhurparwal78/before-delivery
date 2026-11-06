import type { VNode } from './runtime.js';

type MaybeEffects = { effects?: { oncreate?: (el: Element) => void } };

// Renders a virtual tree into a container, patching the previous tree in place.
export function render(container: Element, node: VNode | null): void {
  patch(container, node, trees.get(container) ?? null, container.firstChild as Element | Text | null);
  trees.set(container, node);
}
const trees = new WeakMap<Element, VNode | null>();

// Patches `node` over `old` where `existing` is the DOM node for `old`.
// Returns the DOM node that now represents `node`.
function patch(parent: Node, node: VNode | null, old: VNode | null, existing: Element | Text | null): Element | Text | null {
  if (old && !same(old, node)) { if (existing) parent.removeChild(existing); old = null; existing = null; }
  if (!node) { if (existing) parent.removeChild(existing); return null; }
  if (node.type === '#text') {
    if (existing && existing.nodeType === 3) {
      if (existing.textContent !== String(node.props.value)) existing.textContent = String(node.props.value);
      return existing;
    }
    const t = document.createTextNode(String(node.props.value));
    if (existing) parent.replaceChild(t, existing); else parent.appendChild(t);
    return t;
  }
  if (typeof node.type === 'function') {
    const out = (node.type as (p: Record<string, unknown>) => VNode | VNode[])(node.props);
    const child = Array.isArray(out) ? out[0] ?? null : out;
    const oldChild = old && typeof old.type === 'function' ? old : null;
    return patch(parent, child, oldChild, existing);
  }
  const tagName = node.type;
  let el: Element | null = existing && existing.nodeType === 1 && (existing as Element).nodeName.toLowerCase() === tagName ? (existing as Element) : null;
  if (!el) {
    if (existing) parent.removeChild(existing);
    el = document.createElement(tagName);
    parent.appendChild(el);
    for (const [k, v] of Object.entries(node.props)) applyAttr(el, k, v);
    const fx = (node.props as MaybeEffects).effects;
    if (fx?.oncreate) fx.oncreate(el);
  } else {
    diffAttrs(el, node, old);
  }
  reconcile(el, node.children, old && typeof old.type !== 'function' ? old.children : []);
  return el;
}

function same(a: VNode | null, b: VNode | null): boolean {
  if (!a || !b) return false;
  if (a.type === '#text' && b.type === '#text') return true;
  return a.type === b.type;
}

// Keyed reconciliation: children carrying a `key` prop match across renders by
// key; other children match by position. DOM nodes are moved into the new order.
function reconcile(el: Element, kids: VNode[], oldKids: VNode[]): void {
  const typedEl = el as Element;
  const doms: (Element | Text)[] = Array.from(el.childNodes) as (Element | Text)[];
  const keyToOld = new Map<unknown, VNode>();
  oldKids.forEach(o => { const k = (o.props as Record<string, unknown>).key; if (k !== undefined) keyToOld.set(k, o); });
  const domFor = new Map<VNode, Element | Text>();
  oldKids.forEach((o, i) => domFor.set(o, doms[i] ?? null));

  type Pair = { k: VNode; o: VNode | null; d: Element | Text | null };
  const pairs: Pair[] = [];
  const assigned = new Set<Element | Text>();
  let unkeyedIdx = 0;
  for (const k of kids) {
    const key = (k.props as Record<string, unknown>).key;
    if (key !== undefined && keyToOld.has(key)) {
      const o = keyToOld.get(key)!;
      const d = domFor.get(o) ?? null;
      if (d) assigned.add(d);
      keyToOld.delete(key);
      pairs.push({ k, o, d });
    } else {
      while (unkeyedIdx < oldKids.length && assigned.has(doms[unkeyedIdx])) unkeyedIdx++;
      const o = oldKids[unkeyedIdx] ?? null;
      const d = doms[unkeyedIdx] ?? null;
      if (d) assigned.add(d);
      if (unkeyedIdx < oldKids.length) unkeyedIdx++;
      pairs.push({ k, o, d });
    }
  }
  for (const d of doms) if (!assigned.has(d)) el.removeChild(d);

  let ref: ChildNode | null = null;
  for (const p of pairs) {
    const placed = patch(typedEl, p.k, p.o, p.d);
    if (!placed) continue;
    const expected: ChildNode | null = ref ? ref.nextSibling : typedEl.firstChild;
    if (placed !== expected) typedEl.insertBefore(placed, expected);
    ref = placed as ChildNode;
  }
}

function diffAttrs(el: Element, node: VNode, old: VNode | null): void {
  const oldProps = old?.props ?? {};
  for (const [k, v] of Object.entries(node.props)) {
    if (oldProps[k] !== v) applyAttr(el, k, v);
  }
  for (const k of Object.keys(oldProps)) {
    if (!(k in node.props)) applyAttr(el, k, undefined);
  }
}

export function applyAttr(el: Element, k: string, v: unknown): void {
  if (k === 'key' || k === 'effects' || k === 'children') return;
  if (k.startsWith('on') && k.length > 2 && typeof v === 'function') {
    (el as unknown as Record<string, unknown>)['on' + k.slice(2).toLowerCase()] = v;
    return;
  }
  if (k === 'value') { (el as unknown as Record<string, unknown>).value = v ?? ''; return; }
  if (k === 'checked') { (el as HTMLInputElement).checked = Boolean(v); return; }
  if (k === 'selected') { (el as HTMLOptionElement).selected = Boolean(v); return; }
  if (k === 'dangerouslySetInnerHTML') { el.innerHTML = String(v); return; }
  if (v === undefined || v === null || v === false) { el.removeAttribute(k); return; }
  if (v === true) { el.setAttribute(k, ''); return; }
  el.setAttribute(k, String(v));
}
