import { config } from "./config.js";
import { SEED_PROPOSALS, migrateAndSeed, one, pool, rows } from "./db.js";
import { createApp, state } from "./http.js";
import { expirySweep } from "./proposals.js";
import { iso, presenceSweep, storedBody } from "./rooms.js";
import { getObject, objectKey, putObject } from "./storage.js";
import { proposalFromStyles, type Span } from "../shared/model.js";
import type { Range } from "../shared/types.js";

const server = createApp();
server.listen(config.port, "0.0.0.0", () => console.log(`Quillmere Drafts listening on port ${config.port}`));

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The database may come up after the app: retry every 2 seconds, answering health 503 meanwhile. */
async function connect(): Promise<void> {
  for (;;) {
    try {
      await migrateAndSeed();
      return;
    } catch (e) {
      console.error("database not ready:", e instanceof Error ? e.message : String(e));
      await wait(2000);
    }
  }
}

/** Seed objects (Services): write any missing one; a seeded proposal counts as saved once storage confirms. */
async function seedObjects(): Promise<void> {
  const pending = new Set(SEED_PROPOSALS.map((p) => p.id));
  for (;;) {
    for (const p of SEED_PROPOSALS) {
      if (!pending.has(p.id)) continue;
      const row = await one<{ revision: number; saved_revision: number }>("SELECT revision, saved_revision FROM proposals WHERE id = $1", [p.id]);
      if (!row || row.revision > 1) { pending.delete(p.id); continue; }
      try {
        if (row.saved_revision === 0 || (await getObject(objectKey(p.id))) === null) {
          const text = p.blocks.map(([, t]) => t).join("\n");
          const proposal = proposalFromStyles(text, p.blocks.map(([style]) => style));
          proposal.spans = (await rows<{ id: string; author_id: string; kind: Span["kind"]; inserted: Range | null; deleted: Range | null; created_at: Date }>(
            "SELECT id, author_id, kind, inserted, deleted, created_at FROM suggestions WHERE proposal_id = $1 AND status = 'open'", [p.id]))
            .map((s) => ({ id: s.id, kind: s.kind, authorId: s.author_id, inserted: s.inserted, deleted: s.deleted, contentDeleted: false, createdAt: iso(s.created_at) }));
          await putObject(objectKey(p.id), storedBody(p.id, 1, proposal));
          await pool.query("UPDATE proposals SET saved_revision = 1 WHERE id = $1 AND revision = 1", [p.id]);
        }
        pending.delete(p.id);
      } catch {
        // storage unreachable: keep serving and retry in 5 seconds
      }
    }
    if (!pending.size) return;
    await wait(5000);
  }
}

await connect();
state.ready = true;
setInterval(() => { expirySweep().catch(() => undefined); presenceSweep(); }, 200);
void seedObjects();
