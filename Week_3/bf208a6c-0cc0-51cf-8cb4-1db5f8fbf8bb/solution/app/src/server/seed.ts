import { maybeOne, one, transaction } from "./db";
import { nextPosition } from "./postStore";
import { hashSecret, newToken } from "./security";

export const DEMO = { name: "Wren Demo", email: "demo@pinsheet.test", password: "pinsheet-demo-1", board: "Field day" } as const;

const SECTIONS = ["Plans", "Photos", "Notes"] as const;

const POSTS: { section: (typeof SECTIONS)[number]; title: string; card: boolean }[] = [
  { section: "Plans", title: "Packing list", card: true },
  { section: "Plans", title: "Bus times", card: true },
  { section: "Plans", title: "Rain plan", card: false },
  { section: "Plans", title: "Campfire rota", card: false },
  { section: "Photos", title: "Ridge at dawn", card: false },
  { section: "Photos", title: "Canoe launch", card: false },
  { section: "Photos", title: "Fern gully", card: false },
  { section: "Photos", title: "Group photo", card: false },
  { section: "Photos", title: "Lake at dusk", card: false },
  { section: "Notes", title: "Map of the loop", card: false },
  { section: "Notes", title: "Lunch spot vote", card: false },
  { section: "Notes", title: "Kit check", card: true },
];

/** Makes sure the demo account and its board exist; running it again changes nothing. */
export async function seedDemo(): Promise<void> {
  const passwordHash = await hashSecret(DEMO.password);
  await transaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(7355609)`);
    const existing = await maybeOne<{ id: string }>(db, `SELECT id FROM users WHERE lower(email) = $1`, [DEMO.email]);
    const userId =
      existing?.id ??
      (await one<{ id: string }>(db, `INSERT INTO users (display_name, email, password_hash, verified) VALUES ($1, $2, $3, true) RETURNING id`, [DEMO.name, DEMO.email, passwordHash])).id;
    if (await maybeOne(db, `SELECT 1 FROM boards WHERE owner_id = $1 AND title = $2`, [userId, DEMO.board])) return;
    const { id: boardId } = await one<{ id: string }>(db, `INSERT INTO boards (owner_id, title, privacy, link_token) VALUES ($1, $2, 'public', $3) RETURNING id`, [userId, DEMO.board, newToken()]);
    await db.query(`INSERT INTO members (board_id, user_id, role) VALUES ($1, $2, 'owner')`, [boardId, userId]);
    const sectionIds: Record<string, string> = {};
    for (const [ordinal, title] of SECTIONS.entries()) {
      sectionIds[title] = (await one<{ id: string }>(db, `INSERT INTO sections (board_id, title, ordinal) VALUES ($1, $2, $3) RETURNING id`, [boardId, title, ordinal])).id;
    }
    const start = Date.now();
    for (const [index, post] of POSTS.entries()) {
      const sectionId = sectionIds[post.section];
      await db.query(
        `INSERT INTO posts (board_id, section_id, author_id, title, state, position, last_actor_id, file_card, created_at)
         VALUES ($1, $2, $3, $4, 'published', $5, $3, $6, $7)`,
        [boardId, sectionId, userId, post.title, await nextPosition(db, sectionId), post.card, new Date(start + index)],
      );
    }
  });
}
