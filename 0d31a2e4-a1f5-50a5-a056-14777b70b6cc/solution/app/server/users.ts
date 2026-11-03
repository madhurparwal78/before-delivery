// Players as the API shows them, and the rules for who can see whom.
import type pg from "pg";
import { LOCK, lockKey, type Queryable, query, type Row } from "./db.js";
import type { Me, User } from "../shared/api.js";
import { hueOf } from "../shared/rules.js";

export type { Me, User };

export function toUser(row: Row, prefix = ""): User {
  const id = Number(row[`${prefix}id`]);
  return { id, handle: String(row[`${prefix}handle`]), hue: hueOf(id) };
}

export function toMe(row: Row): Me {
  return { ...toUser(row), email: String(row["email"]), emailVerified: row["email_verified"] === true };
}

export function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export async function usersById(ids: readonly number[], on?: Queryable): Promise<Map<number, User>> {
  const rows = await query("SELECT id, handle FROM users WHERE id = ANY($1::int[])", [ids], on);
  return new Map(rows.map((row) => [Number(row["id"]), toUser(row)]));
}

export async function areFriends(a: number, b: number, on?: Queryable): Promise<boolean> {
  const rows = await query("SELECT 1 FROM friendships WHERE low_id = LEAST($1::int, $2::int) AND high_id = GREATEST($1::int, $2::int)", [a, b], on);
  return rows.length > 0;
}

// Serialises everything that links or cuts one pair of players (requests, accepts, invites, blocks) across processes.
export async function lockPair(client: pg.PoolClient, a: number, b: number): Promise<void> {
  await lockKey(client, LOCK.friendPair, (Math.min(a, b) * 1_000_003 + Math.max(a, b)) % 2_000_000_000);
}

export async function blockBetween(a: number, b: number, on?: Queryable): Promise<boolean> {
  const rows = await query(
    "SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)", [a, b], on);
  return rows.length > 0;
}

// Accepted friends with no block either way: the only people who see a player's presence and get their events.
export async function visibleFriends(userId: number, on?: Queryable): Promise<number[]> {
  const rows = await query(
    `SELECT CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END AS id FROM friendships f
     WHERE (f.low_id = $1 OR f.high_id = $1)`, [userId], on);
  return rows.map((row) => Number(row["id"]));
}
