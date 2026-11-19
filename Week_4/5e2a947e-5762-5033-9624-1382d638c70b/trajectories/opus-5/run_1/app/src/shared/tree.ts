import type { MapDoc, StoredTopic } from './types.js';

export interface MapView {
  doc: MapDoc;
  /** Topic ids the viewer has collapsed. */
  collapsed: ReadonlySet<string>;
  /** Topic ids hidden from the viewer by a restriction. */
  hidden: ReadonlySet<string>;
}

export function topic(doc: MapDoc, id: string): StoredTopic | undefined {
  return doc.topics[id];
}

export function siblingList(doc: MapDoc, id: string): string[] {
  const t = doc.topics[id];
  if (!t) return [];
  if (t.parent_id === null) return t.floating ? doc.floating : [doc.root];
  const parent = doc.topics[t.parent_id];
  return parent ? parent.children : [];
}

export function descendants(doc: MapDoc, id: string): string[] {
  const out: string[] = [];
  const stack = [...(doc.topics[id]?.children ?? [])];
  while (stack.length > 0) {
    const next = stack.shift() as string;
    out.push(next);
    const t = doc.topics[next];
    if (t) stack.unshift(...t.children);
  }
  return out;
}

export function branchIds(doc: MapDoc, id: string): string[] {
  return doc.topics[id] ? [id, ...descendants(doc, id)] : [];
}

export function isAncestor(doc: MapDoc, ancestor: string, node: string): boolean {
  let current = doc.topics[node]?.parent_id ?? null;
  while (current !== null) {
    if (current === ancestor) return true;
    current = doc.topics[current]?.parent_id ?? null;
  }
  return false;
}

export function ancestors(doc: MapDoc, id: string): string[] {
  const out: string[] = [];
  let current = doc.topics[id]?.parent_id ?? null;
  while (current !== null) {
    out.push(current);
    current = doc.topics[current]?.parent_id ?? null;
  }
  return out;
}

export function levelOf(doc: MapDoc, id: string): number {
  const t = doc.topics[id];
  if (!t) return 1;
  if (t.floating) return 1;
  return ancestors(doc, id).length + 1;
}

/** The level 2 ancestor of a topic, or the topic itself when it is level 2. */
export function branchRoot(doc: MapDoc, id: string): string | null {
  const t = doc.topics[id];
  if (!t || t.floating) return null;
  let current: string = id;
  while (true) {
    const node = doc.topics[current];
    if (!node || node.parent_id === null) return null;
    if (node.parent_id === doc.root) return current;
    current = node.parent_id;
  }
}

/** Topics hidden from a viewer who may not see restricted branches. */
export function hiddenSet(doc: MapDoc, canSeeRestricted: boolean): Set<string> {
  const hidden = new Set<string>();
  if (canSeeRestricted) return hidden;
  for (const t of Object.values(doc.topics)) {
    if (t.restricted) for (const id of branchIds(doc, t.id)) hidden.add(id);
  }
  return hidden;
}

export function allTopicsDepthFirst(doc: MapDoc): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    const t = doc.topics[id];
    if (!t) return;
    out.push(id);
    for (const child of t.children) walk(child);
  };
  walk(doc.root);
  for (const id of doc.floating) walk(id);
  return out;
}

export function visibleChildren(view: MapView, id: string): string[] {
  if (view.collapsed.has(id)) return [];
  const t = view.doc.topics[id];
  if (!t) return [];
  return t.children.filter((child) => !view.hidden.has(child));
}

/** Children a viewer may see, ignoring their own collapse state. */
export function permittedChildren(view: MapView, id: string): string[] {
  const t = view.doc.topics[id];
  if (!t) return [];
  return t.children.filter((child) => !view.hidden.has(child));
}

export function roots(view: MapView): string[] {
  const out: string[] = [];
  if (!view.hidden.has(view.doc.root)) out.push(view.doc.root);
  for (const id of view.doc.floating) if (!view.hidden.has(id)) out.push(id);
  return out;
}

/** Visible topics in depth-first order: the main tree then the floating topics. */
export function visibleTopics(view: MapView): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    out.push(id);
    for (const child of visibleChildren(view, id)) walk(child);
  };
  for (const id of roots(view)) walk(id);
  return out;
}

export function isVisible(view: MapView, id: string): boolean {
  if (!view.doc.topics[id] || view.hidden.has(id)) return false;
  for (const a of ancestors(view.doc, id)) {
    if (view.collapsed.has(a) || view.hidden.has(a)) return false;
  }
  return true;
}

export function nearestVisibleAncestor(view: MapView, id: string): string | null {
  if (isVisible(view, id)) return id;
  for (const a of ancestors(view.doc, id)) {
    if (isVisible(view, a)) return a;
  }
  return null;
}

/** Descendants a viewer may see, whether collapsed or not. */
export function permittedDescendantCount(view: MapView, id: string): number {
  let count = 0;
  const stack = [...permittedChildren(view, id)];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    count += 1;
    stack.push(...permittedChildren(view, next));
  }
  return count;
}

export interface LockInfo {
  by: string | null;
  inherited: boolean;
}

export function lockInfo(doc: MapDoc, id: string): LockInfo {
  const t = doc.topics[id];
  if (!t) return { by: null, inherited: false };
  if (t.locked_by) return { by: t.locked_by, inherited: false };
  for (const a of ancestors(doc, id)) {
    const owner = doc.topics[a]?.locked_by;
    if (owner) return { by: owner, inherited: true };
  }
  return { by: null, inherited: false };
}
