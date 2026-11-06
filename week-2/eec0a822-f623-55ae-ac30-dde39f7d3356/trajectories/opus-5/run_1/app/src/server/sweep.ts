import { lockKey, query, transaction } from './db.js';
import { settleWeek } from './domain/holds.js';
import { deleteObject } from './services/storage.js';

const SWEEP_INTERVAL_MS = 5000;

async function settleLapsedHolds(now: Date): Promise<void> {
  const weeks = await query<{ yacht_id: string; week_start: string }>(
    `SELECT DISTINCT yacht_id, week_start FROM holds
      WHERE status = 'live' AND lapses_at <= $1`,
    [now],
  );
  for (const week of weeks) {
    await transaction((client) => settleWeek(client, week.yacht_id, week.week_start, now));
  }
}

async function endDuePages(now: Date): Promise<void> {
  await query(
    'UPDATE manifest_pages SET ended_at = ends_at WHERE ended_at IS NULL AND ends_at <= $1',
    [now],
  );
  await query(
    'UPDATE broker_pages SET ended_at = ends_at WHERE ended_at IS NULL AND ends_at <= $1',
    [now],
  );
}

async function erasePassportData(now: Date): Promise<void> {
  const due = await query<{ id: string }>(
    'SELECT id FROM charters WHERE erases_at IS NOT NULL AND erases_at <= $1 AND erased_at IS NULL',
    [now],
  );
  for (const charter of due) {
    const guests = await query<{ id: string; photo_key: string | null }>(
      'SELECT id, photo_key FROM guests WHERE charter_id = $1',
      [charter.id],
    );
    for (const guest of guests) {
      if (guest.photo_key !== null) await deleteObject(guest.photo_key);
    }
    await transaction(async (client) => {
      await lockKey(client, 'erase', charter.id);
      await client.query(
        `UPDATE guests SET nationality = NULL, date_of_birth = NULL, passport_number = NULL,
            photo_key = NULL, photo_content_type = NULL
          WHERE charter_id = $1`,
        [charter.id],
      );
      await client.query('UPDATE charters SET erased_at = $2 WHERE id = $1', [charter.id, now]);
    });
  }
}

async function runSweep(): Promise<void> {
  const now = new Date();
  await settleLapsedHolds(now);
  await endDuePages(now);
  await erasePassportData(now);
}

export function startTimedWork(): void {
  const tick = (): void => {
    void runSweep().catch(() => undefined);
  };
  tick();
  setInterval(tick, SWEEP_INTERVAL_MS).unref();
}
