import { createUser } from "./accounts.js";
import { transaction } from "./db.js";
import { ApiError } from "./errors.js";
import { insertPen } from "./pens.js";
import { starterOf, STARTERS } from "./starters.js";
import { pool } from "./db.js";
import { saveVersion } from "./versions.js";

const SEED_LOCK = 724_002;

const STARTER_HANDLE = "coldframe";

export async function ensureStarters(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
    const existing = await tx.query<{ id: string }>("SELECT id FROM users WHERE handle = $1", [STARTER_HANDLE]);
    const ownerId =
      existing.rows[0]?.id ??
      (await createUser(tx, { handle: STARTER_HANDLE, email: "starters@coldframe.test", password: null, verified: true })).id;
    for (const [index, starter] of STARTERS.entries()) {
      const present = await tx.query("SELECT 1 FROM pens WHERE starter = $1", [index + 1]);
      if (present.rowCount === 0) {
        await insertPen(tx, { ownerId, title: starter.title, visibility: "public", tags: starter.tags, starter: index + 1 });
      }
    }
  });
}

export async function writeStarterVersions(): Promise<void> {
  const waiting = await pool.query<{ id: string; starter: number }>(
    "SELECT p.id, p.starter FROM pens p WHERE p.starter IS NOT NULL AND NOT EXISTS (SELECT 1 FROM versions v WHERE v.pen_id = p.id)",
  );
  for (const row of waiting.rows) {
    const starter = starterOf(row.starter);
    try {
      await transaction((tx) => saveVersion(tx, { penId: row.id, base: 0, content: async () => starter }));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
}
