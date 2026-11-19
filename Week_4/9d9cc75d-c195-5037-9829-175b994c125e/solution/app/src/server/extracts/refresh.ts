// The extract state machine: live -> refreshing -> live, or refreshing -> refresh_failed (the last good snapshot stays).
import type { Cell } from '../../shared/model.ts';
import type { App } from '../http/app.ts';
import { convertCell, readCsv } from '../sources/csv.ts';
import { syncFields, uploadKey } from '../sources/ingest.ts';
import { getFields, getTables } from '../sources/repo.ts';
import { StorageUnavailable } from '../storage/storage.ts';
import type { TableContent } from './snapshot.ts';
import { readRows, snapshotTables, swapSnapshot } from './snapshot.ts';
import { getExtractRow, publishExtract } from './state.ts';

class RefreshFailed extends Error {}

/** Refreshes per app and source; asking while one runs joins it instead of starting a second. */
const running = new WeakMap<App, Map<string, Promise<void>>>();

export function refreshSource(app: App, sourceId: string): Promise<void> {
  let jobs = running.get(app);
  if (!jobs) {
    jobs = new Map();
    running.set(app, jobs);
  }
  const current = jobs.get(sourceId);
  if (current) return current;
  const job = attempt(app, sourceId).finally(() => jobs.delete(sourceId));
  jobs.set(sourceId, job);
  return job;
}

async function attempt(app: App, sourceId: string): Promise<void> {
  await app.db.exec(`UPDATE extracts SET state = 'refreshing', last_run_at = $2 WHERE source_id = $1`, [
    sourceId,
    app.clock.now(),
  ]);
  await publishExtract(app, sourceId);
  try {
    const forced = await app.db.exec(
      `UPDATE extracts SET forced_failures = forced_failures - 1 WHERE source_id = $1 AND forced_failures > 0`,
      [sourceId],
    );
    if (forced > 0) throw new RefreshFailed();
    const tables = await newContents(app, sourceId);
    await app.db.transaction(async (tx) => {
      await swapSnapshot(tx, sourceId, tables);
      await syncFields(tx, sourceId);
      await tx.exec(`UPDATE extracts SET state = 'live', last_success_at = $2 WHERE source_id = $1`, [
        sourceId,
        app.clock.now(),
      ]);
    });
  } catch (error) {
    if (!(error instanceof RefreshFailed) && !(error instanceof StorageUnavailable)) {
      console.error('refresh failed:', error instanceof Error ? error.message : 'unknown error');
    }
    await app.db.exec(`UPDATE extracts SET state = 'refresh_failed', last_failure_at = $2 WHERE source_id = $1`, [
      sourceId,
      app.clock.now(),
    ]);
    await publishExtract(app, sourceId);
    return;
  }
  await publishExtract(app, sourceId);
  await app.refreshed(sourceId);
}

async function currentFile(app: App, sourceId: string, table: string, sha256: string) {
  const result = readCsv(await app.storage.get(uploadKey(sourceId, table, sha256)), app.config);
  if (!result.ok) throw new RefreshFailed();
  return result.table;
}

/**
 * The tables to swap in. Full: every table's current file. Incremental: the key's table gets the file's rows whose
 * key is above the snapshot's current maximum appended; the rest of the file is ignored and other tables stay.
 */
async function newContents(app: App, sourceId: string): Promise<TableContent[]> {
  const extract = await getExtractRow(app, sourceId);
  const tables = await getTables(app.db, sourceId);
  const keyField =
    extract?.schedule_kind === 'incremental'
      ? (await getFields(app.db, sourceId)).find((f) => f.id === extract.schedule_key)
      : undefined;
  if (!keyField || keyField.column === null) {
    const contents: TableContent[] = [];
    for (const table of tables) {
      const csv = await currentFile(app, sourceId, table.name, table.sha256);
      contents.push({ name: table.name, columns: csv.columns, rows: csv.rows });
    }
    return contents;
  }
  const table = tables.find((t) => t.name === keyField.table);
  const snapshot = (await snapshotTables(app.db, sourceId)).find((t) => t.table_name === keyField.table);
  if (!table || !snapshot) throw new RefreshFailed();
  const rows = await readRows(app.db, snapshot.snapshot_id);
  const keyAt = snapshot.columns.findIndex((c) => c.name === keyField.column);
  const maximum = rows.reduce<number | null>((max, row) => {
    const key = row[keyAt];
    return typeof key === 'number' && (max === null || key > max) ? key : max;
  }, null);
  const csv = await currentFile(app, sourceId, table.name, table.sha256);
  const fileAt = csv.columns.map((c) => c.name);
  const appended: Cell[][] = [];
  for (const record of csv.records) {
    const cells = snapshot.columns.map((column) => {
      const at = fileAt.indexOf(column.name);
      return at === -1 ? null : convertCell(record[at] ?? '', column.type);
    });
    const key = cells[keyAt];
    if (typeof key === 'number' && (maximum === null || key > maximum)) appended.push(cells);
  }
  return [{ name: table.name, columns: snapshot.columns, rows: [...rows, ...appended] }];
}
