import { randomUUID } from 'node:crypto';
import { jsonResponse, type RequestContext } from '../http/context.js';
import { validationFailed } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { inTransaction, instantParam, type Queryable } from '../db.js';
import {
  BadSheetHeader,
  evaluateSheet,
  normalisedName,
  type EvaluatedRow,
  type SheetReading,
} from '../domain/importSheet.js';
import { ladderInForceOn, nextSerial } from '../data/pieces.js';
import { tagCodeForSerial } from '../domain/tagCode.js';
import { brusselsDate, startOfBrusselsDay } from '../../shared/brussels.js';
import { MAX_SPREADSHEET_BYTES } from '../../shared/shop.js';

const BAD_FILE = 'Use the previous tool\u2019s spreadsheet with its own header line.';

async function readSheet(ctx: RequestContext, db: Queryable): Promise<SheetReading> {
  const { rows: consignorRows } = await db.query(
    `SELECT id, name, email FROM consignors WHERE status <> 'erased'`,
  );
  const known = consignorRows.map((row) => ({
    id: row['id'] as string,
    name: row['name'] as string,
    emailLower: ((row['email'] as string | null) ?? null)?.toLowerCase() ?? null,
    normalised: normalisedName(row['name'] as string),
  }));
  const { rows: itemRows } = await db.query(
    `SELECT import_item_no FROM pieces WHERE import_item_no IS NOT NULL`,
  );
  const already = new Set(itemRows.map((row) => row['import_item_no'] as string));

  try {
    return evaluateSheet(ctx.body.toString('utf8'), known, already, brusselsDate(ctx.now));
  } catch (error) {
    if (error instanceof BadSheetHeader) throw validationFailed({ file: BAD_FILE });
    throw error;
  }
}

function previewJson(reading: SheetReading): unknown {
  return {
    rows: reading.rows.map((row) => ({
      row: row.row,
      itemNo: row.itemNo,
      status: row.status,
      consignorName: row.consignorName,
      reason: row.reason,
    })),
    counts: reading.counts,
  };
}

export const importRoutes: CompiledRoute[] = [
  route({
    method: 'POST',
    path: '/api/imports/preview',
    access: 'owner',
    expects: 'csv',
    bodyLimit: MAX_SPREADSHEET_BYTES,
    handle: async (ctx) => jsonResponse(200, previewJson(await readSheet(ctx, ctx.app.db))),
  }),

  route({
    method: 'POST',
    path: '/api/imports',
    access: 'owner',
    expects: 'csv',
    bodyLimit: MAX_SPREADSHEET_BYTES,
    handle: async (ctx) => {
      const result = await inTransaction(ctx.app.db, async (tx) => {
        const reading = await readSheet(ctx, tx);
        const realIds = new Map<string, string>();
        let piecesCreated = 0;
        let consignorsCreated = 0;
        let serial = await nextSerial(tx);

        const bringOver = async (row: EvaluatedRow): Promise<void> => {
          if (row.piece === null || row.consignorKey === null) return;
          let consignorId = realIds.get(row.consignorKey) ?? row.consignorKey;
          if (row.newConsignor !== null && !realIds.has(row.consignorKey)) {
            consignorId = randomUUID();
            realIds.set(row.consignorKey, consignorId);
            await tx.query(
              `INSERT INTO consignors (id, name, email, email_lower, phone, iban, status, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
              [
                consignorId,
                row.newConsignor.name,
                row.newConsignor.email,
                row.newConsignor.email === null ? null : row.newConsignor.email.toLowerCase(),
                row.newConsignor.phone,
                row.newConsignor.iban,
                instantParam(ctx.now),
              ],
            );
            consignorsCreated += 1;
          }

          const ladder = await ladderInForceOn(tx, row.piece.intakeDate);
          if (ladder === null) return;
          const pieceId = randomUUID();
          await tx.query(
            `INSERT INTO pieces (id, serial, tag_code, consignor_id, category, brand, description,
                                 size, condition, asking_price_cents, intake_date, ladder_id,
                                 version, import_item_no, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14)`,
            [
              pieceId,
              serial,
              tagCodeForSerial(serial),
              consignorId,
              row.piece.category,
              row.piece.brand,
              row.piece.description,
              row.piece.size,
              row.piece.condition,
              row.piece.askingPriceCents,
              row.piece.intakeDate,
              ladder.id,
              row.itemNo,
              instantParam(ctx.now),
            ],
          );
          await tx.query(
            `INSERT INTO asking_prices (id, piece_id, asking_price_cents, effective_from)
             VALUES ($1, $2, $3, $4)`,
            [
              randomUUID(),
              pieceId,
              row.piece.askingPriceCents,
              instantParam(startOfBrusselsDay(row.piece.intakeDate)),
            ],
          );
          serial += 1;
          piecesCreated += 1;
        };

        for (const row of reading.rows) {
          if (row.status === 'matched' || row.status === 'new') await bringOver(row);
        }

        return { counts: reading.counts, piecesCreated, consignorsCreated };
      });

      return jsonResponse(200, result);
    },
  }),
];
