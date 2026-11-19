/**
 * The old workbook: read by the published format rules, previewed before
 * anything is saved, and kept byte for byte. Text is stored exactly as written.
 */
import { createHash } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import {
  checkHeader,
  decodeUtf8,
  detectDelimiter,
  MATERIALS_LIST_COLUMNS,
  parseCsv,
  WORKBOOK_COLUMNS,
  writeCsv,
} from '../domain/csv.ts';
import { emptyPlacements } from '../domain/layout.ts';
import { isStampNumber } from '../domain/stamp.ts';
import { fail } from '../http/errors.ts';
import type { Ctx, Route } from '../http/context.ts';
import type { Row } from '../present.ts';
import { storageKeys, StorageUnavailable } from '../services/storage.ts';
import { pieceEntry, clientEntry, putEntries } from '../features/indexing.ts';
import { SearchUnavailable } from '../services/search.ts';

type RowStatus = 'new' | 'matched' | 'refused';

interface ReadRow {
  /** Counting records, with the header as row 1. */
  row: number;
  status: RowStatus;
  reason: string | null;
  client: string;
  piece: string;
  stamp: string;
  maker: string;
  year: string;
  material: string;
  notes: string;
}

interface ReadFile {
  rows: ReadRow[];
  counts: { new: number; matched: number; refused: number };
  sha256: string;
  bytes: Uint8Array;
}

/** Reads the file by the published rules, refusing the whole file where stated. */
async function readWorkbook(ctx: Ctx): Promise<ReadFile> {
  const desk = ctx.requireDesk();
  const file = ctx.multipart?.files.find((f) => f.name === 'file');
  if (!file) throw fail.fields({ file: F.required });

  const text = decodeUtf8(file.bytes);
  if (text === null) throw fail.invalid(F.notUtf8);

  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  const header = records[0] ?? [];

  const headerProblem = checkHeader(header);
  if (headerProblem) {
    throw fail.invalid(
      headerProblem.kind === 'extra'
        ? F.unknownColumn(headerProblem.name)
        : F.missingColumn(headerProblem.name),
    );
  }

  const columnAt = (name: string): number => header.indexOf(name);
  const seenStamps = new Set<string>();
  const rows: ReadRow[] = [];
  const counts = { new: 0, matched: 0, refused: 0 };

  for (let i = 1; i < records.length; i += 1) {
    const record = records[i]!;
    const number = i + 1;
    const field = (name: string): string => record[columnAt(name)] ?? '';
    const base = {
      row: number,
      client: field('client'),
      piece: field('piece'),
      stamp: field('stamp'),
      maker: field('maker'),
      year: field('year'),
      material: field('material'),
      notes: field('notes'),
    };

    // The row's checks run in the published order.
    if (record.length !== WORKBOOK_COLUMNS.length) {
      rows.push({ ...base, status: 'refused', reason: F.rowFieldCount(number) });
      counts.refused += 1;
      continue;
    }
    if (!isStampNumber(base.stamp)) {
      rows.push({ ...base, status: 'refused', reason: F.rowBadStamp(number) });
      counts.refused += 1;
      continue;
    }
    if (base.piece.length === 0) {
      rows.push({ ...base, status: 'refused', reason: F.rowNoTitle(number) });
      counts.refused += 1;
      continue;
    }
    if (base.material.length > 0) {
      const known = await ctx.app.db.one<Row>(
        `SELECT code FROM materials WHERE desk_id = $1 AND code = $2`,
        [desk.id, base.material],
      );
      if (!known) {
        rows.push({ ...base, status: 'refused', reason: F.rowNoMaterial(number, base.material) });
        counts.refused += 1;
        continue;
      }
    }

    const held = await ctx.app.db.one<Row>(
      `SELECT id FROM pieces WHERE desk_id = $1 AND stamp_number = $2`,
      [desk.id, base.stamp],
    );
    // A second row in one file with the same stamp is matched.
    const matched = held !== null || seenStamps.has(base.stamp);
    seenStamps.add(base.stamp);
    rows.push({ ...base, status: matched ? 'matched' : 'new', reason: null });
    if (matched) counts.matched += 1;
    else counts.new += 1;
  }

  return {
    rows,
    counts,
    sha256: createHash('sha256').update(file.bytes).digest('hex'),
    bytes: file.bytes,
  };
}

function previewRows(rows: readonly ReadRow[]): Row[] {
  return rows.map((row) => ({
    row: row.row,
    status: row.status,
    reason: row.reason,
    client: row.client,
    piece: row.piece,
    stamp: row.stamp,
    maker: row.maker,
    year: row.year,
    material: row.material,
    notes: row.notes,
  }));
}

