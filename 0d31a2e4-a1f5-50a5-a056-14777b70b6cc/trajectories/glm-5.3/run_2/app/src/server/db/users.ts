import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import type { Presence } from "../../shared/domain.js";

export type UserRow = {
  id: number;
  handle: string;
  email: string;
  email_verified: boolean;
};

export async function findUserById(client: PoolClient | Pool, id: number): Promise<UserRow | null> {
  const result = await client.query<UserRow>(
    "SELECT id, handle, email, email_verified FROM users WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function findUserByHandle(client: PoolClient | Pool, handle: string): Promise<UserRow | null> {
  const result = await client.query<UserRow>(
    "SELECT id, handle, email, email_verified FROM users WHERE handle_lower = $1",
    [handle.toLowerCase()]
  );
  return result.rows[0] ?? null;
}

export type FriendshipRow = { user_a: number; user_b: number; since: Date };

export async function areFriends(client: PoolClient | Pool, a: number, b: number): Promise<boolean> {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const result = await client.query(
    "SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2",
    [lo, hi]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function blockedBetween(client: PoolClient | Pool, a: number, b: number): Promise<boolean> {
  const result = await client.query(
    "SELECT 1 FROM blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)",
    [a, b]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function query<T extends QueryResultRow>(client: PoolClient | Pool, text: string, values: unknown[]): Promise<QueryResult<T>> {
  return client.query<T>(text, values as never[]);
}

/** Presence as stored per player; the hub derives the values from heartbeats and party state. */
export type PresenceRecord = {
  userId: number;
  presence: Presence;
};

export async function partyOf(client: PoolClient | Pool, userId: number): Promise<{ id: number; state: string; leaderId: number } | null> {
  const result = await client.query<{ id: number; state: string; leader_id: number }>(
    `SELECT p.id, p.state, p.leader_id
       FROM parties p
       JOIN party_members m ON m.party_id = p.id
      WHERE m.user_id = $1`,
    [userId]
  );
  const row = result.rows[0];
  return row ? { id: row.id, state: row.state, leaderId: row.leader_id } : null;
}

export async function createSoloParty(client: PoolClient, userId: number): Promise<number> {
  const party = await client.query<{ id: number }>(
    "INSERT INTO parties (state, leader_id) VALUES ('idle', $1) RETURNING id",
    [userId]
  );
  const partyId = (party.rows[0] as { id: number }).id;
  await client.query("INSERT INTO party_members (party_id, user_id) VALUES ($1, $2)", [partyId, userId]);
  return partyId;
}
