// Schema and seed data, applied once and idempotently on every start, under an advisory lock so
// several app processes sharing one database never seed twice.
import { createAccount, createStarterIsland, hashPassword, SEED_ACCOUNTS } from './accounts';
import { now } from './clock';
import type { Db } from './db';
import { SCHEMA } from './schema';

const MIGRATION_LOCK = 7310421;

export async function prepareDatabase(db: Db): Promise<void> {
  await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
  try {
    await db.query(SCHEMA);
    const seeded = await db.query("SELECT 1 FROM app_meta WHERE key = 'seeded'");
    if ((seeded.rowCount ?? 0) > 0) return;
    const hashes = await Promise.all(SEED_ACCOUNTS.map((a) => hashPassword(a.password)));
    await db.query('BEGIN');
    try {
      const at = now();
      const ids = new Map<string, number>();
      for (const [i, a] of SEED_ACCOUNTS.entries()) {
        const id = (await createAccount(db, {
          email: a.email, passwordHash: hashes[i] as string, displayName: a.displayName, timeZone: a.timeZone,
          verified: true, role: a.role, trophies: a.trophies, at,
        })) as number;
        ids.set(a.email, id);
        if (a.role === 'islander') await createStarterIsland(db, id, at);
      }
      const { rows } = await db.query<{ id: number }>(
        "INSERT INTO clans (name, name_lower, motto, created_at) VALUES ('Brackwater Kin', 'brackwater kin', 'We keep the sluice open.', $1) RETURNING id",
        [at],
      );
      const clanId = (rows[0] as { id: number }).id;
      await db.query("INSERT INTO clan_members (account_id, clan_id, role, joined_at) VALUES ($1, $2, 'skipper', $3)", [ids.get('pell@lowtide.test'), clanId, at]);
      await db.query("INSERT INTO clan_members (account_id, clan_id, role, joined_at, mate_since) VALUES ($1, $2, 'mate', $3, $4)", [ids.get('ivo@lowtide.test'), clanId, at + 1, at]);
      await db.query("INSERT INTO app_meta (key, value) VALUES ('seeded', $1)", [String(at)]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
  }
}
