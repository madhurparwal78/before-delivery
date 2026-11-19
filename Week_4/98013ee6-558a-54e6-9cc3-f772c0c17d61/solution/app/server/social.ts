import { loadBoard } from "./access.js";
import { commentCount, emitCounts, followerCount, reactionCount } from "./counts.js";
import { iso, now } from "./clock.js";
import { one, pool, rows, tx } from "./db.js";
import { forbidden, notFound, validation } from "./errors.js";
import { emit } from "./events.js";
import { getPin } from "./pins.js";
import { validateComment } from "./text.js";
import type { SessionUser } from "./http.js";
import type { CommentView, ReactionType } from "../shared/types.js";

export async function followUser(me: SessionUser, targetId: number, follow: boolean): Promise<{ following: boolean; followers: number }> {
  const target = await one(pool, "SELECT 1 FROM users WHERE id = $1", [targetId]);
  if (!target) throw notFound();
  if (targetId === me.id) throw validation("user");
  if (follow) await pool.query("INSERT INTO follows (follower_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [me.id, targetId]);
  else await pool.query("DELETE FROM follows WHERE follower_id = $1 AND user_id = $2", [me.id, targetId]);
  const followers = await followerCount(pool, "user", targetId);
  await emit(pool, { kind: "user", user: targetId }, { type: "follow", target: "user", id: targetId, followers });
  return { following: follow, followers };
}

export async function followBoard(me: SessionUser, boardId: number, follow: boolean): Promise<{ following: boolean; followers: number }> {
  const access = await loadBoard(pool, boardId, me.id);
  if (access.ownerId === me.id || access.visibility === "secret") throw validation("board");
  if (follow) await pool.query("INSERT INTO board_follows (follower_id, board_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [me.id, boardId]);
  else await pool.query("DELETE FROM board_follows WHERE follower_id = $1 AND board_id = $2", [me.id, boardId]);
  const followers = await followerCount(pool, "board", boardId);
  await emit(pool, { kind: "board", board: boardId }, { type: "follow", target: "board", id: boardId, followers });
  return { following: follow, followers };
}

const REACTIONS: readonly ReactionType[] = ["love", "idea", "wow", "thanks"];

/** Each person keeps at most one reaction per pin: choosing another replaces it, choosing the same one removes it. */
export async function react(me: SessionUser, pinId: number, type: unknown): Promise<{ mine: ReactionType | null; reactions: number }> {
  await getPin(pool, me.id, pinId);
  const chosen = REACTIONS.find((candidate) => candidate === type);
  if (!chosen) throw validation("type");
  const mine = await tx(async (client) => {
    const current = await one<{ type: ReactionType }>(client, "SELECT type FROM reactions WHERE pin_id = $1 AND user_id = $2 FOR UPDATE", [pinId, me.id]);
    if (current?.type === chosen) {
      await client.query("DELETE FROM reactions WHERE pin_id = $1 AND user_id = $2", [pinId, me.id]);
      await emitCounts(client, [pinId]);
      return null;
    }
    await client.query(
      "INSERT INTO reactions (pin_id, user_id, type, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (pin_id, user_id) DO UPDATE SET type = $3, created_at = $4",
      [pinId, me.id, chosen, now()],
    );
    await emitCounts(client, [pinId]);
    return chosen;
  });
  return { mine, reactions: await reactionCount(pool, pinId) };
}

interface CommentRow {
  id: number;
  parent_id: number | null;
  text: string;
  deleted: boolean;
  created_at: Date;
  author_id: number;
  author_name: string;
  author_handle: string;
}

const toView = (row: CommentRow): Omit<CommentView, "replies"> => ({
  id: row.id,
  author: { id: row.author_id, name: row.author_name, handle: row.author_handle },
  text: row.deleted ? null : row.text,
  deleted: row.deleted,
  created_at: iso(row.created_at),
});

/** Comments oldest first, one level of replies. A deleted comment stays as a placeholder only while it has replies. */
export async function listComments(viewerId: number, pinId: number): Promise<{ count: number; comments: CommentView[] }> {
  await getPin(pool, viewerId, pinId);
  const all = await rows<CommentRow>(
    pool,
    `SELECT c.id, c.parent_id, c.text, c.deleted, c.created_at, u.id AS author_id, u.name AS author_name, u.handle AS author_handle
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.pin_id = $1 ORDER BY c.created_at, c.id`,
    [pinId],
  );
  const repliesOf = (parent: number): Omit<CommentView, "replies">[] =>
    all.filter((row) => row.parent_id === parent && !row.deleted).map(toView);
  const comments = all
    .filter((row) => row.parent_id === null)
    .map((row): CommentView => ({ ...toView(row), replies: repliesOf(row.id) }))
    .filter((comment) => !comment.deleted || comment.replies.length > 0);
  return { count: await commentCount(pool, pinId), comments };
}

export async function addComment(me: SessionUser, pinId: number, parent: unknown, textValue: unknown): Promise<CommentView> {
  await getPin(pool, me.id, pinId);
  let parentId: number | null = null;
  if (parent !== null && parent !== undefined) {
    const target = typeof parent === "number" && Number.isSafeInteger(parent) ? await one<{ id: number; parent_id: number | null }>(
      pool, "SELECT id, parent_id FROM comments WHERE id = $1 AND pin_id = $2 AND NOT deleted", [parent, pinId]) : null;
    if (!target) throw notFound();
    parentId = target.parent_id ?? target.id;
  }
  const text = validateComment(textValue);
  return tx(async (client) => {
    const created = await one<CommentRow>(
      client,
      `WITH inserted AS (INSERT INTO comments (pin_id, author_id, parent_id, text, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *)
       SELECT i.id, i.parent_id, i.text, i.deleted, i.created_at, u.id AS author_id, u.name AS author_name, u.handle AS author_handle
         FROM inserted i JOIN users u ON u.id = i.author_id`,
      [pinId, me.id, parentId, text, now()],
    );
    if (!created) throw notFound();
    await emitCounts(client, [pinId]);
    return { ...toView(created), replies: [] };
  });
}

export async function deleteComment(me: SessionUser, commentId: number): Promise<void> {
  const comment = await one<{ id: number; pin_id: number; author_id: number }>(
    pool, "SELECT id, pin_id, author_id FROM comments WHERE id = $1 AND NOT deleted", [commentId],
  );
  if (!comment) throw notFound();
  const pin = await getPin(pool, me.id, comment.pin_id);
  if (comment.author_id !== me.id && pin.owner.id !== me.id) throw forbidden();
  await tx(async (client) => {
    await client.query("UPDATE comments SET deleted = true WHERE id = $1", [commentId]);
    await emitCounts(client, [comment.pin_id]);
  });
}
