import { exactlyOne, rows, type Db } from "./db.js";
import { emit } from "./events.js";

/** The derived counts of a pin, each computed in exactly one place. */
export const savesCountSql = (pin: string): string =>
  `(SELECT count(*) FROM pins sv JOIN boards sb ON sb.id = sv.board_id WHERE sv.saved_from = ${pin}.id AND sv.state = 'live' AND sb.visibility = 'public')::int`;
export const commentsCountSql = (pin: string): string =>
  `(SELECT count(*) FROM comments cc WHERE cc.pin_id = ${pin}.id AND NOT cc.deleted)::int`;
export const reactionsCountSql = (pin: string): string => `(SELECT count(*) FROM reactions rc WHERE rc.pin_id = ${pin}.id)::int`;

/** Counts of a board and of a person; each argument is a SQL expression for the id. */
export const pinCountSql = (boardId: string): string => `(SELECT count(*)::int FROM pins pc WHERE pc.board_id = ${boardId} AND pc.state = 'live')`;
export const boardFollowersSql = (boardId: string): string => `(SELECT count(*)::int FROM board_follows bf WHERE bf.board_id = ${boardId})`;
export const userFollowersSql = (userId: string): string => `(SELECT count(*)::int FROM follows uf WHERE uf.user_id = ${userId})`;
export const userFollowingSql = (userId: string): string => `(SELECT count(*)::int FROM follows ug WHERE ug.follower_id = ${userId})`;

export async function followerCount(db: Db, target: "user" | "board", id: number): Promise<number> {
  const sql = target === "user" ? userFollowersSql("$1") : boardFollowersSql("$1");
  return (await exactlyOne<{ count: number }>(db, `SELECT ${sql} AS count`, [id])).count;
}

export async function commentCount(db: Db, pinId: number): Promise<number> {
  return (await exactlyOne<{ count: number }>(db, `SELECT ${commentsCountSql("p")} AS count FROM pins p WHERE p.id = $1`, [pinId])).count;
}

export async function reactionCount(db: Db, pinId: number): Promise<number> {
  return (await exactlyOne<{ count: number }>(db, `SELECT ${reactionsCountSql("p")} AS count FROM pins p WHERE p.id = $1`, [pinId])).count;
}

export async function emitCounts(db: Db, pinIds: Iterable<number>): Promise<void> {
  const ids = [...new Set(pinIds)];
  if (ids.length === 0) return;
  const counted = await rows<{ id: number; saves: number; comments: number; reactions: number }>(
    db,
    `SELECT p.id, ${savesCountSql("p")} AS saves, ${commentsCountSql("p")} AS comments, ${reactionsCountSql("p")} AS reactions
       FROM pins p WHERE p.id = ANY($1)`,
    [ids],
  );
  for (const row of counted) {
    await emit(db, { kind: "pin", pin: row.id }, { type: "counts", pin_id: row.id, saves: row.saves, comments: row.comments, reactions: row.reactions });
  }
}

/** The root original a pin credits: the pin itself unless it is a save. Written once, used wherever saves are grouped. */
export const rootSql = (pin: string): string => `COALESCE(${pin}.saved_from, ${pin}.id)`;

export async function rootsOf(db: Db, pinIds: number[]): Promise<number[]> {
  if (pinIds.length === 0) return [];
  const found = await rows<{ root: number }>(db, `SELECT DISTINCT ${rootSql("p")} AS root FROM pins p WHERE p.id = ANY($1)`, [pinIds]);
  return found.map((row) => row.root);
}
