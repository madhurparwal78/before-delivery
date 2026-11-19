import type pg from 'pg';
import { emptyDoc, newTopic } from '../shared/engine.ts';
import type { DocTopic, Link, MapDoc, Op, OpsResponse, Role } from '../shared/model.ts';
import type { OutlineNode } from '../shared/outline.ts';
import { ancestorsOf, branchOf, childrenIndex, childrenOf, depthFirst } from '../shared/tree.ts';
import { Effects, commitGroup, type Origin } from './groups.ts';
import type { Principal } from './http.ts';
import { operationId, randomId } from './ids.ts';
import type { MapRow } from './mapStore.ts';
import { roleHolders } from './members.ts';

/** Topics and links that become part of a map through one `put_branch` operation. */
export interface Placement {
  topics: DocTopic[];
  links: Link[];
}

/** What a person copied: whole branches as they saw them, and the cross-links with both ends inside. */
export interface Clip {
  map_id: string;
  topics: DocTopic[];
  links: Link[];
}

/** A topic the engine has not numbered yet: `n` below zero makes the engine assign the next creation number. */
const blank = (id: string, parentId: string, rank: number, title: string): DocTopic => ({
  ...newTopic(emptyDoc(), id, parentId, title),
  rank,
  n: -1,
});

/** The rank that puts a new child after every existing child of the parent. */
export const nextRank = (doc: MapDoc, parentId: string): number => (childrenOf(doc.topics, parentId).at(-1)?.rank ?? -1) + 1;

/** New topics for every top-level outline line, in order, with their descendants. Floating positions are ignored. */
export function outlineBranches(nodes: readonly OutlineNode[], parentId: string, firstRank: number): Placement {
  const topics: DocTopic[] = [];
  const add = (siblings: readonly OutlineNode[], parent: string, first: number): void => {
    siblings.forEach((node, at) => {
      const topic: DocTopic = { ...blank(randomId(), parent, first + at, node.title), note: node.note, icon: node.icon, colour: node.colour, task: node.task };
      topics.push(topic);
      add(node.children, topic.id, 0);
    });
  };
  add(nodes, parentId, firstRank);
  return { topics, links: [] };
}

/** The selected branches of a document, each topic once, in tree order. Nested selections ride with their ancestor. */
export function clipOf(doc: MapDoc, mapId: string, selected: readonly string[]): Clip {
  const chosen = new Set(selected);
  const index = childrenIndex(doc.topics);
  const tops = depthFirst(doc.topics, index).filter((t) => chosen.has(t.id) && !ancestorsOf(doc.topics, t.id).some((a) => chosen.has(a.id)));
  const topics = tops.flatMap((top) => branchOf(doc.topics, top.id, index)).map((t) => structuredClone(t));
  const inside = new Set(topics.map((t) => t.id));
  return { map_id: mapId, topics, links: doc.links.filter((l) => inside.has(l.from) && inside.has(l.to)) };
}

/** Fresh copies of a clip as last children of the parent: new ids, no locks, new attachment ids, links between copies only. */
export function clipBranches(clip: Clip, parentId: string, firstRank: number): Placement {
  const ids = new Map(clip.topics.map((t) => [t.id, randomId()]));
  const idOf = (old: string): string => ids.get(old) ?? old;
  const nextAmong = new Map<string, number>([[parentId, firstRank]]);
  const topics = clip.topics.map((source): DocTopic => {
    const parent = source.parent_id !== null && ids.has(source.parent_id) ? idOf(source.parent_id) : parentId;
    const rank = nextAmong.get(parent) ?? 0;
    nextAmong.set(parent, rank + 1);
    return {
      ...structuredClone(source),
      id: idOf(source.id),
      parent_id: parent,
      rank,
      floating: false,
      x: null,
      y: null,
      locked_by: null,
      attachments: source.attachments.map((a) => ({ ...a, id: randomId() })),
      n: -1,
    };
  });
  const links = clip.links.flatMap((l): Link[] => (ids.has(l.from) && ids.has(l.to) ? [{ ...l, id: randomId(), from: idOf(l.from), to: idOf(l.to) }] : []));
  return { topics, links };
}

interface BranchCommit {
  client: pg.PoolClient;
  map: MapRow;
  principal: Principal;
  role: Role;
  fx: Effects;
  origin: Extract<Origin, 'edit' | 'graft' | 'paste'>;
  groupId: string;
  base: number;
  placement: Placement;
  sentence: string;
}

/** Commit topics and links as one group holding a single internal `put_branch` operation. */
export async function commitBranch(commit: BranchCommit): Promise<OpsResponse> {
  const op: Op = {
    op_id: operationId(),
    kind: 'put_branch',
    branch: { topics: commit.placement.topics, links: commit.placement.links, boundaries: [], ancestors: [] },
  };
  const committed = await commitGroup({
    client: commit.client,
    map: commit.map,
    principal: commit.principal,
    role: commit.role,
    groupId: commit.groupId,
    base: commit.base,
    ops: [op],
    origin: commit.origin,
    fx: commit.fx,
    sentence: commit.sentence,
    roleHolders: await roleHolders(commit.client, commit.map),
  });
  return committed.response;
}
