import { randomUUID } from 'node:crypto';
import { readCsvFile, type CsvFile, type CsvFileProblem } from '../../shared/csv.js';
import { matchImport, type ClosetIdentity } from '../../shared/importmatch.js';
import { normaliseName } from '../../shared/normalise.js';
import type { ImportRow, ImportRun } from '../../shared/types.js';
import { pool, transaction, type Db } from '../db.js';
import { conflict, notFound, storageUnavailable, validationFailed } from '../http/errors.js';
import { declaredBody } from '../http/json.js';
import type { Route } from '../http/pipeline.js';
import { deleteObject, getObject, objectExists, putObject } from '../s3.js';
import { isUuid } from '../store.js';

interface RunRow {
  id: string;
  filename: string;
  bytes: number;
  object_key: string;
  status: 'previewed' | 'committed';
  uploaded_at: Date;
}

interface RowRecord extends ImportRow {
  normalised_name: string | null;
  canonical_category: string | null;
  weight_grams: number | null;
  units_owned: number | null;
  notes: string | null;
  price_cents: number | null;
}

function fileMessage(problem: CsvFileProblem): string {
  switch (problem.kind) {
    case 'unreadable':
      return "This file isn't readable as CSV.";
    case 'duplicate_column':
      return `Duplicate column: ${problem.column}`;
    case 'missing_column':
      return `Missing column: ${problem.column}`;
    default:
      return 'A file can have at most 2000 rows.';
  }
}

function counts(rows: ImportRow[]): ImportRun['counts'] {
  return {
    matched: rows.filter((row) => row.outcome === 'matched').length,
    created: rows.filter((row) => row.outcome === 'created').length,
    rejected: rows.filter((row) => row.outcome === 'rejected').length,
  };
}

function runJson(run: RunRow, rows: ImportRow[] | null): ImportRun {
  const body: ImportRun = {
    id: run.id,
    filename: run.filename,
    bytes: run.bytes,
    uploadedAt: run.uploaded_at.toISOString(),
    status: run.status,
    counts: counts(rows ?? []),
  };
  if (rows !== null) body.rows = rows;
  return body;
}

async function storedCounts(db: Db, importId: string): Promise<ImportRow[]> {
  const result = await db.query<RowRecord>(
    `SELECT row, name, category, outcome, item_id AS "itemId", same_as_row AS "sameAsRow", reason
       FROM import_rows WHERE import_id = $1 ORDER BY row`,
    [importId],
  );
  return result.rows.map((row) => ({
    row: row.row,
    name: row.name,
    category: row.category,
    outcome: row.outcome,
    itemId: row.itemId,
    sameAsRow: row.sameAsRow,
    reason: row.reason,
  }));
}

async function closetIdentities(db: Db): Promise<ClosetIdentity[]> {
  const result = await db.query<{ id: string; normalised_name: string; category: string }>(
    'SELECT id, normalised_name, category FROM items',
  );
  return result.rows.map((row) => ({
    id: row.id,
    normalisedName: row.normalised_name,
    category: row.category,
  }));
}

