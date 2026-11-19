import type { DocTopic, MapDoc } from './model.ts';

export type Topics = Record<string, DocTopic>;

/** A topic table with no prototype, so an id such as `constructor` is only ever an id. */
export const newTopics = (): Topics => Object.create(null) as Topics;

export const byRank = (a: DocTopic, b: DocTopic): number => a.rank - b.rank || a.n - b.n;

export function rootOf(topics: Topics): DocTopic | undefined {
  return Object.values(topics).find((t) => t.parent_id === null && !t.floating);
}

export function floatingOf(topics: Topics): DocTopic[] {
  return Object.values(topics)
    .filter((t) => t.floating)
    .sort((a, b) => a.n - b.n);
}

/** Children of every topic in sibling order. */
export function childrenIndex(topics: Topics): Map<string, DocTopic[]> {
  const index = new Map<string, DocTopic[]>();
  for (const topic of Object.values(topics)) {
    if (topic.parent_id === null) continue;
    const list = index.get(topic.parent_id);
    if (list) list.push(topic);
    else index.set(topic.parent_id, [topic]);
  }
  for (const list of index.values()) list.sort(byRank);
  return index;
}

export function childrenOf(topics: Topics, id: string): DocTopic[] {
  return Object.values(topics)
    .filter((t) => t.parent_id === id)
    .sort(byRank);
}

export function ancestorsOf(topics: Topics, id: string): DocTopic[] {
  const out: DocTopic[] = [];
  let cursor = topics[id]?.parent_id ?? null;
  while (cursor !== null) {
    const topic = topics[cursor];
    if (!topic) break;
    out.push(topic);
    cursor = topic.parent_id;
  }
  return out;
}

/** The topic and everything below it, parents before children, in sibling order. */
export function branchOf(topics: Topics, id: string, index = childrenIndex(topics)): DocTopic[] {
  const start = topics[id];
  if (!start) return [];
  const out: DocTopic[] = [];
  const walk = (topic: DocTopic): void => {
    out.push(topic);
    for (const child of index.get(topic.id) ?? []) walk(child);
  };
  walk(start);
  return out;
}

export function isWithin(topics: Topics, id: string, ancestor: string): boolean {
  if (id === ancestor) return true;
  return ancestorsOf(topics, id).some((a) => a.id === ancestor);
}

/** Depth-first order of the whole tree: the root's branch, then each floating topic's branch in creation order. */
export function depthFirst(topics: Topics, index = childrenIndex(topics)): DocTopic[] {
  const root = rootOf(topics);
  const out: DocTopic[] = root ? branchOf(topics, root.id, index) : [];
  for (const floating of floatingOf(topics)) out.push(...branchOf(topics, floating.id, index));
  return out;
}

/** The lock covering a topic: its own or its nearest ancestor's. */
export function lockOf(topics: Topics, id: string): { holder: string; topic: DocTopic; inherited: boolean } | null {
  const own = topics[id];
  if (!own) return null;
  if (own.locked_by) return { holder: own.locked_by, topic: own, inherited: false };
  for (const ancestor of ancestorsOf(topics, id)) {
    if (ancestor.locked_by) return { holder: ancestor.locked_by, topic: ancestor, inherited: true };
  }
  return null;
}

/** True when the topic or one of its ancestors is restricted. */
export function isRestricted(topics: Topics, id: string): boolean {
  const own = topics[id];
  if (!own) return false;
  return own.restricted || ancestorsOf(topics, id).some((a) => a.restricted);
}

/** The document without restricted branches, as commenters, viewers, guests and the audience see it. */
export function withoutRestricted(doc: MapDoc): MapDoc {
  const hidden = new Set(Object.keys(doc.topics).filter((id) => isRestricted(doc.topics, id)));
  if (hidden.size === 0) return doc;
  const topics = newTopics();
  for (const [id, topic] of Object.entries(doc.topics)) if (!hidden.has(id)) topics[id] = topic;
  return {
    ...doc,
    topics,
    links: doc.links.filter((l) => !hidden.has(l.from) && !hidden.has(l.to)),
    boundaries: doc.boundaries.filter((b) => !hidden.has(b.topic_id)),
  };
}

/** Place `moving` right after `after` (or first when null) among the children of `parentId`, renumbering ranks. */
export function placeAmong(topics: Topics, parentId: string, moving: DocTopic, after: string | null | 'last'): void {
  const siblings = childrenOf(topics, parentId).filter((t) => t.id !== moving.id);
  let at = siblings.length;
  if (after === null) at = 0;
  else if (after !== 'last') at = siblings.findIndex((t) => t.id === after) + 1;
  siblings.splice(at, 0, moving);
  siblings.forEach((t, i) => {
    t.rank = i;
  });
}
