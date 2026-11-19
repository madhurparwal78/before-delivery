import { rows, type Db } from '../db.js';
import { notBlockedWith } from './visibility.js';

/** The viewer's degree to another member. `self` is the viewer. */
export type Degree = '1' | '2' | '3' | 'out' | 'self';

export interface MemberRef {
  id: string;
  name: string;
  handle: string;
}

type PathStep = MemberRef | { private: true };

/** Members blocked in either direction with the viewer: they are never targets and never bridges. */
async function blockedWith(db: Db, viewerId: string): Promise<Set<string>> {
  const found = await rows<{ id: string }>(
    db,
    `SELECT blocked_id AS id FROM blocks WHERE blocker_id = $1 UNION SELECT blocker_id FROM blocks WHERE blocked_id = $1`,
    [viewerId],
  );
  return new Set(found.map((row) => row.id));
}

/** Connected members of any of the given members. */
async function neighborsOf(db: Db, memberIds: string[]): Promise<Map<string, string[]>> {
  const adjacency = new Map<string, string[]>();
  if (memberIds.length === 0) return adjacency;
  const edges = await rows<{ member_lo: string; member_hi: string }>(
    db,
    'SELECT member_lo, member_hi FROM connections WHERE member_lo = ANY($1) OR member_hi = ANY($1)',
    [memberIds],
  );
  const wanted = new Set(memberIds);
  const link = (from: string, to: string): void => {
    if (wanted.has(from)) adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  };
  for (const edge of edges) {
    link(edge.member_lo, edge.member_hi);
    link(edge.member_hi, edge.member_lo);
  }
  return adjacency;
}

interface Levels {
  /** Members at exactly 1, 2 and 3 steps, over connected pairs, leaving out blocked members. */
  first: Set<string>;
  second: Set<string>;
  third: Set<string>;
  blocked: Set<string>;
}

async function levelsFrom(db: Db, viewerId: string): Promise<Levels> {
  const blocked = await blockedWith(db, viewerId);
  const seen = new Set<string>([viewerId, ...blocked]);
  const expand = async (from: Set<string>): Promise<Set<string>> => {
    const next = new Set<string>();
    for (const members of (await neighborsOf(db, [...from])).values()) {
      for (const member of members) if (!seen.has(member)) next.add(member);
    }
    for (const member of next) seen.add(member);
    return next;
  };
  const first = await expand(new Set([viewerId]));
  const second = await expand(first);
  const third = await expand(second);
  return { first, second, third, blocked };
}

/** Degree from the viewer to each target. Anything beyond three steps, or unreachable, is `out`. */
export async function degreesFrom(db: Db, viewerId: string, targetIds: string[]): Promise<Map<string, Degree>> {
  const levels = await levelsFrom(db, viewerId);
  return new Map(
    targetIds.map((id) => {
      const degree: Degree = id === viewerId ? 'self' : levels.first.has(id) ? '1' : levels.second.has(id) ? '2' : levels.third.has(id) ? '3' : 'out';
      return [id, degree];
    }),
  );
}

interface PathMember extends MemberRef {
  visibility: string;
}

const byNameThenId = (a: PathMember, b: PathMember): number => {
  const names = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  return names !== 0 ? names : a.id.localeCompare(b.id);
};

/**
 * A shortest path from the viewer to the target over the same graph as degree: the members in between, in order from
 * the viewer. Among shortest paths the first member sorts first by name ignoring case, then the next, ties by id.
 * A member private to the viewer is shown as private.
 */
export async function connectionPath(db: Db, viewerId: string, targetId: string): Promise<PathStep[]> {
  const levels = await levelsFrom(db, viewerId);
  const degree = levels.second.has(targetId) ? 2 : levels.third.has(targetId) ? 3 : 0;
  if (degree === 0) return [];

  const targetNeighbors = (await neighborsOf(db, [targetId])).get(targetId) ?? [];
  const lastHop = degree === 2 ? levels.first : levels.second;
  const nearTarget = targetNeighbors.filter((id) => lastHop.has(id));
  const wanted = new Set<string>(nearTarget);
  let firstHopCandidates: string[] = nearTarget;
  if (degree === 3) {
    const adjacency = await neighborsOf(db, nearTarget);
    firstHopCandidates = [...new Set([...adjacency.values()].flat().filter((id) => levels.first.has(id)))];
    for (const id of firstHopCandidates) wanted.add(id);
  }
  const people = await rows<PathMember>(db, 'SELECT id, name, handle, visibility FROM members WHERE id = ANY($1)', [[...wanted]]);
  const byId = new Map(people.map((person) => [person.id, person]));
  const pick = (ids: string[]): PathMember => {
    return ids.map((id) => byId.get(id) as PathMember).sort(byNameThenId)[0] as PathMember;
  };

  const chain: PathMember[] = [pick(firstHopCandidates)];
  if (degree === 3) {
    const first = chain[0] as PathMember;
    const fromFirst = (await neighborsOf(db, [first.id])).get(first.id) ?? [];
    chain.push(pick(fromFirst.filter((id) => nearTarget.includes(id))));
  }
  return chain.map((member) => (member.visibility === 'private' && !levels.first.has(member.id) ? { private: true } : { id: member.id, name: member.name, handle: member.handle }));
}
