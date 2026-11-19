import type { Layout } from '../../shared/layout.ts';
import type { DocTopic, LayoutMode, MapDoc, PublicOp } from '../../shared/model.ts';
import { byRank, childrenIndex } from '../../shared/tree.ts';

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

interface View {
  doc: MapDoc;
  layout: Layout;
  mode: LayoutMode;
  collapsed: ReadonlySet<string>;
}

interface ArrowResult {
  target: string | null;
  /** A collapsed topic the key opens for me, leaving focus where it is. */
  expand: string | null;
}

/** The published arrow rules for each layout and side. */
export function arrowTarget(view: View, from: string, key: ArrowKey): ArrowResult {
  const { doc, layout, mode, collapsed } = view;
  const topic = doc.topics[from];
  if (!topic) return { target: null, expand: null };
  const index = childrenIndex(doc.topics);
  const kids = index.get(topic.id) ?? [];
  const siblings = topic.parent_id !== null ? (index.get(topic.parent_id) ?? []) : [];
  const at = siblings.findIndex((s) => s.id === topic.id);
  const intoChildren = (): ArrowResult => {
    if (kids.length === 0) return { target: null, expand: null };
    if (collapsed.has(topic.id)) return { target: null, expand: topic.id };
    return { target: kids[0]?.id ?? null, expand: null };
  };
  const toParent = (): ArrowResult => ({ target: topic.parent_id, expand: null });
  const previous = (): ArrowResult => ({ target: at > 0 ? (siblings[at - 1]?.id ?? null) : null, expand: null });
  const next = (): ArrowResult => ({ target: at >= 0 ? (siblings[at + 1]?.id ?? null) : null, expand: null });

  if (mode === 'map') {
    const side = layout.boxes.get(topic.id)?.side ?? 'none';
    if (key === 'ArrowUp') return previous();
    if (key === 'ArrowDown') return next();
    if (side === 'none') {
      const isFloating = topic.floating;
      if (isFloating) return key === 'ArrowRight' ? intoChildren() : { target: null, expand: null };
      const wanted = key === 'ArrowRight' ? 'right' : 'left';
      const first = kids.find((child) => (layout.boxes.get(child.id)?.side ?? 'right') === wanted);
      return { target: first?.id ?? null, expand: null };
    }
    const towards = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
    return key === towards ? intoChildren() : toParent();
  }
  if (mode === 'org') {
    if (key === 'ArrowDown') return intoChildren();
    if (key === 'ArrowUp') return toParent();
    return key === 'ArrowLeft' ? previous() : next();
  }
  if (key === 'ArrowRight') return intoChildren();
  if (key === 'ArrowLeft') return toParent();
  const row = layout.order.indexOf(from);
  const step = key === 'ArrowDown' ? 1 : -1;
  return { target: row === -1 ? null : (layout.order[row + step] ?? null), expand: null };
}

/** Where focus lands after topics go: next sibling, else previous sibling, else the parent. */
export function focusAfterRemoval(doc: MapDoc, removed: DocTopic, gone: ReadonlySet<string>): string | null {
  const siblings = removed.parent_id ? (childrenIndex(doc.topics).get(removed.parent_id) ?? []) : [];
  const at = siblings.findIndex((s) => s.id === removed.id);
  const after = siblings.slice(at + 1).find((s) => !gone.has(s.id));
  const before = siblings.slice(0, Math.max(at, 0)).reverse().find((s) => !gone.has(s.id));
  return after?.id ?? before?.id ?? removed.parent_id;
}

interface MovePlan {
  ops: PublicOp[];
  /** A collapsed topic that receives the moved topics and opens for me. */
  expand: string | null;
}

type Direction = 'reorder-back' | 'reorder-forward' | 'into' | 'out';

const REORDER: Record<LayoutMode, readonly [ArrowKey, ArrowKey]> = {
  map: ['ArrowUp', 'ArrowDown'],
  list: ['ArrowUp', 'ArrowDown'],
  org: ['ArrowLeft', 'ArrowRight'],
};

function directionOf(mode: LayoutMode, side: 'left' | 'right' | 'none', key: ArrowKey): Direction | null {
  const [back, forward] = REORDER[mode];
  if (key === back) return 'reorder-back';
  if (key === forward) return 'reorder-forward';
  const into: ArrowKey = mode === 'org' ? 'ArrowDown' : mode === 'list' ? 'ArrowRight' : side === 'left' ? 'ArrowLeft' : 'ArrowRight';
  const out: ArrowKey = mode === 'org' ? 'ArrowUp' : mode === 'list' ? 'ArrowLeft' : side === 'left' ? 'ArrowRight' : 'ArrowLeft';
  if (key === into) return 'into';
  if (key === out) return 'out';
  return null;
}

/** The keyboard move for Alt+arrow, or null when the topics have no room to go that way. */
export function planMove(view: View, selected: readonly string[], key: ArrowKey, newOpId: () => string): MovePlan | null {
  const { doc, layout, mode } = view;
  const index = childrenIndex(doc.topics);
  const first = selected.map((id) => doc.topics[id]).filter((t): t is DocTopic => t !== undefined).sort(byRank)[0];
  if (!first || first.parent_id === null) return null;
  const parent = doc.topics[first.parent_id];
  if (!parent) return null;
  const chosen = new Set(selected);
  const siblings = index.get(parent.id) ?? [];
  const ordered = siblings.filter((s) => chosen.has(s.id));
  const side = layout.boxes.get(first.id)?.side ?? 'none';
  const direction = directionOf(mode, side, key);
  if (!direction) return null;
  const move = (id: string, parentId: string, after: string | null): PublicOp => ({ op_id: newOpId(), kind: 'move', topic_id: id, parent_id: parentId, after });
  const chain = (parentId: string, anchor: string | null): PublicOp[] =>
    ordered.map((topic, at) => move(topic.id, parentId, at === 0 ? anchor : (ordered[at - 1]?.id ?? null)));
  const firstAt = siblings.findIndex((s) => s.id === ordered[0]?.id);
  const lastAt = siblings.findIndex((s) => s.id === ordered[ordered.length - 1]?.id);

  switch (direction) {
    case 'reorder-back':
      if (firstAt <= 0) return null;
      return { ops: chain(parent.id, siblings[firstAt - 2]?.id ?? null), expand: null };
    case 'reorder-forward': {
      const after = siblings[lastAt + 1];
      return after ? { ops: chain(parent.id, after.id), expand: null } : null;
    }
    case 'into': {
      const previous = siblings.slice(0, firstAt).reverse().find((s) => !chosen.has(s.id));
      if (!previous) return null;
      const tail = (index.get(previous.id) ?? []).filter((c) => !chosen.has(c.id)).at(-1);
      return { ops: chain(previous.id, tail?.id ?? null), expand: view.collapsed.has(previous.id) ? previous.id : null };
    }
    case 'out': {
      if (parent.parent_id === null) {
        if (mode !== 'map' || parent.floating || side === 'none') return null;
        const pinned: 'left' | 'right' = side === 'right' ? 'left' : 'right';
        return { ops: ordered.map((t) => ({ op_id: newOpId(), kind: 'pin', topic_id: t.id, side: pinned })), expand: null };
      }
      return { ops: chain(parent.parent_id, parent.id), expand: null };
    }
  }
}
