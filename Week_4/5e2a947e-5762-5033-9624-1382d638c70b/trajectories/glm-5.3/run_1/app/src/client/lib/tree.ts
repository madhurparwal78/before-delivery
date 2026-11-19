import type { EditorStore } from './store.js';
import type { Topic, Operation, Layout } from '../../shared/types.js';
import { el } from './dom.js';

/**
 * The tree label grammar and the roving-focus keyboard model: every
 * key acts on the focused topic, whichever it is.
 */

export function treeLabel(store: EditorStore, t: Topic): string {
  const parts: string[] = [t.title];
  const layout = store.layout();
  const level = layout.levels.get(t.id) ?? 1;
  parts.push(`level ${level}`);
  const siblings = [...store.state.topics.values()].filter((x) => x.parent_id === t.parent_id && !x.floating).sort((a, b) => a.rank - b.rank);
  parts.push(`${siblings.findIndex((s) => s.id === t.id) + 1} of ${siblings.length}`);
  const subs = t.derived.subtopics;
  if (subs > 0) parts.push(`${subs} ${subs === 1 ? 'subtopic' : 'subtopics'}`);
  if (store.state.collapsed.has(t.id)) parts.push('collapsed');
  if (t.comment_count > 0) parts.push(`${t.comment_count} ${t.comment_count === 1 ? 'comment' : 'comments'}`);
  if (t.vote_count > 0) parts.push(`${t.vote_count} ${t.vote_count === 1 ? 'vote' : 'votes'}`);
  if (typeof t.derived.percent === 'number') parts.push(`${t.derived.percent}% done`);
  else if (t.derived.percent === 'dash') parts.push('— done');
  if (t.derived.blocked_count > 0) parts.push(`${t.derived.blocked_count} blocked`);
  if (t.locked_by || inheritedLock(store, t.id)) parts.push('locked');
  return parts.join(', ');
}

function inheritedLock(store: EditorStore, id: string): boolean {
  let cur: string | null = id;
  for (;;) {
    const t = store.state.topics.get(cur);
    if (!t) return false;
    if (t.locked_by) return true;
    cur = t.parent_id;
    if (cur === null) return false;
  }
}

export function visibleOrder(store: EditorStore): Topic[] {
  const out: Topic[] = [];
  const byParent = new Map<string, Topic[]>();
  for (const t of store.state.topics.values()) {
    const key = t.parent_id ?? '';
    const arr = byParent.get(key) ?? [];
    arr.push(t);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.rank - b.rank);
  const root = byParent.get('')?.find((t) => !t.floating);
  const floaters = byParent.get('')?.filter((t) => t.floating) ?? [];
  const walk = (t: Topic) => {
    if (store.state.collapsed.has(t.id)) { out.push(t); return; }
    out.push(t);
    for (const c of byParent.get(t.id) ?? []) walk(c);
  };
  if (root) walk(root);
  for (const f of floaters) walk(f);
  return out;
}

export function siblingsOf(store: EditorStore, id: string): Topic[] {
  const t = store.state.topics.get(id);
  if (!t) return [];
  return [...store.state.topics.values()].filter((x) => x.parent_id === t.parent_id).sort((a, b) => a.rank - b.rank);
}

export interface MoveResult {
  ops: Operation[];
  announcement?: string;
}

/** The published arrow navigation rules per layout and side. */
export function arrowTarget(store: EditorStore, fromId: string, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): string | null {
  const t = store.state.topics.get(fromId);
  if (!t) return null;
  const layout = store.state.map.layout as Layout;
  const siblings = siblingsOf(store, fromId);
  const idx = siblings.findIndex((s) => s.id === fromId);
  const children = [...store.state.topics.values()].filter((x) => x.parent_id === fromId).sort((a, b) => a.rank - b.rank);
  const parent = t.parent_id ? store.state.topics.get(t.parent_id) : null;
  const side = sideOf(store, fromId);
  if (layout === 'map') {
    if (t.parent_id === null && !t.floating) {
      const right = siblings.filter((s) => s.id !== t.id && sideOf(store, s.id) === 'right')[0] ?? null;
      const left = siblings.filter((s) => s.id !== t.id && sideOf(store, s.id) === 'left')[0] ?? null;
      if (key === 'ArrowRight') return right?.id ?? null;
      if (key === 'ArrowLeft') return left?.id ?? null;
      return null;
    }
    const childSide = side;
    if (key === 'ArrowRight' && childSide === 'right') return children[0]?.id ?? null;
    if (key === 'ArrowLeft' && childSide === 'left') return children[0]?.id ?? null;
    if (key === 'ArrowRight' && childSide === 'left') return parent?.id ?? null;
    if (key === 'ArrowLeft' && childSide === 'right') return parent?.id ?? null;
    if (key === 'ArrowUp') return idx > 0 ? siblings[idx - 1].id : null;
    if (key === 'ArrowDown') return idx < siblings.length - 1 ? siblings[idx + 1].id : null;
    return null;
  }
  if (layout === 'org') {
    if (key === 'ArrowDown') return children[0]?.id ?? null;
    if (key === 'ArrowUp') return parent?.id ?? null;
    if (key === 'ArrowLeft') return idx > 0 ? siblings[idx - 1].id : null;
    if (key === 'ArrowRight') return idx < siblings.length - 1 ? siblings[idx + 1].id : null;
    return null;
  }
  // list and outline
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const order = visibleOrder(store);
    const at = order.findIndex((x) => x.id === fromId);
    const next = key === 'ArrowDown' ? order[at + 1] : order[at - 1];
    return next?.id ?? null;
  }
  if (key === 'ArrowRight') return children[0]?.id ?? null;
  if (key === 'ArrowLeft') return parent?.id ?? null;
  return null;
}

