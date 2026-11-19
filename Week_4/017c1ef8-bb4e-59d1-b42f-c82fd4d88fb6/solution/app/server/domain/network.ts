import { rows, type Db } from '../db.js';
import { openRequests, type Requested } from './connections.js';
import { personCards, type PersonCard } from './people.js';
import { notBlockedWith } from './visibility.js';

type Timed = PersonCard & { requested_at?: string; connected_at?: string };

async function withTimes(db: Db, viewerId: string, dated: Requested[], field: 'requested_at' | 'connected_at'): Promise<Timed[]> {
  const cards = await personCards(db, viewerId, dated.map((entry) => entry.id));
  const at = new Map(dated.map((entry) => [entry.id, entry.at.toISOString()]));
  return cards.map((card) => ({ ...card, [field]: at.get(card.id) }));
}

/** Invitations received and sent (newest first) and connections (most recent first), without blocked members. */
export async function networkFor(db: Db, viewerId: string): Promise<{ received: Timed[]; sent: Timed[]; connections: Timed[] }> {
  const { received, sent } = await openRequests(db, viewerId);
  const connections = await rows<Requested>(
    db,
    `SELECT CASE WHEN member_lo = $1 THEN member_hi ELSE member_lo END AS id, connected_at AS at FROM connections
      WHERE (member_lo = $1 OR member_hi = $1) AND ${notBlockedWith('$1', "CASE WHEN member_lo = $1 THEN member_hi ELSE member_lo END")}`,
    [viewerId],
  );
  const newestFirst = (a: Requested, b: Requested): number => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id);
  return {
    received: await withTimes(db, viewerId, received.sort(newestFirst), 'requested_at'),
    sent: await withTimes(db, viewerId, sent.sort(newestFirst), 'requested_at'),
    connections: await withTimes(db, viewerId, connections.sort(newestFirst), 'connected_at'),
  };
}
