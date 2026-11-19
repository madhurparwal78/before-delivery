import { commitSystemChange } from './changes.js';
import { query, withOutlineLock } from './db.js';
import { forgetPurgedSteps } from './history.js';
import { deleteRows } from './rows.js';

/** Removes the rows whose trash window has passed, with the steps that point at them. */
async function sweep(): Promise<void> {
  const rows = await query<{ id: string; owner_id: string }>(
    `select id, owner_id from bullets where purge_at is not null and purge_at <= now()`
  );
  if (rows.length === 0) return;
  const byOwner = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byOwner.get(row.owner_id) ?? [];
    ids.push(row.id);
    byOwner.set(row.owner_id, ids);
  }
  for (const [ownerId, ids] of byOwner) {
    await withOutlineLock(ownerId, async (client) => {
      await forgetPurgedSteps(client, ids);
      await deleteRows(client, ids);
    });
    await commitSystemChange(ownerId, ids);
  }
}

export function startPurgeSweep(): void {
  const run = (): void => {
    void sweep().catch(() => undefined);
  };
  run();
  setInterval(run, 5_000);
}