function sideOf(store: EditorStore, id: string): 'right' | 'left' {
  const layout = store.layout();
  return layout.sides.get(id) === 'left' ? 'left' : 'right';
}

/** The published Alt+arrow move rules. */
export function moveOps(store: EditorStore, fromId: string, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', selection: Set<string>): { ops: Operation[]; announcement: string | null } {
  const ids = selection.size > 0 ? [...selection] : [fromId];
  const ops: Operation[] = [];
  const layout = store.state.map.layout as Layout;
  for (const id of ids) {
    const t = store.state.topics.get(id);
    if (!t || t.floating) continue;
    const siblings = siblingsOf(store, id);
    const idx = siblings.findIndex((s) => s.id === id);
    const parent = t.parent_id ? store.state.topics.get(t.parent_id) : null;
    const prevSibling = idx > 0 ? siblings[idx - 1] : null;
    const nextSibling = idx < siblings.length - 1 ? siblings[idx + 1] : null;
    const side = sideOf(store, id);
    const level = store.layout().levels.get(id) ?? 1;
    let announcement: string | null = null;
    const toward = (layout === 'map' ? (side === 'right' ? 'ArrowRight' : 'ArrowLeft') : layout === 'org' ? 'ArrowDown' : 'ArrowRight');
    const away = (layout === 'map' ? (side === 'right' ? 'ArrowLeft' : 'ArrowRight') : layout === 'org' ? 'ArrowUp' : 'ArrowLeft');
    if (layout !== 'org' && (key === 'ArrowUp' || key === 'ArrowDown')) {
      // reorder
      if (key === 'ArrowUp') {
        if (!prevSibling) { announcement = `${t.title} can't move that way.`; return { ops: [], announcement }; }
        ops.push({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: t.parent_id, after: idx >= 2 ? siblings[idx - 2].id : null });
      } else {
        if (!nextSibling) { announcement = `${t.title} can't move that way.`; return { ops: [], announcement }; }
        ops.push({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: t.parent_id, after: nextSibling.id });
      }
    } else if (layout === 'org' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      if (key === 'ArrowLeft') {
        if (!prevSibling) { announcement = `${t.title} can't move that way.`; return { ops: [], announcement }; }
        ops.push({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: t.parent_id, after: idx >= 2 ? siblings[idx - 2].id : null });
      } else {
        if (!nextSibling) { announcement = `${t.title} can't move that way.`; return { ops: [], announcement }; }
        ops.push({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: t.parent_id, after: nextSibling.id });
      }
    } else if (key === toward) {
      if (!prevSibling) { announcement = `${t.title} can't move that way.`; return { ops: [], announcement }; }
      ops.push({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: prevSibling.id, after: null });
      if (store.state.collapsed.has(prevSibling.id)) {
        void store.send([]); // handled by caller; collapse changes are private
      }
    } else if (key === away) {
      if (layout === 'map' && level === 2) {
        const newSide = side === 'right' ? 'left' : 'right';
        ops.push({ op_id: newOpId(), kind: 'pin', topic_id: id, side: newSide });
      } else if (!parent) {
        const root = [...store.state.topics.values()].find((x) => x.parent_id === null && !x.floating);
        if (root) ops.push({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: root.id, after: null });
      } else {
        const parentSiblings = siblingsOf(store, parent.id);
        const pIdx = parentSiblings.findIndex((s) => s.id === parent.id);
        ops.push({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: parent.parent_id, after: parent.id });
        void pIdx;
      }
    }
  }
  return { ops, announcement: ops.length > 0 ? null : `${store.state.topics.get(ids[0])?.title ?? ''} can't move that way.` };
}

let opCounter = 0;
export function newOpId(): string {
  opCounter += 1;
  return `o-${crypto.randomUUID()}`;
}

/** The published delete focus rule. */
export function focusAfterDelete(store: EditorStore, id: string): string | null {
  const t = store.state.topics.get(id);
  if (!t) return null;
  const siblings = siblingsOf(store, id);
  const idx = siblings.findIndex((s) => s.id === id);
  if (idx < siblings.length - 1) return siblings[idx + 1].id;
  if (idx > 0) return siblings[idx - 1].id;
  return t.parent_id;
}

export function homeTarget(store: EditorStore): string | null {
  return [...store.state.topics.values()].find((t) => t.parent_id === null && !t.floating)?.id ?? null;
}

export function endTarget(store: EditorStore): string | null {
  const order = visibleOrder(store);
  return order[order.length - 1]?.id ?? null;
}

export function makeTreeItem(store: EditorStore, t: Topic, posInSet: number, setSize: number): HTMLElement {
  const item = el('div', {
    role: 'treeitem', 'aria-level': String(store.layout().levels.get(t.id) ?? 1),
    'aria-posinset': String(posInSet), 'aria-setsize': String(setSize),
    'data-topic-id': t.id, tabindex: '-1',
  });
  item.textContent = treeLabel(store, t);
  const kids = [...store.state.topics.values()].filter((x) => x.parent_id === t.id);
  if (kids.length > 0) item.setAttribute('aria-expanded', store.state.collapsed.has(t.id) ? 'false' : 'true');
  return item;
}
