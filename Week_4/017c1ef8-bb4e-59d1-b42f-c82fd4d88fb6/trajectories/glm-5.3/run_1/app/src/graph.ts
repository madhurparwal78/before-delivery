import { query } from './db.js';

export type Edge = { requester_id: string; addressee_id: string; connected_at: Date | null };

export type BlockedSet = Set<string>;

export const blockedWith = async (viewerId: string): Promise<BlockedSet> => {
  const result = await query(
    `SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = $1 OR blocked_id = $1`,
    [viewerId],
  );
  const set: BlockedSet = new Set();
  for (const row of result.rows) {
    set.add(row.blocker_id === viewerId ? row.blocked_id : row.blocker_id);
  }
  return set;
};

export const connectionEdges = async (): Promise<Edge[]> => {
  const result = await query<Edge>(
    `SELECT requester_id, addressee_id, connected_at FROM connections WHERE state = 'connected'`,
  );
  return result.rows;
};

/** Adjacency over connected pairs, excluding anyone blocked with the viewer. */
export const adjacencyFor = (edges: Edge[], blocked: BlockedSet): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    if (blocked.has(edge.requester_id) || blocked.has(edge.addressee_id)) continue;
    push(map, edge.requester_id, edge.addressee_id);
    push(map, edge.addressee_id, edge.requester_id);
  }
  return map;
};

const push = (map: Map<string, string[]>, k: string, v: string): void => {
  const list = map.get(k);
  if (list) list.push(v); else map.set(k, [v]);
};

/** Shortest-path distance from the viewer to the target over the connection graph. */
export const degree = (viewerId: string, targetId: string, adjacency: Map<string, string[]>): number | null => {
  if (viewerId === targetId) return 0;
  const queue: string[] = [viewerId];
  const seen = new Set([viewerId]);
  let depth = 0;
  while (queue.length > 0) {
    depth += 1;
    if (depth > 3) return null;
    const next: string[] = [];
    for (const node of queue) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (neighbour === targetId) return depth;
        if (!seen.has(neighbour)) { seen.add(neighbour); next.push(neighbour); }
      }
    }
    queue.length = 0;
    queue.push(...next);
  }
  return null;
};

export const degreeLabel = (d: number | null): { label: string; data: string; numeral: string } => {
  if (d === 1) return { label: '1st', data: '1', numeral: '1' };
  if (d === 2) return { label: '2nd', data: '2', numeral: '2' };
  if (d === 3) return { label: '3rd+', data: '3', numeral: '3' };
  return { label: 'Out of network', data: 'out', numeral: '—' };
};

export type MutualMember = { id: string; name: string; handle: string; connectedAt: Date };

/** Members connected to both viewer and target, leaving out anyone blocked with the viewer. */
export const mutuals = async (viewerId: string, targetId: string, blocked: BlockedSet): Promise<MutualMember[]> => {
  const result = await query<{ id: string; name: string; handle: string; connected_at: Date }>(
    `WITH mine AS (
       SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS other_id,
              connected_at
       FROM connections
       WHERE state = 'connected' AND ($1 = requester_id OR $1 = addressee_id)
     )
     SELECT m.id, m.name, m.handle, mine.connected_at
     FROM mine JOIN members m ON m.id = mine.other_id
     WHERE mine.other_id IN (
       SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
       FROM connections
       WHERE state = 'connected' AND ($2 = requester_id OR $2 = addressee_id)
     )
     ORDER BY mine.connected_at DESC NULLS LAST, lower(m.name) ASC`,
    [viewerId, targetId],
  );
  return result.rows
    .filter((row) => !blocked.has(row.id))
    .map((row) => ({ id: row.id, name: row.name, handle: row.handle, connectedAt: row.connected_at }));
};

/** The mutual line text for a count and the named mutual's full name. */
export const mutualLineText = (count: number, namedName: string | null): string => {
  if (count === 0) return '';
  if (count === 1) return '1 mutual connection';
  const name = namedName ?? '';
  if (count === 2) return `${name} and 1 other mutual connection`;
  return `${name} and ${count - 1} other mutual connections`;
};

/** A shortest connection path, choosing lexicographically-first members at each step. */
export const shortestPath = (
  viewerId: string,
  targetId: string,
  adjacency: Map<string, string[]>,
  names: Map<string, { name: string; id: string }>,
): string[] | null => {
  const distance = degree(viewerId, targetId, adjacency);
  if (distance === null || distance < 2 || distance > 3) return null;

  const compare = (a: string, b: string): number => {
    const an = names.get(a)?.name.toLowerCase() ?? '';
    const bn = names.get(b)?.name.toLowerCase() ?? '';
    if (an < bn) return -1;
    if (an > bn) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };

  // BFS layer by layer, so best always holds the shortest route found so far.
  const best = new Map<string, string>(); // node -> predecessor
  let frontier = [viewerId];
  const seen = new Set([viewerId]);
  while (frontier.length > 0 && !best.has(targetId)) {
    const discovered = new Map<string, string>();
    for (const node of frontier) {
      const neighbours = [...(adjacency.get(node) ?? [])].sort(compare);
      for (const neighbour of neighbours) {
        if (seen.has(neighbour)) continue;
        const existing = discovered.get(neighbour);
        if (existing === undefined || compare(node, existing) < 0) {
          discovered.set(neighbour, node);
        }
      }
    }
    for (const [node, prev] of discovered) { best.set(node, prev); seen.add(node); }
    frontier = [...discovered.keys()];
  }

  const path: string[] = [];
  let cursor = targetId;
  while (cursor !== viewerId && best.has(cursor)) {
    path.unshift(cursor);
    cursor = best.get(cursor)!;
  }
  if (cursor !== viewerId || path.length !== distance) return null;
  return path;
};
