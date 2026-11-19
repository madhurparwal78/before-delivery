import { query, type Db } from './db.ts';

/** Usernames holding a role on the map: its owner and its members. */
export async function roleHolders(db: Db, map: { id: string; owner_id: string }): Promise<Set<string>> {
  const rows = await query<{ username: string }>(db, 'SELECT u.username FROM members m JOIN users u ON u.id = m.user_id WHERE m.map_id = $1', [map.id]);
  return new Set([await ownerName(db, map.owner_id), ...rows.map((r) => r.username)]);
}

export async function ownerName(db: Db, ownerId: string): Promise<string> {
  const rows = await query<{ username: string }>(db, 'SELECT username FROM users WHERE id = $1', [ownerId]);
  return rows[0]?.username ?? '';
}
