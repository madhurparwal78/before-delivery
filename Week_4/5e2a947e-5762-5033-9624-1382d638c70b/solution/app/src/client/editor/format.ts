import type { Derived, DocTopic, MapDoc } from '../../shared/model.ts';
import { plural } from '../../shared/rules.ts';
import { childrenIndex, floatingOf, lockOf, rootOf } from '../../shared/tree.ts';

export interface Place {
  level: number;
  pos: number;
  size: number;
}

export interface Counts {
  comments: Record<string, number>;
  votes: Record<string, number>;
  mine: Set<string>;
}

/** Level, position and set size of every topic in the whole tree as I can see it. */
export function computePlaces(doc: MapDoc): Map<string, Place> {
  const index = childrenIndex(doc.topics);
  const places = new Map<string, Place>();
  const root = rootOf(doc.topics);
  const floating = floatingOf(doc.topics);
  const top = [...(root ? [root] : []), ...floating];
  top.forEach((topic, at) => places.set(topic.id, { level: 1, pos: at + 1, size: top.length }));
  const walk = (topic: DocTopic, level: number): void => {
    const kids = index.get(topic.id) ?? [];
    kids.forEach((child, at) => {
      places.set(child.id, { level: level + 1, pos: at + 1, size: kids.length });
      walk(child, level + 1);
    });
  };
  for (const topic of top) walk(topic, 1);
  return places;
}

/** The published tree label grammar. */
export function topicLabel(doc: MapDoc, id: string, place: Place, derived: Derived | undefined, counts: Counts, collapsed: boolean): string {
  const topic = doc.topics[id];
  if (!topic) return '';
  const parts = [topic.title, `level ${place.level}`, `${place.pos} of ${place.size}`];
  if (derived && derived.subtopics > 0) parts.push(plural(derived.subtopics, 'subtopic', 'subtopics'));
  if (collapsed) parts.push('collapsed');
  const comments = counts.comments[id] ?? 0;
  if (comments > 0) parts.push(plural(comments, 'comment', 'comments'));
  const votes = counts.votes[id] ?? 0;
  if (votes > 0) parts.push(plural(votes, 'vote', 'votes'));
  if (derived && typeof derived.percent === 'number') parts.push(`${derived.percent}% done`);
  if (derived && derived.blocked_count > 0) parts.push(`${derived.blocked_count} blocked`);
  if (lockOf(doc.topics, id)) parts.push('locked');
  return parts.join(', ');
}
