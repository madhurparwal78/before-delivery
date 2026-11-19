// Export job: runs in batches, stores to MinIO, reports progress.

import { Ctx } from '../server.js';
import { clock } from '../db.js';
import { hms } from './summary.js';

export async function runExportJob(app: Ctx, id: number): Promise<unknown> {
  const res = await app.db.query(`SELECT * FROM exports WHERE id = $1`, [id]);
  if (!res.rows.length) return null;
  const row = res.rows[0];
  const batchSize = Number(app.settings.get('EXPORT_BATCH_ROWS') ?? 50);

  await app.db.query(`UPDATE exports SET status = 'running' WHERE id = $1`, [id]);

  const records = await app.db.query(
    `SELECT number, fields FROM records WHERE "table" = $1 ORDER BY number`,
    [row.table],
  );
  const columns = row.columns as string[];
  const lines: string[] = [columns.join(',')];
  let done = 0;
  for (const record of records.rows) {
    const fields = record.fields as Record<string, unknown>;
    const cells = columns.map(c => csvCell(String(fields[c] ?? '')));
    lines.push(cells.join(','));
    done++;
    if (done % batchSize === 0) {
      await app.db.query(`UPDATE exports SET rows_total = $2, rows_done = $3 WHERE id = $1`, [id, records.rows.length, done]);
      app.live.publish(`export:${id}`, 'progress', { id, rows_total: records.rows.length, rows_done: done });
    }
  }
  await app.db.query(`UPDATE exports SET rows_total = $2, rows_done = $3 WHERE id = $1`, [id, records.rows.length, done]);

  await app.db.query(`UPDATE exports SET status = 'storing' WHERE id = $1`, [id]);
  const key = `exports/${id}.csv`;
  const body = Buffer.from(lines.join('\n'), 'utf8');
  const stored = await app.storage.put(key, body, 'text/csv');
  if (!stored) {
    await app.db.query(`UPDATE exports SET status = 'failed', error = 'storage_unavailable' WHERE id = $1`, [id]);
    return { id, status: 'failed', error: 'storage_unavailable' };
  }
  await app.db.query(`UPDATE exports SET status = 'complete', key = $2 WHERE id = $1`, [id, key]);
  app.live.publish(`export:${id}`, 'complete', { id, status: 'complete', rows_total: records.rows.length, rows_done: done });
  void hms;
  void clock;
  return { id, status: 'complete', rows_total: records.rows.length, rows_done: done, key };
}

function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
