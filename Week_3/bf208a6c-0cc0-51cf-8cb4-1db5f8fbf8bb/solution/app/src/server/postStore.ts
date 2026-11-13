import { maybeOne, one, rows, type Db } from "./db";
import type { PostState } from "../shared/types";

export interface PostLock {
  id: string;
  section_id: string;
  author_id: string;
  title: string;
  body: string;
  state: PostState;
  position: number | null;
  version: number;
  last_actor: string;
}

/** Takes the row lock of a post inside a board write; null when the post is gone. */
export const lockPost = (db: Db, postId: string): Promise<PostLock | null> =>
  maybeOne<PostLock>(
    db,
    `SELECT p.id, p.section_id, p.author_id, p.title, p.body, p.state, p.position, p.version, u.display_name AS last_actor
     FROM posts p JOIN users u ON u.id = p.last_actor_id WHERE p.id = $1 FOR UPDATE OF p`,
    [postId],
  );

/** Hand order: a post that is published, approved or created lands last in its section. */
export async function nextPosition(db: Db, sectionId: string): Promise<number> {
  const { next } = await one<{ next: number }>(db, `SELECT coalesce(max(position), 0) + 1 AS next FROM posts WHERE section_id = $1 AND state = 'published'`, [sectionId]);
  return next;
}

/** The published posts of a section in hand order. */
export async function publishedOrder(db: Db, sectionId: string): Promise<string[]> {
  return (await rows<{ id: string }>(db, `SELECT id FROM posts WHERE section_id = $1 AND state = 'published' ORDER BY position`, [sectionId])).map((row) => row.id);
}

/** Stores hand orders: every post takes the 1-based place it has in its section's list. */
export async function writeOrders(db: Db, orders: Record<string, string[]>): Promise<void> {
  const ids = Object.values(orders).flat();
  const positions = Object.values(orders).flatMap((order) => order.map((_, index) => index + 1));
  await db.query(`UPDATE posts SET position = v.position FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS position) v WHERE posts.id = v.id`, [ids, positions]);
}
