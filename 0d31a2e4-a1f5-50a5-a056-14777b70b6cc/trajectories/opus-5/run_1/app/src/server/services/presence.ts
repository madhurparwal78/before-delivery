import type { Presence } from '../../shared/types.js';
import { query } from '../db.js';
import { hub } from '../ws/hub.js';
import { visibleFriendIds } from './friends.js';

interface PartyStateRow {
  user_id: number;
  state: string;
  size: number;
}

/** The one place a presence value is decided. */
export async function presenceFor(userIds: readonly number[]): Promise<Map<number, Presence>> {
  const result = new Map<number, Presence>();
  if (userIds.length === 0) return result;
  const rows = await query<PartyStateRow>(
    `SELECT m.user_id, p.state, (SELECT count(*) FROM party_members c WHERE c.party_id = p.id)::int AS size
     FROM party_members m JOIN parties p ON p.id = m.party_id
     WHERE m.user_id = ANY($1::int[])`,
    [userIds],
  );
  const parties = new Map(rows.map((row) => [row.user_id, row]));
  for (const userId of userIds) {
    if (!hub.isConnected(userId)) {
      result.set(userId, 'offline');
      continue;
    }
    const party = parties.get(userId);
    if (party === undefined) {
      result.set(userId, 'online');
      continue;
    }
    if (party.state === 'in_match') result.set(userId, 'in_match');
    else if (party.state === 'queued' || party.state === 'in_lobby' || party.size > 1) {
      result.set(userId, 'in_party');
    } else result.set(userId, 'online');
  }
  return result;
}

export async function presenceOf(userId: number): Promise<Presence> {
  const map = await presenceFor([userId]);
  return map.get(userId) ?? 'offline';
}

const announced = new Map<number, Presence>();

/** Sends presence changes to the friends allowed to see them. */
export async function announcePresence(userIds: Iterable<number>): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const map = await presenceFor(ids);
  for (const userId of ids) {
    const presence = map.get(userId) ?? 'offline';
    if (announced.get(userId) === presence) continue;
    announced.set(userId, presence);
    const friends = await visibleFriendIds(userId);
    hub.broadcast(friends, { type: 'presence', userId, presence });
  }
}

export function startPresenceSweep(): NodeJS.Timeout {
  return setInterval(() => {
    void announcePresence(hub.knownUsers());
  }, 1000);
}