export const importRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/imports',
    auth: 'owner',
    body: 'csv',
    handler: async (ctx) => {
      const part = ctx.parts.find((candidate) => candidate.name === 'file');
      if (part === undefined || part.bytes.length === 0) {
        throw validationFailed({ file: 'Choose a CSV file.' });
      }
      const importId = randomUUID();
      const key = `imports/${importId}/original.csv`;
      await putObject(key, part.bytes, 'text/csv');
      if (!(await objectExists(key))) throw storageUnavailable();

      const read = readCsvFile(part.bytes);
      if ('problem' in read) {
        await deleteObject(key);
        throw validationFailed({ file: fileMessage(read.problem) });
      }
      const file: CsvFile = read.file;
      const matched = matchImport(file, await closetIdentities(pool));
      const filename = part.filename ?? 'import.csv';
      const run = await transaction(async (db) => {
        const inserted = await db.query<RunRow>(
          `INSERT INTO import_runs (id, filename, bytes, object_key) VALUES ($1, $2, $3, $4)
           RETURNING id, filename, bytes, object_key, status, uploaded_at`,
          [importId, filename, part.bytes.length, key],
        );
        for (const row of matched.rows) {
          const accepted = matched.accepted.get(row.row) ?? null;
          await db.query(
            `INSERT INTO import_rows (import_id, row, name, category, outcome, item_id, same_as_row,
               reason, normalised_name, canonical_category, weight_grams, units_owned, notes, price_cents)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              importId,
              row.row,
              row.name,
              row.category,
              row.outcome,
              row.itemId,
              row.sameAsRow,
              row.reason,
              accepted === null ? null : normaliseName(accepted.name),
              accepted?.category ?? null,
              accepted?.weightGrams ?? null,
              accepted?.unitsOwned ?? null,
              accepted?.notes ?? null,
              accepted?.priceCents ?? null,
            ],
          );
        }
        return inserted.rows[0] as RunRow;
      });
      return { status: 201, json: { import: runJson(run, matched.rows) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/imports',
    auth: 'owner',
    body: 'json',
    handler: async () => {
      const runs = await pool.query<RunRow>(
        `SELECT id, filename, bytes, object_key, status, uploaded_at
           FROM import_runs ORDER BY seq DESC`,
      );
      const imports: ImportRun[] = [];
      for (const run of runs.rows) {
        const summary = runJson(run, null);
        summary.counts = counts(await storedCounts(pool, run.id));
        imports.push(summary);
      }
      return { status: 200, json: { imports } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/imports/:id',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const id = ctx.params['id'] as string;
      if (!isUuid(id)) throw notFound('import');
      const runs = await pool.query<RunRow>(
        `SELECT id, filename, bytes, object_key, status, uploaded_at FROM import_runs WHERE id = $1`,
        [id],
      );
      const run = runs.rows[0];
      if (run === undefined) throw notFound('import');
      return { status: 200, json: { import: runJson(run, await storedCounts(pool, id)) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/imports/:id/commit',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      declaredBody(ctx.body, []);
      const id = ctx.params['id'] as string;
      if (!isUuid(id)) throw notFound('import');
      return transaction(async (db) => {
        const runs = await db.query<RunRow>(
          `SELECT id, filename, bytes, object_key, status, uploaded_at
             FROM import_runs WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const run = runs.rows[0];
        if (run === undefined) throw notFound('import');
        if (run.status === 'committed') {
          throw conflict('import_committed', 'This import was already committed.');
        }
        const stored = await db.query<RowRecord>(
          `SELECT row, name, category, outcome, reason, normalised_name, canonical_category,
                  weight_grams, units_owned, notes, price_cents
             FROM import_rows WHERE import_id = $1 ORDER BY row`,
          [id],
        );
        const closet = new Map(
          (await closetIdentities(db)).map((item) => [
            `${item.normalisedName}\u0000${item.category}`,
            item.id,
          ]),
        );
        const firstRowOf = new Map<string, number>();
        const createdIds = new Map<string, string>();
        const rows: ImportRow[] = [];
        for (const record of stored.rows) {
          if (record.reason !== null) {
            rows.push({
              row: record.row,
              name: record.name,
              category: record.category,
              outcome: 'rejected',
              itemId: null,
              sameAsRow: null,
              reason: record.reason,
            });
            continue;
          }
          const key = `${record.normalised_name}\u0000${record.canonical_category}`;
          const sameAsRow = firstRowOf.get(key) ?? null;
          const existingId = closet.get(key) ?? null;
          if (sameAsRow === null) firstRowOf.set(key, record.row);
          let itemId = existingId;
          let outcome: ImportRow['outcome'] = 'matched';
          if (existingId === null) {
            if (sameAsRow === null) {
              const inserted = await db.query<{ id: string }>(
                `INSERT INTO items (name, normalised_name, category, weight_grams, units_owned, price_cents, notes)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [
                  record.name,
                  record.normalised_name,
                  record.canonical_category,
                  record.weight_grams,
                  record.units_owned,
                  record.price_cents,
                  record.notes ?? '',
                ],
              );
              itemId = (inserted.rows[0] as { id: string }).id;
              createdIds.set(key, itemId);
              outcome = 'created';
            } else {
              itemId = createdIds.get(key) ?? null;
            }
          }
          rows.push({
            row: record.row,
            name: record.name,
            category: record.category,
            outcome,
            itemId,
            sameAsRow,
            reason: null,
          });
        }
        for (const row of rows) {
          await db.query(
            `UPDATE import_rows SET outcome = $3, item_id = $4, same_as_row = $5
              WHERE import_id = $1 AND row = $2`,
            [id, row.row, row.outcome, row.itemId, row.sameAsRow],
          );
        }
        await db.query(`UPDATE import_runs SET status = 'committed' WHERE id = $1`, [id]);
        return {
          status: 200,
          json: { import: runJson({ ...run, status: 'committed' }, rows) },
        };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/imports/:id/original',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const id = ctx.params['id'] as string;
      if (!isUuid(id)) throw notFound('import');
      const runs = await pool.query<RunRow>(
        'SELECT id, filename, bytes, object_key, status, uploaded_at FROM import_runs WHERE id = $1',
        [id],
      );
      const run = runs.rows[0];
      if (run === undefined) throw notFound('import');
      const bytes = await getObject(run.object_key);
      if (bytes === null) throw notFound('import');
      return {
        status: 200,
        bytes,
        contentType: 'text/csv',
        headers: {
          'content-disposition': `attachment; filename="${run.filename.replace(/"/g, '')}"`,
        },
      };
    },
  },
];
