import { isDeepStrictEqual } from 'node:util';
import type { DocTopic, MapDoc, Op } from '../shared/model.ts';
import { docOfSnapshot, type Snapshot } from '../shared/snapshot.ts';
import { branchOf, childrenIndex, childrenOf, depthFirst } from '../shared/tree.ts';
import { operationId } from './ids.ts';

/** The stored fields a restore brings back. Locks and restrictions are not part of it. */
const RESTORED = ['parent_id', 'floating', 'x', 'y', 'title', 'note', 'icon', 'colour', 'shape', 'side_pin', 'task', 'attachments'] as const;

const differs = (now: DocTopic, want: DocTopic): boolean => RESTORED.some((field) => !isDeepStrictEqual(now[field], want[field]));

const isMapRoot = (topic: DocTopic): boolean => topic.parent_id === null && !topic.floating;

/**
 * Topics to write back whole: the missing and changed ones, those a delete takes along, and every sibling whose rank
 * has to move with them.
 */
function topicsToWrite(now: MapDoc, want: MapDoc, deleted: ReadonlySet<string>): Set<string> {
  const write = new Set(
    Object.values(want.topics)
      .filter((topic) => {
        const kept = now.topics[topic.id];
        return !isMapRoot(topic) && (!kept || deleted.has(topic.id) || differs(kept, topic));
      })
      .map((topic) => topic.id),
  );
  for (const [parentId, wanted] of childrenIndex(want.topics)) {
    const present = childrenOf(now.topics, parentId)
      .filter((child) => want.topics[child.id])
      .map((child) => child.id);
    if (wanted.some((topic) => write.has(topic.id)) || !isDeepStrictEqual(present, wanted.map((topic) => topic.id))) {
      for (const topic of wanted) write.add(topic.id);
    }
  }
  return write;
}

/** The central topic cannot be written back whole, so its fields go through the ordinary operations. */
function rootOps(now: DocTopic, want: DocTopic): Op[] {
  const ops: Op[] = [];
  if (now.title !== want.title) {
    ops.push({ op_id: operationId(), kind: 'title', topic_id: now.id, offset: 0, delete: Array.from(now.title).length, insert: want.title });
  }
  if (now.note !== want.note) ops.push({ op_id: operationId(), kind: 'note', topic_id: now.id, text: want.note });
  if (!isDeepStrictEqual(now.task, want.task)) ops.push({ op_id: operationId(), kind: 'task', topic_id: now.id, task: want.task });
  if (now.colour !== want.colour || now.shape !== want.shape || now.icon !== want.icon) {
    ops.push({ op_id: operationId(), kind: 'style', topic_id: now.id, colour: want.colour, shape: want.shape, icon: want.icon });
  }
  return ops;
}

/** Keep the leading items both lists share; drop the rest of `now` and add the rest of `want`, so the list ends in `want`'s order. */
function withoutDivergence<T>(now: readonly T[], want: readonly T[]): { drop: T[]; add: T[] } {
  let shared = 0;
  while (shared < now.length && shared < want.length && isDeepStrictEqual(now[shared], want[shared])) shared += 1;
  return { drop: now.slice(shared), add: want.slice(shared) };
}

/** The operations that make a map's topics, links, boundaries, slides, layout and theme equal a snapshot. */
export function restoreOps(now: MapDoc, snapshot: Snapshot): Op[] {
  const want = docOfSnapshot(snapshot);
  const ops: Op[] = [];

  const gone = Object.values(now.topics).filter((topic) => !want.topics[topic.id]);
  const index = childrenIndex(now.topics);
  const deleting = gone.filter((topic) => topic.parent_id === null || want.topics[topic.parent_id]);
  for (const topic of deleting) ops.push({ op_id: operationId(), kind: 'delete', topic_id: topic.id });
  const deleted = new Set(deleting.flatMap((topic) => branchOf(now.topics, topic.id, index)).map((topic) => topic.id));

  const write = topicsToWrite(now, want, deleted);
  if (write.size > 0) {
    const topics = depthFirst(want.topics)
      .filter((topic) => write.has(topic.id))
      .map((topic): DocTopic => {
        const kept = now.topics[topic.id];
        return kept ? { ...topic, locked_by: kept.locked_by, restricted: kept.restricted } : topic;
      });
    ops.push({ op_id: operationId(), kind: 'put_branch', branch: { topics, links: [], boundaries: [], ancestors: [] } });
  }

  const links = withoutDivergence(
    now.links.filter((link) => !deleted.has(link.from) && !deleted.has(link.to)),
    snapshot.links,
  );
  for (const link of links.drop) ops.push({ op_id: operationId(), kind: 'link_remove', link_id: link.id });
  for (const link of links.add) {
    ops.push({ op_id: operationId(), kind: 'link_add', link_id: link.id, from: link.from, to: link.to, label: link.label, type: link.type });
  }
  const boundaries = withoutDivergence(
    now.boundaries.filter((boundary) => !deleted.has(boundary.topic_id)),
    snapshot.boundaries,
  );
  for (const boundary of boundaries.drop) ops.push({ op_id: operationId(), kind: 'boundary_remove', boundary_id: boundary.id });
  for (const boundary of boundaries.add) {
    ops.push({ op_id: operationId(), kind: 'boundary_add', boundary_id: boundary.id, topic_id: boundary.topic_id, label: boundary.label });
  }

  const root = Object.values(want.topics).find(isMapRoot);
  const current = root && now.topics[root.id];
  if (root && current) ops.push(...rootOps(current, root));
  if (now.layout !== want.layout) ops.push({ op_id: operationId(), kind: 'layout', layout: want.layout });
  if (now.theme !== want.theme) ops.push({ op_id: operationId(), kind: 'theme', theme: want.theme });
  if (!isDeepStrictEqual(now.slides, want.slides)) ops.push({ op_id: operationId(), kind: 'slides', order: want.slides });
  return ops;
}
