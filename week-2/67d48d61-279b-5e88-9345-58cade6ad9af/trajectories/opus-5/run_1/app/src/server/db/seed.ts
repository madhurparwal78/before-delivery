import { ensureCycles } from '../cycles.js';
import { LOCK, pool, tryLock, withTransaction } from './pool.js';
import { SCHEMA_SQL } from './schema.js';
import { SEED_TASKS } from './seed-data.js';

export async function applySchema(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1)', [LOCK.schema]);
    await client.query(SCHEMA_SQL);
  });
}

/** Seeds the show's tasks and the five cycles when the database holds no tasks. */
export async function seedIfEmpty(): Promise<void> {
  await withTransaction(async (client) => {
    if (!(await tryLock(client, LOCK.schema))) return;
    const now = new Date();
    await ensureCycles(client, now);
    const existing = await client.query<{ count: string }>('select count(*) as count from tasks');
    if (Number(existing.rows[0]?.count ?? '0') > 0) return;

    for (const seed of SEED_TASKS) {
      await client.query(
        `insert into tasks (number, title, details, department, label, status, priority,
                            owner, cycle, parent, version, updated_at)
         values ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,1,$10)`,
        [
          seed.number,
          seed.title,
          seed.department,
          seed.label,
          seed.status,
          seed.priority,
          seed.owner,
          seed.cycle,
          seed.parent,
          now,
        ],
      );
    }
    for (const seed of SEED_TASKS) {
      for (const blocker of seed.blockedBy) {
        await client.query('insert into relations (blocker, blocked) values ($1, $2)', [
          blocker,
          seed.number,
        ]);
      }
    }
  });
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
