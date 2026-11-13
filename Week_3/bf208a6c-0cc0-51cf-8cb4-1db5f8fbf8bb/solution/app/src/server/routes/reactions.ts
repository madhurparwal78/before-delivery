import type { PoolClient } from "pg";
import { authorize, openPost } from "../access";
import { one, pool, rows } from "../db";
import { writeBoard } from "../events";
import { conflict, invalid, json, notFound, param, parseJson, type Reply, type Request } from "../http";
import { lockPost } from "../postStore";
import { loadPost } from "../views";
import { commentErrors } from "../../shared/rules";
import type { Comment, Reactions } from "../../shared/types";

/** A like or vote change: runs on the board-locked transaction and says whether any stored row changed. */
type Change = (db: PoolClient, postId: string, userId: string) => Promise<boolean>;

async function react(request: Request, prepare: (body: Record<string, unknown>) => Change): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  const user = authorize(access, "react");
  const change = prepare(parseJson(request.body));
  const reactions = await writeBoard(access.board.id, async ({ db, emit }) => {
    const locked = await lockPost(db, post.id);
    if (!locked) throw notFound();
    if (locked.state !== "published") throw conflict("not_published");
    if (await change(db, post.id, user.id)) await emit({ type: "reaction", post_id: post.id });
    const { likes, score, liked, my_vote } = await loadPost(db, post.id, access);
    const result: Reactions = { likes, score, liked, my_vote };
    return result;
  });
  return json(200, reactions);
}

export const like = (request: Request): Promise<Reply> =>
  react(request, () => async (db, postId, userId) => (await db.query(`INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, userId])).rowCount === 1);

export const unlike = (request: Request): Promise<Reply> =>
  react(request, () => async (db, postId, userId) => (await db.query(`DELETE FROM likes WHERE post_id = $1 AND user_id = $2`, [postId, userId])).rowCount === 1);

export const vote = (request: Request): Promise<Reply> =>
  react(request, (body) => {
    const value = body["value"];
    if (value !== 1 && value !== -1) throw invalid({ value: "Vote 1 for up or -1 for down." });
    return async (db, postId, userId) =>
      (
        await db.query(
          `INSERT INTO votes (post_id, user_id, value) VALUES ($1, $2, $3)
           ON CONFLICT (post_id, user_id) DO UPDATE SET value = EXCLUDED.value WHERE votes.value <> EXCLUDED.value`,
          [postId, userId, value],
        )
      ).rowCount === 1;
  });

export const unvote = (request: Request): Promise<Reply> =>
  react(request, () => async (db, postId, userId) => (await db.query(`DELETE FROM votes WHERE post_id = $1 AND user_id = $2`, [postId, userId])).rowCount === 1);

export async function comments(request: Request): Promise<Reply> {
  const { post } = await openPost(request, param(request, "id"));
  const found = await rows<{ id: string; author_id: string; display_name: string; text: string; created_at: Date }>(
    pool,
    `SELECT c.id, u.id AS author_id, u.display_name, c.text, c.created_at FROM comments c JOIN users u ON u.id = c.author_id WHERE c.post_id = $1 ORDER BY c.seq`,
    [post.id],
  );
  const list: Comment[] = found.map((row) => ({ id: row.id, author: { id: row.author_id, display_name: row.display_name }, text: row.text, created_at: row.created_at.toISOString() }));
  return json(200, { comments: list });
}

export async function addComment(request: Request): Promise<Reply> {
  const { access, post } = await openPost(request, param(request, "id"));
  const user = authorize(access, "contribute");
  const value = String(parseJson(request.body)["text"] ?? "").trim();
  const errors = commentErrors(value);
  const comment = await writeBoard(access.board.id, async ({ db, emit }) => {
    const locked = await lockPost(db, post.id);
    if (!locked) throw notFound();
    if (locked.state !== "published") throw conflict("not_published");
    if (Object.keys(errors).length) throw invalid(errors);
    const row = await one<{ id: string; created_at: Date }>(db, `INSERT INTO comments (post_id, author_id, text) VALUES ($1, $2, $3) RETURNING id, created_at`, [post.id, user.id, value]);
    await emit({ type: "comment_added", post_id: post.id });
    const created: Comment = { id: row.id, author: { id: user.id, display_name: user.display_name }, text: value, created_at: row.created_at.toISOString() };
    return created;
  });
  return json(201, comment);
}
