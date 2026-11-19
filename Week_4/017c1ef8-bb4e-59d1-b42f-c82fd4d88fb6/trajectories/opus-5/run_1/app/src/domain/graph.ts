import { businessNow } from '../server/clock';
import { config, WEEK_SECONDS } from '../server/config';
import { query } from '../server/db';

export type Degree = '1' | '2' | '3' | 'out';

export type ConnectionState =
  | 'none'
  | 'pending_sent'
  | 'pending_received'
  | 'connected'
  | 'withdrawn'
  | 'ignored'
  | 'blocked';

/** Members blocked in either direction with the viewer. They are invisible and never bridge. */
export async function blockedWith(viewerId: string): Promise<Set<string>> {
  const rows = await query<{ other: string }>(
    `SELECT blocked_id AS other FROM blocks WHERE blocker_id = $1
     UNION SELECT blocker_id AS other FROM blocks WHERE blocked_id = $1`,
    [viewerId],
  );
  return new Set(rows.map((row) => row.other));
}

export async function blockExists(a: string, b: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    `SELECT 1 AS one FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
    [a, b],
  );
  return rows.length > 0;
}

async function neighbours(ids: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = await query<{ member_a: string; member_b: string }>(
    `SELECT member_a, member_b FROM connections WHERE member_a = ANY($1) OR member_b = ANY($1)`,
    [ids as string[]],
  );
  const push = (from: string, to: string): void => {
    const list = out.get(from);
    if (list) list.push(to);
    else out.set(from, [to]);
  };
  const wanted = new Set(ids);
  for (const row of rows) {
    if (wanted.has(row.member_a)) push(row.member_a, row.member_b);
    if (wanted.has(row.member_b)) push(row.member_b, row.member_a);
  }
  return out;
}

/** Breadth-first distances from one member, over connections, ignoring blocked members. */
async function distances(
  fromId: string,
  excluded: Set<string>,
  maxDepth: number,
): Promise<Map<string, number>> {
  const dist = new Map<string, number>([[fromId, 0]]);
  let frontier = [fromId];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const found = await neighbours(frontier);
    const next: string[] = [];
    for (const list of found.values()) {
      for (const id of list) {
        if (dist.has(id) || excluded.has(id)) continue;
        dist.set(id, depth);
        next.push(id);
      }
    }
    frontier = next;
  }
  return dist;
}

export async function degreeBetween(viewerId: string, otherId: string): Promise<Degree> {
  if (viewerId === otherId) return '1';
  const excluded = await blockedWith(viewerId);
  if (excluded.has(otherId)) return 'out';
  const dist = await distances(viewerId, excluded, 3);
  const found = dist.get(otherId);
  if (found === 1 || found === 2 || found === 3) return String(found) as Degree;
  return 'out';
}

export async function areConnected(a: string, b: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const rows = await query<{ one: number }>(
    'SELECT 1 AS one FROM connections WHERE member_a = $1 AND member_b = $2',
    [low, high],
  );
  return rows.length > 0;
}

export async function connectionState(
  viewerId: string,
  otherId: string,
): Promise<ConnectionState> {
  if (await blockExists(viewerId, otherId)) return 'blocked';
  if (await areConnected(viewerId, otherId)) return 'connected';
  const rows = await query<{
    sender_id: string;
    state: string;
    resolved_at: Date | null;
  }>(
    `SELECT sender_id, state, resolved_at FROM invitations
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
     ORDER BY created_at DESC`,
    [viewerId, otherId],
  );
  const sent = rows.find((row) => row.sender_id === viewerId);
  const received = rows.find((row) => row.sender_id === otherId);
  if (sent && (sent.state === 'pending' || sent.state === 'ignored')) return 'pending_sent';
  if (received && received.state === 'pending') return 'pending_received';
  if (received && received.state === 'ignored') return 'ignored';
  if (sent && sent.state === 'withdrawn' && sent.resolved_at) {
    const retryAt = sent.resolved_at.getTime() + config.inviteCooldownSeconds * 1000;
    if (businessNow().getTime() < retryAt) return 'withdrawn';
  }
  return 'none';
}

export type MutualMember = { id: string; name: string; handle: string; connected_at: Date };

/** Connections shared with the viewer, in the published mutual order. */
export async function mutualConnections(
  viewerId: string,
  ownerId: string,
): Promise<MutualMember[]> {
  if (viewerId === ownerId) return [];
  const excluded = await blockedWith(viewerId);
  const rows = await query<{ id: string; name: string; handle: string; connected_at: Date }>(
    `WITH viewer AS (
       SELECT CASE WHEN member_a = $1 THEN member_b ELSE member_a END AS other, connected_at
       FROM connections WHERE member_a = $1 OR member_b = $1
     ), owner AS (
       SELECT CASE WHEN member_a = $2 THEN member_b ELSE member_a END AS other
       FROM connections WHERE member_a = $2 OR member_b = $2
     )
     SELECT m.id, m.name, m.handle, viewer.connected_at
     FROM viewer
     JOIN owner ON owner.other = viewer.other
     JOIN members m ON m.id = viewer.other
     WHERE m.id <> $1 AND m.id <> $2`,
    [viewerId, ownerId],
  );
  const visible = rows.filter((row) => !excluded.has(row.id));
  visible.sort((a, b) => {
    const byTime = b.connected_at.getTime() - a.connected_at.getTime();
    if (byTime !== 0) return byTime;
    const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : 1;
  });
  return visible;
}

/** A shortest path's intermediate members, chosen by name ascending at each step. */
export async function connectionPath(
  viewerId: string,
  ownerId: string,
): Promise<{ id: string; name: string; handle: string }[]> {
  const degree = await degreeBetween(viewerId, ownerId);
  if (degree !== '2' && degree !== '3') return [];
  const excluded = await blockedWith(viewerId);
  const target = Number(degree);
  const fromOwner = await distances(ownerId, excluded, target);
  const path: { id: string; name: string; handle: string }[] = [];
  let current = viewerId;
  for (let step = 1; step < target; step += 1) {
    const remaining = target - step;
    const found = await neighbours([current]);
    const candidateIds = (found.get(current) ?? []).filter(
      (id) => !excluded.has(id) && id !== viewerId && fromOwner.get(id) === remaining,
    );
    if (candidateIds.length === 0) return [];
    const people = await query<{ id: string; name: string; handle: string }>(
      'SELECT id, name, handle FROM members WHERE id = ANY($1)',
      [candidateIds],
    );
    people.sort((a, b) => {
      const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return byName !== 0 ? byName : a.id < b.id ? -1 : 1;
    });
    const chosen = people[0];
    path.push(chosen);
    current = chosen.id;
  }
  return path;
}

/** Requests the sender created in the last 604,800 seconds, whatever became of them. */
export async function weeklyInviteCount(senderId: string): Promise<number> {
  const since = new Date(businessNow().getTime() - WEEK_SECONDS * 1000);
  const rows = await query<{ count: string }>(
    'SELECT count(*) AS count FROM invitations WHERE sender_id = $1 AND created_at > $2',
    [senderId, since],
  );
  return Number(rows[0].count);
}
