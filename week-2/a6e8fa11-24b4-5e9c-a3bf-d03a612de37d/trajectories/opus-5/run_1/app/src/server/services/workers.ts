import { query, transaction } from '../db';
import { lockWorkbook } from '../domain/season';
import { processPendingExports } from '../domain/exports';
import { sendQueuedMail } from './mail';

interface DueRow {
  id: string;
  name: string;
  station_id: string;
  time_zone: string;
  closes_at_utc: Date;
}

/** Moves in-season workbooks past their cutoff to locked, whether or not anyone is using them. */
async function lockWorkbooksPastCutoff(): Promise<void> {
  const rows = await query<DueRow>(
    `select w.id, w.name, w.station_id, s.time_zone, w.closes_at_utc
     from workbooks w join stations s on s.id = w.station_id
     where w.state = 'in_season' and w.closes_at_utc is not null and w.closes_at_utc <= now()`,
  );
  for (const row of rows) {
    await transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`workbook:${row.id}`]);
      const still = await client.query("select state from workbooks where id = $1 and state = 'in_season'", [row.id]);
      if (still.rows.length === 0) return;
      await lockWorkbook(client, row, row.closes_at_utc.getTime(), row.time_zone);
    });
  }
}

function every(ms: number, work: () => Promise<void>): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (failure) {
      process.stderr.write(`background work failed: ${String(failure)}\n`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, ms).unref();
}

export function startWorkers(): void {
  every(2000, lockWorkbooksPastCutoff);
  every(5000, processPendingExports);
  every(5000, sendQueuedMail);
}
