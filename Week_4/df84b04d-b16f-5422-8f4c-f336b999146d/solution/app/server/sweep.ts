import { commit } from "./commit.js";
import { pool } from "./db.js";
import { dropStepsOf } from "./history.js";

const SWEEP_MS = 5000;

async function sweepOwner(ownerId: string): Promise<void> {
  const owner = { accountId: ownerId, email: "", name: "", hideCompleted: false };
  await commit(owner, ownerId, async (work) => {
    const gone = await work.client.query<{ id: string }>(
      "DELETE FROM bullets WHERE owner_id = $1 AND purge_at <= now() RETURNING id",
      [ownerId],
    );
    const ids = gone.rows.map((row) => row.id);
    if (ids.length === 0) return;
    await dropStepsOf(work.client, ids);
    await work.client.query("DELETE FROM revisions WHERE bullet_id = ANY($1::text[])", [ids]);
    for (const row of work.state.rows.values()) if (row.mirrorOf !== null && ids.includes(row.mirrorOf)) work.state.touched.add(row.id);
    for (const id of ids) work.removed.add(id);
  });
}

export function startSweep(): void {
  setInterval(() => {
    void pool
      .query<{ owner_id: string }>("SELECT DISTINCT owner_id FROM bullets WHERE purge_at <= now()")
      .then(async (owners) => {
        for (const row of owners.rows) await sweepOwner(row.owner_id);
      })
      .catch(() => undefined);
  }, SWEEP_MS);
}
