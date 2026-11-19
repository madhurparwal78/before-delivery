// Uploads, added tables and replaced files. The file is written to object storage first and the database changes
// only after the write is confirmed, so a failed write leaves everything as it was.
import { createHash } from 'node:crypto';
import type { SourceColumn, SourceTable } from '../../shared/model.ts';
import type { Queryable } from '../db/database.ts';
import { newId } from '../db/ids.ts';
import { swapSnapshot, snapshotTables } from '../extracts/snapshot.ts';
import { publishExtract } from '../extracts/state.ts';
import type { App } from '../http/app.ts';
import { HttpError, invalid, notFound } from '../http/errors.ts';
import type { CsvTable } from './csv.ts';
import { readCsv } from './csv.ts';
import { reconcileFields } from './fields.ts';
import { getFields, getSource, getTables, lockSource, saveFields } from './repo.ts';

const MAX_TABLES = 2;
const TABLE_LIMIT_MESSAGE = 'A source holds at most 2 tables.';

export const uploadKey = (sourceId: string, table: string, sha256: string): string =>
  `uploads/${sourceId}/${table}/${sha256}.csv`;

/** The checked file, or 422 `invalid_csv` with the upload error list. */
function parseUpload(app: App, bytes: Buffer): CsvTable {
  const result = readCsv(bytes, app.config);
  if (!result.ok) throw new HttpError(422, { error: 'invalid_csv', errors: result.errors });
  return result.table;
}

async function storeFile(app: App, sourceId: string, table: string, bytes: Buffer): Promise<string> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await app.storage.put(uploadKey(sourceId, table, sha256), bytes, 'text/csv');
  return sha256;
}

/** Reconciles the field list with the snapshot's columns and the relation. */
export async function syncFields(tx: Queryable, sourceId: string): Promise<void> {
  const source = await getSource(tx, sourceId);
  if (!source) throw notFound();
  const tables = await snapshotTables(tx, sourceId);
  const fields = reconcileFields(
    await getFields(tx, sourceId),
    tables.map((t) => ({ name: t.table_name, columns: t.columns })),
    source.relation,
    newId,
  );
  await saveFields(tx, sourceId, fields);
}

function writeTable(tx: Queryable, sourceId: string, table: string, position: number, sha256: string, csv: CsvTable) {
  return tx.exec(
    `INSERT INTO source_tables (source_id, name, position, sha256, row_count, columns)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_id, name)
     DO UPDATE SET sha256 = EXCLUDED.sha256, row_count = EXCLUDED.row_count, columns = EXCLUDED.columns`,
    [sourceId, table, position, sha256, csv.rows.length, JSON.stringify(csv.columns)],
  );
}

/** A new source with its first table, whose snapshot loads at once. Returns the source id. */
export async function createSource(app: App, projectId: string, name: string, table: string, bytes: Buffer) {
  const csv = parseUpload(app, bytes);
  const id = newId();
  const sha256 = await storeFile(app, id, table, bytes);
  await app.db.transaction(async (tx) => {
    await tx.exec(`INSERT INTO sources (id, project_id, name) VALUES ($1, $2, $3)`, [id, projectId, name]);
    await writeTable(tx, id, table, 0, sha256, csv);
    await tx.exec(`INSERT INTO extracts (source_id, snapshot_id, last_success_at) VALUES ($1, $2, $3)`, [
      id,
      newId(),
      app.clock.now(),
    ]);
    await swapSnapshot(tx, id, [{ name: table, columns: csv.columns, rows: csv.rows }]);
    await syncFields(tx, id);
  });
  await publishExtract(app, id);
  return id;
}

/** 422 `errors.table` when the source already holds two tables (or one of that name). */
async function checkNewTable(q: Queryable, sourceId: string, table: string): Promise<number> {
  const tables = await getTables(q, sourceId);
  if (tables.length >= MAX_TABLES || tables.some((t) => t.name === table)) {
    throw invalid({ table: TABLE_LIMIT_MESSAGE });
  }
  return tables.length;
}

/**
 * The source's second table; its snapshot loads at once and the version goes up by one. The source row is locked
 * for the check and the write, so simultaneous additions see each other and only one fits.
 */
export async function addTable(app: App, sourceId: string, table: string, bytes: Buffer): Promise<void> {
  await checkNewTable(app.db, sourceId, table);
  const csv = parseUpload(app, bytes);
  await app.db.transaction(async (tx) => {
    await lockSource(tx, sourceId);
    const position = await checkNewTable(tx, sourceId, table);
    const sha256 = await storeFile(app, sourceId, table, bytes);
    await writeTable(tx, sourceId, table, position, sha256, csv);
    await tx.exec(`UPDATE sources SET version = version + 1 WHERE id = $1`, [sourceId]);
    await swapSnapshot(tx, sourceId, [{ name: table, columns: csv.columns, rows: csv.rows }]);
    await syncFields(tx, sourceId);
  });
  await publishExtract(app, sourceId);
}

/** A new current file for an existing table. The snapshot keeps the old rows until the next refresh. */
export async function replaceTable(app: App, sourceId: string, table: string, bytes: Buffer): Promise<void> {
  const tables = await getTables(app.db, sourceId);
  const existing = tables.find((t) => t.name === table);
  if (!existing) throw notFound();
  const csv = parseUpload(app, bytes);
  const sha256 = await storeFile(app, sourceId, table, bytes);
  await app.db.transaction(async (tx) => {
    await writeTable(tx, sourceId, table, existing.position, sha256, csv);
    await tx.exec(`UPDATE sources SET version = version + 1 WHERE id = $1`, [sourceId]);
  });
}

/** The stored bytes of a table's current file. */
export async function tableFile(app: App, sourceId: string, table: string): Promise<Buffer> {
  const found = (await getTables(app.db, sourceId)).find((t) => t.name === table);
  if (!found) throw notFound();
  return app.storage.get(uploadKey(sourceId, table, found.sha256));
}

/** `{"id","name","version","tables"}`: each table's current file with its columns as fields. */
export async function sourceSummary(q: Queryable, sourceId: string) {
  const source = await getSource(q, sourceId);
  if (!source) throw notFound();
  return { id: source.id, name: source.name, version: source.version, tables: await tableList(q, sourceId) };
}

export async function tableList(q: Queryable, sourceId: string): Promise<SourceTable[]> {
  const fields = await getFields(q, sourceId);
  return (await getTables(q, sourceId)).map((table) => ({
    name: table.name,
    rows: table.row_count,
    sha256: table.sha256,
    columns: fields
      .filter((f) => f.derived === null && f.table === table.name)
      .map(
        (f): SourceColumn => ({ id: f.id, name: f.column ?? f.name, type: f.type, kind: f.kind, continuous: f.continuous }),
      ),
  }));
}
