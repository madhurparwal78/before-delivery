import { now } from '../clock.js';
import { id, q, q1, tx } from '../db.js';
import { putObject, sha256Hex } from '../storage.js';
import { buildTable, parseCsv, type ParsedCsv } from './csv.js';
import { ensureExtract } from './extract.js';
import { invalidateSource } from './source.js';
import { generatedCsv, ORDERS_CSV, SAMPLE_SOURCE_NAME, STOCKISTS_CSV } from './sample.js';
import type { FieldKind, FieldType, RelationSpec } from '../../shared/types.js';

export function objectKey(sourceId: string, table: string, sha: string): string {
  return `uploads/${sourceId}/${table}/${sha}.csv`;
}

function defaults(type: FieldType): { kind: FieldKind; continuous: boolean } {
  if (type === 'number') return { kind: 'measure', continuous: true };
  if (type === 'date') return { kind: 'dimension', continuous: true };
  return { kind: 'dimension', continuous: false };
}

export interface StoreTableInput {
  sourceId: string;
  projectId: string;
  sourceName: string;
  tableName: string;
  bytes: Uint8Array;
  parsed: ParsedCsv;
  newSource: boolean;
}

export async function storeTable(input: StoreTableInput): Promise<{ rows: number; version: number }> {
  const sha = sha256Hex(input.bytes);
  const key = objectKey(input.sourceId, input.tableName, sha);
  await putObject(key, input.bytes, 'text/csv');

  const table = buildTable(input.parsed);
  const version = await tx(async (client) => {
    if (input.newSource) {
      await client.query('INSERT INTO sources (id, project_id, name, version) VALUES ($1, $2, $3, 1)', [
        input.sourceId,
        input.projectId,
        input.sourceName,
      ]);
    }
    const ordRow = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM source_tables WHERE source_id = $1',
      [input.sourceId],
    );
    const existing = await client.query<{ name: string }>(
      'SELECT name FROM source_tables WHERE source_id = $1 AND name = $2',
      [input.sourceId, input.tableName],
    );
    const ord = existing.rows.length > 0 ? undefined : Number(ordRow.rows[0].count);
    if (existing.rows.length > 0) {
      await client.query(
        'UPDATE source_tables SET rows = $3, sha256 = $4, object_key = $5, columns = $6 WHERE source_id = $1 AND name = $2',
        [input.sourceId, input.tableName, table.rows.length, sha, key, JSON.stringify(table.columns)],
      );
    } else {
      await client.query(
        'INSERT INTO source_tables (source_id, name, ord, rows, sha256, object_key, columns) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [input.sourceId, input.tableName, ord, table.rows.length, sha, key, JSON.stringify(table.columns)],
      );
    }
    const fieldRows = await client.query<{ name: string; ord: number }>(
      'SELECT name, ord FROM fields WHERE source_id = $1',
      [input.sourceId],
    );
    let ordNext = fieldRows.rows.reduce((max, f) => Math.max(max, f.ord), -1) + 1;
    const taken = new Set(fieldRows.rows.map((f) => f.name));
    for (const column of table.columns) {
      if (taken.has(column.name)) continue;
      const d = defaults(column.type);
      await client.query(
        'INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, ord) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id(), input.sourceId, column.name, input.tableName, column.type, d.kind, d.continuous, ordNext],
      );
      taken.add(column.name);
      ordNext += 1;
    }
    await client.query(
      `INSERT INTO snapshots (source_id, table_name, rows, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_id, table_name) DO UPDATE SET rows = $3, updated_at = $4`,
      [input.sourceId, input.tableName, JSON.stringify(table.rows), now()],
    );
    const versionRow = await client.query<{ version: number }>(
      input.newSource
        ? 'SELECT version FROM sources WHERE id = $1'
        : 'UPDATE sources SET version = version + 1 WHERE id = $1 RETURNING version',
      [input.sourceId],
    );
    return versionRow.rows[0].version;
  });
  await ensureExtract(input.sourceId);
  invalidateSource(input.sourceId);
  return { rows: table.rows.length, version };
}

export async function setRelation(sourceId: string, relation: RelationSpec): Promise<void> {
  await q1('UPDATE sources SET relation = $2, version = version + 1 WHERE id = $1', [
    sourceId,
    JSON.stringify(relation),
  ]);
  invalidateSource(sourceId);
}

export async function createSampleSource(
  projectId: string,
  name = SAMPLE_SOURCE_NAME,
  fixedId?: string,
): Promise<string> {
  const sourceId = fixedId ?? id();
  await storeTable({
    sourceId,
    projectId,
    sourceName: name,
    tableName: 'orders',
    bytes: Buffer.from(ORDERS_CSV, 'utf8'),
    parsed: parseCsv(Buffer.from(ORDERS_CSV, 'utf8')),
    newSource: true,
  });
  await storeTable({
    sourceId,
    projectId,
    sourceName: name,
    tableName: 'stockists',
    bytes: Buffer.from(STOCKISTS_CSV, 'utf8'),
    parsed: parseCsv(Buffer.from(STOCKISTS_CSV, 'utf8')),
    newSource: false,
  });
  await setRelation(sourceId, {
    left_table: 'orders',
    left_key: 'Stockist ID',
    right_table: 'stockists',
    right_key: 'Stockist ID',
  });
  await q1('UPDATE sources SET hierarchy = $2 WHERE id = $1', [
    sourceId,
    JSON.stringify({ name: 'Geography', fields: ['Region', 'Stockist'] }),
  ]);
  await q('UPDATE fields SET kind = $2, continuous = false WHERE source_id = $1 AND name = $3', [
    sourceId,
    'dimension',
    'Order',
  ]);
  invalidateSource(sourceId);
  return sourceId;
}

export async function createGeneratedSource(projectId: string, name: string, rows: number): Promise<string> {
  const bytes = Buffer.from(generatedCsv(rows), 'utf8');
  const sourceId = id();
  await storeTable({
    sourceId,
    projectId,
    sourceName: name,
    tableName: 'data',
    bytes,
    parsed: parseCsv(bytes),
    newSource: true,
  });
  return sourceId;
}
