import { one, rows, type Db } from "./db.js";
import { emit } from "./events.js";

const STALE_SECONDS = 45;

/**
 * Who is viewing: owner and members with the board open in any window, one entry per person,
 * ordered by when that person's earliest window started watching. Empty for a board with no members.
 */
export async function viewersOf(db: Db, boardId: number): Promise<{ id: number; name: string }[]> {
  const hasMembers = await one(db, "SELECT 1 FROM board_members WHERE board_id = $1", [boardId]);
  if (!hasMembers) return [];
  return rows<{ id: number; name: string }>(
    db,
    `SELECT u.id, u.name
       FROM (SELECT user_id, min(since) AS first_open FROM presence
              WHERE board_id = $1 AND seen_at > now() - make_interval(secs => $2) GROUP BY user_id) w
       JOIN users u ON u.id = w.user_id
      WHERE u.id = (SELECT owner_id FROM boards WHERE id = $1)
         OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = $1 AND m.user_id = u.id)
      ORDER BY w.first_open, u.id`,
    [boardId, STALE_SECONDS],
  );
}

export async function emitViewers(db: Db, boardId: number): Promise<void> {
  await emit(db, { kind: "board", board: boardId }, { type: "viewers", board_id: boardId, viewers: await viewersOf(db, boardId) });
}

export async function addPresence(db: Db, connId: string, instance: string, boardId: number, userId: number): Promise<void> {
  await db.query(
    `INSERT INTO presence (conn_id, instance, board_id, user_id, since, seen_at)
     VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp()) ON CONFLICT (conn_id) DO NOTHING`,
    [`${connId}:${boardId}`, instance, boardId, userId],
  );
}

export async function removePresence(db: Db, connId: string, boardId: number): Promise<void> {
  await db.query("DELETE FROM presence WHERE conn_id = $1", [`${connId}:${boardId}`]);
}

/** A removed person leaves the list at once, in every window. */
export async function dropPresence(db: Db, boardId: number, userId: number): Promise<void> {
  await db.query("DELETE FROM presence WHERE board_id = $1 AND user_id = $2", [boardId, userId]);
}

export async function keepPresence(db: Db, instance: string): Promise<void> {
  await db.query("UPDATE presence SET seen_at = clock_timestamp() WHERE instance = $1", [instance]);
  await db.query("DELETE FROM presence WHERE seen_at < clock_timestamp() - make_interval(secs => $1)", [STALE_SECONDS * 4]);
}