export const workbookRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/workbook/preview',
    auth: 'required',
    body: 'workbook',
    async handle(ctx) {
      const read = await readWorkbook(ctx);
      ctx.json(200, { rows: previewRows(read.rows), counts: read.counts });
    },
  },

  {
    method: 'POST',
    pattern: '/api/workbook/save',
    auth: 'required',
    body: 'workbook',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const read = await readWorkbook(ctx);

      // The file is kept byte for byte.
      try {
        await ctx.app.storage.put(
          storageKeys.workbook(desk.id, read.sha256),
          read.bytes,
          'text/csv; charset=utf-8',
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        throw fail.unavailable(F.storeDown);
      }

      const alreadySaved = await ctx.app.db.one<Row>(
        `SELECT sha256 FROM workbook_files WHERE desk_id = $1 AND sha256 = $2`,
        [desk.id, read.sha256],
      );

      let created = 0;
      if (!alreadySaved) {
        for (const row of read.rows) {
          if (row.status !== 'new') continue;
          const clientId = await findOrMakeClient(ctx, desk.id, row.client);
          const piece = await ctx.app.db.one<Row>(
            `INSERT INTO pieces (desk_id, client_id, title, maker, year, stamp_number, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (desk_id, stamp_number) WHERE stamp_number IS NOT NULL
             DO NOTHING RETURNING *`,
            [desk.id, clientId, row.piece, row.maker, row.year, row.stamp, row.notes],
          );
          if (!piece) continue;
          await ctx.app.db.query(
            `INSERT INTO layouts (piece_id, version, placements) VALUES ($1, 1, $2)`,
            [piece.id, JSON.stringify(emptyPlacements())],
          );
          created += 1;
          try {
            await putEntries(ctx.app, [
              pieceEntry(desk.id, String(piece.id), String(piece.title)),
            ]);
          } catch (error) {
            if (!(error instanceof SearchUnavailable)) throw error;
          }
        }
        await ctx.app.db.query(
          `INSERT INTO workbook_files (desk_id, sha256) VALUES ($1,$2)
           ON CONFLICT (desk_id, sha256) DO NOTHING`,
          [desk.id, read.sha256],
        );
      }

      ctx.json(200, {
        created,
        matched: alreadySaved ? read.counts.new + read.counts.matched : read.counts.matched,
        refused: read.counts.refused,
        sha256: read.sha256,
      });
    },
  },

  {
    method: 'GET',
    pattern: '/api/materials-list.csv',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const rows = await ctx.app.db.query<Row>(
        `SELECT p.title, p.notes, c.name AS client_name,
                e.material_code, e.lot, e.hides, m.name AS material_name
           FROM pieces p
           JOIN clients c ON c.id = p.client_id
           LEFT JOIN LATERAL (
             SELECT * FROM estimates e2
              WHERE e2.piece_id = p.id AND e2.state IN ('open','signedOff')
              ORDER BY e2.version DESC LIMIT 1
           ) e ON true
           LEFT JOIN materials m ON m.desk_id = p.desk_id AND m.code = e.material_code
          WHERE p.desk_id = $1 AND p.state <> 'archived' AND c.state IN ('active','closing')
          ORDER BY p.title`,
        [desk.id],
      );

      const table: string[][] = [[...MATERIALS_LIST_COLUMNS]];
      for (const row of rows) {
        table.push([
          String(row.title),
          String(row.client_name),
          row.material_name === null || row.material_name === undefined ? '' : String(row.material_name),
          row.material_code === null || row.material_code === undefined ? '' : String(row.material_code),
          row.lot === null || row.lot === undefined ? '' : String(row.lot),
          row.hides === null || row.hides === undefined ? '' : String(row.hides),
          row.notes === null || row.notes === undefined ? '' : String(row.notes),
        ]);
      }
      ctx.text(200, writeCsv(table), 'text/csv; charset=utf-8', {
        'content-disposition': 'attachment; filename="materials-list.csv"',
      });
    },
  },
];

/** A row's client is matched by its exact name or made new. */
async function findOrMakeClient(ctx: Ctx, deskId: string, name: string): Promise<string> {
  const existing = await ctx.app.db.one<Row>(
    `SELECT id FROM clients WHERE desk_id = $1 AND name = $2 AND state IN ('active','closing')`,
    [deskId, name],
  );
  if (existing) return String(existing.id);
  const made = await ctx.app.db.one<Row>(
    `INSERT INTO clients (desk_id, name, town, language, email) VALUES ($1,$2,'Turin','it',NULL) RETURNING id`,
    [deskId, name],
  );
  try {
    await putEntries(ctx.app, [clientEntry(deskId, String(made!.id), name)]);
  } catch (error) {
    if (!(error instanceof SearchUnavailable)) throw error;
  }
  return String(made!.id);
}
