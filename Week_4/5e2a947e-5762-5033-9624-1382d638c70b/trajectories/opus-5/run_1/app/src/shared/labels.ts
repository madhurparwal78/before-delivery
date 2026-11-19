import { levelOf, lockInfo, permittedChildren, type MapView } from './tree.js';
import type { DerivedTopic } from './types.js';

export interface TopicCounts {
  comments: number;
  votes: number;
}

export interface TopicAria {
  level: number;
  posinset: number;
  setsize: number;
  expanded: boolean | null;
  label: string;
}

/** Position and set size among the siblings a viewer may see. */
export function siblingPlace(view: MapView, id: string): { pos: number; size: number } {
  const doc = view.doc;
  const t = doc.topics[id];
  if (!t) return { pos: 1, size: 1 };
  if (t.parent_id === null) {
    const level1 = [doc.root, ...doc.floating].filter((each) => !view.hidden.has(each));
    return { pos: level1.indexOf(id) + 1, size: level1.length };
  }
  const siblings = permittedChildren(view, t.parent_id);
  return { pos: siblings.indexOf(id) + 1, size: siblings.length };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The published tree label grammar. */
export function topicLabel(
  view: MapView,
  id: string,
  derived: DerivedTopic,
  counts: TopicCounts,
): string {
  const doc = view.doc;
  const t = doc.topics[id];
  if (!t) return '';
  const place = siblingPlace(view, id);
  const parts: string[] = [t.title];
  parts.push(`level ${levelOf(doc, id)}`);
  parts.push(`${place.pos} of ${place.size}`);
  if (derived.subtopics > 0) parts.push(count(derived.subtopics, 'subtopic', 'subtopics'));
  if (view.collapsed.has(id)) parts.push('collapsed');
  if (counts.comments > 0) parts.push(count(counts.comments, 'comment', 'comments'));
  if (counts.votes > 0) parts.push(count(counts.votes, 'vote', 'votes'));
  if (typeof derived.percent === 'number') parts.push(`${derived.percent}% done`);
  if (derived.blocked_count > 0) parts.push(`${derived.blocked_count} blocked`);
  if (lockInfo(doc, id).by !== null) parts.push('locked');
  return parts.join(', ');
}

export function topicAria(
  view: MapView,
  id: string,
  derived: DerivedTopic,
  counts: TopicCounts,
): TopicAria {
  const place = siblingPlace(view, id);
  const children = permittedChildren(view, id);
  return {
    level: levelOf(view.doc, id),
    posinset: place.pos,
    setsize: place.size,
    expanded: children.length > 0 ? !view.collapsed.has(id) : null,
    label: topicLabel(view, id, derived, counts),
  };
}
