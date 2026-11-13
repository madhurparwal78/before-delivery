import { pool, queryOne } from "./db";
import { insertCell } from "./notebooks";
import { markStale, runIndexer } from "./search";
import { hashToken, newId, newToken } from "./session";
import { createUser } from "./routes/auth";

const OWNER = { email: "ada@wrenmoor.test", display_name: "Ada Thornquist", password: "tidewater-2026" };
const EDITOR = { email: "bram@wrenmoor.test", display_name: "Bram Okonkwo-Lisle", password: "saltmarsh-2026" };
const VIEWER = { email: "cleo@wrenmoor.test", display_name: "Cleo Varga", password: "larchgate-2026" };
const TITLE = "Tide gauge warm-up";
const CELLS = [
  { cell_type: "markdown" as const, source: "# Tide gauge warm-up\n\nHourly heights from an invented gauge." },
  { cell_type: "code" as const, source: "const heights = [1.2, 1.9, 2.6, 2.1, 1.4, 0.8];\nheights.length" },
  { cell_type: "markdown" as const, source: "## Range" },
  { cell_type: "code" as const, source: "Math.max(...heights) - Math.min(...heights)" },
];
const DEMO_LOCK = 4173002;

/** Creates the three demo people and the notebook they share when they are absent; running it again changes nothing. */
export async function seedDemo(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [DEMO_LOCK]);
    const person = async (who: typeof OWNER): Promise<string> => {
      const found = await queryOne<{ id: string }>(client, "SELECT id FROM users WHERE lower(email) = lower($1)", [who.email]);
      return found?.id ?? (await createUser(client, { ...who, verified: true })).id;
    };
    const owner = await person(OWNER);
    const editor = await person(EDITOR);
    const viewer = await person(VIEWER);
    let notebook = (await queryOne<{ id: string }>(client, "SELECT id FROM notebooks WHERE owner_id = $1 AND title = $2", [owner, TITLE]))?.id;
    if (!notebook) {
      notebook = newId("nb");
      await client.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, $3)", [notebook, owner, TITLE]);
      for (const [position, cell] of CELLS.entries()) await insertCell(client, notebook, position, cell);
    }
    for (const [who, id, role] of [[EDITOR, editor, "editor"], [VIEWER, viewer, "viewer"]] as const) {
      await client.query(
        `INSERT INTO shares (id, notebook_id, email, user_id, role, status, token_hash) VALUES ($1, $2, $3, $4, $5, 'active', $6)
         ON CONFLICT DO NOTHING`,
        [newId("sh"), notebook, who.email, id, role, hashToken(newToken())],
      );
    }
    await markStale(client, notebook);
    await client.query("COMMIT");
    void runIndexer();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
