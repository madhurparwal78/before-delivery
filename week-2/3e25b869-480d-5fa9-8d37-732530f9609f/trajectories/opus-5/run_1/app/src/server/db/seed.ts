import { addDays, torontoDate, torontoLocalToUtc } from '../../shared/toronto.js';
import type { BatchState } from '../../shared/types.js';
import { db, withTransaction } from './pool.js';
import schemaSql from './schema.sql';

type SeedBatch = {
  code: string;
  scent: string;
  pourOffset: number;
  cureDays: number;
  barsCut: number;
  state: BatchState;
  dropOffset: number | null;
};

const SEED_BATCHES: readonly SeedBatch[] = [
  { code: 'B-0412', scent: 'lavender-oat', pourOffset: -35, cureDays: 28, barsCut: 12, state: 'live', dropOffset: -1 },
  { code: 'B-0413', scent: 'smoked-birch', pourOffset: -30, cureDays: 28, barsCut: 10, state: 'scheduled', dropOffset: 7 },
  { code: 'B-0414', scent: 'wild-mint', pourOffset: -3, cureDays: 35, barsCut: 14, state: 'curing', dropOffset: null },
];

const SEED_STAFF = [
  { email: 'maker@paindelune.example', name: 'Odile Arsenault', password: 'lune-maker-2026', role: 'maker' },
  { email: 'finance@paindelune.example', name: 'Samir Boucher', password: 'lune-finance-2026', role: 'finance' },
  { email: 'packing@paindelune.example', name: 'Jade Poirier', password: 'lune-packing-2026', role: 'packing' },
] as const;

function dropInstant(seedDay: string, offset: number): Date {
  const resolved = torontoLocalToUtc(`${addDays(seedDay, offset)}T10:00`);
  if (resolved.kind === 'gap') throw new Error('seed drop time falls in the spring-forward gap');
  return resolved.instant;
}

export async function applySchemaAndSeed(): Promise<void> {
  await db.query(schemaSql);
  await withTransaction(async (client) => {
    const settings = await client.query('SELECT 1 FROM settings');
    if (settings.rowCount === 0) {
      await client.query('INSERT INTO settings (id, packing_cutoff_local) VALUES (1, $1)', ['14:00']);
    }

    const staff = await client.query('SELECT 1 FROM staff');
    if (staff.rowCount === 0) {
      for (const member of SEED_STAFF) {
        await client.query(
          'INSERT INTO staff (email, name, password, role) VALUES ($1, $2, $3, $4)',
          [member.email, member.name, member.password, member.role],
        );
      }
    }

    const batches = await client.query('SELECT 1 FROM batches');
    if (batches.rowCount === 0) {
      const seedDay = torontoDate(new Date());
      for (const batch of SEED_BATCHES) {
        await client.query(
          `INSERT INTO batches (code, scent, state, poured_on, cure_days, bars_cut, drop_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            batch.code,
            batch.scent,
            batch.state,
            addDays(seedDay, batch.pourOffset),
            batch.cureDays,
            batch.barsCut,
            batch.dropOffset === null ? null : dropInstant(seedDay, batch.dropOffset),
          ],
        );
        await client.query(
          `INSERT INTO stock_movements (batch_code, kind, bars, ref)
           VALUES ($1, 'cut', $2, NULL)`,
          [batch.code, Array.from({ length: batch.barsCut }, (_, index) => index + 1)],
        );
      }
    }
  });
}
