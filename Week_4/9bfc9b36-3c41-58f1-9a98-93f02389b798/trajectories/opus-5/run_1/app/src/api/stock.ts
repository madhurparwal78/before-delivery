import { queryOne, transact } from '../db/pool';
import { notFound, refuse } from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import { squareFeet, squareMetres } from '../shared/units';
import {
  clothByCode, liveHoldsOn, reader, stockByCode, stockView, type ClothRow, type StockRow,
} from '../domain/model';
import { COUNTER_ACCOUNTS, LEDGER_REASONS, postPair } from '../domain/ledger';
import { Check } from '../domain/validate';
import { audit, nextCode } from '../domain/records';
import { answerWholeList } from './lists';
import { onlyRoles, requireVisible, stockVisible } from './visibility';
import { jsonBody, reply, signedIn, type Ctx, type Reply } from './types';
import { readRevision, requireMatch } from './revisions';

/** Rolls, offcuts, the stock shelf and the shelf count. */

export async function listStock(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker', 'loft-hand']);
  const kind = ctx.query.get('kind');
  const values: unknown[] = [];
  const filters: string[] = [];
  if (kind !== null && kind !== '') {
    values.push(kind);
    filters.push(`kind = $${values.length}`);
  }
  if (caller.role === 'loft-hand') {
    values.push(caller.email);
    filters.push(`cloth_code IN (SELECT cloth_code FROM drawing WHERE assigned_to = $${values.length})`);
  }
  const where = filters.length === 0 ? '' : `WHERE ${filters.join(' AND ')}`;
  const page = await answerWholeList<StockRow, Record<string, unknown>>(
    `SELECT * FROM stock ${where} ORDER BY code ASC`,
    values,
    (row) => stockView(reader, row, ctx.now),
  );
  return reply(200, page);
}

export async function getStock(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const code = ctx.params['code'] as string;
  const row = await stockByCode(reader, code);
  const item = requireVisible(row, row !== null && (await stockVisible(reader, caller, row)));
  const view = await stockView(reader, item, ctx.now);
  return caller.role === 'sailmaker'
    ? reply(200, view, { etag: `"${item.revision}"` })
    : reply(200, view);
}

export async function stockSummary(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker', 'loft-hand']);
  const row = await queryOne<{ rolls: string; offcuts: string; on_hand: string }>(
    `SELECT count(*) FILTER (WHERE kind = 'roll')::text rolls,
            count(*) FILTER (WHERE kind = 'offcut')::text offcuts,
            coalesce(sum(on_hand_mm2),0)::text on_hand FROM stock`,
  );
  const onHand = Number(row?.on_hand ?? '0');
  return reply(200, {
    rolls: Number(row?.rolls ?? '0'),
    offcuts: Number(row?.offcuts ?? '0'),
    on_hand_mm2: onHand,
    on_hand_m2: squareMetres(onHand),
    on_hand_ft2: squareFeet(onHand),
  });
}

export async function receiveRoll(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const lot = check.lot('lot');
  const lengthMm = check.lengthMm('length_mm');
  const shelfLocation = check.text('shelf_location', 1, 40);
  const clothCode = typeof body['cloth_code'] === 'string' ? body['cloth_code'] : '';
  const cloth = await clothByCode(reader, clothCode);
  if (cloth === null) check.fail('cloth_code', FIELD_COPY.cloth);
  check.done();
  const sheet = cloth as ClothRow;

  const created = await transact(async (tx) => {
    const code = await nextCode(tx, 'roll');
    const row = await tx.one<StockRow>(
      `INSERT INTO stock (code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm,
         on_hand_mm2, shelf_location, note, revision)
       VALUES ($1,'roll',$2,$3,$4,$5,$6,0,$7,'',1) RETURNING *`,
      [code, sheet.code, lot, sheet.width_mm, sheet.usable_width_mm, lengthMm, shelfLocation],
    );
    await postPair(tx, ctx.now, {
      stockCode: code,
      stockAmountMm2: sheet.width_mm * lengthMm,
      counterAccount: COUNTER_ACCOUNTS.supplierReceipt,
      actorEmail: caller.email,
      reason: LEDGER_REASONS.rollReceived,
    });
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'stock.receive',
      target: code,
      after: lot,
    });
    return row as StockRow;
  });
  const fresh = (await stockByCode(reader, created.code)) as StockRow;
  return reply(201, await stockView(reader, fresh, ctx.now), { etag: `"${fresh.revision}"` });
}

export async function patchStock(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const row = await stockByCode(reader, code);
  if (row === null) throw notFound();
  const wanted = readRevision(ctx);
  requireMatch(wanted, row.revision);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const shelfLocation = check.text('shelf_location', 1, 40);
  const note = check.text('note', 0, 200);
  check.done();

  const updated = await transact(async (tx) => {
    const next = await tx.one<StockRow>(
      `UPDATE stock SET shelf_location = $2, note = $3, revision = revision + 1
        WHERE code = $1 AND revision = $4 RETURNING *`,
      [code, shelfLocation, note, row.revision],
    );
    if (next === null) throw refuse('stale_revision');
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'stock.update',
      target: code,
      before: row.shelf_location,
      after: shelfLocation,
    });
    return next;
  });
  return reply(200, await stockView(reader, updated, ctx.now), { etag: `"${updated.revision}"` });
}

/** A shelf count either matches the ledger or posts a counted adjustment pair. */
export async function recordCount(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const row = await stockByCode(reader, code);
  if (row === null) throw notFound();
  const holds = await liveHoldsOn(reader, code, ctx.now);
  if (holds.length > 0) throw refuse('wrong_state');

  const body = jsonBody(ctx);
  const check = new Check(body);
  const counted = check.wholeNumber('counted_length_mm', 0, 60000);
  const differs = counted !== row.remaining_mm;
  const reason = differs ? check.reason('reason', FIELD_COPY.countReasonRequired) : '';
  check.done();

  const updated = await transact(async (tx) => {
    const locked = await tx.one<StockRow>('SELECT * FROM stock WHERE code = $1 FOR UPDATE', [code]);
    if (locked === null) throw notFound();
    if (counted !== locked.remaining_mm) {
      await postPair(tx, ctx.now, {
        stockCode: code,
        stockAmountMm2: locked.width_mm * (counted - locked.remaining_mm),
        counterAccount: COUNTER_ACCOUNTS.countAdjustment,
        actorEmail: caller.email,
        reason,
      });
      await tx.query('UPDATE stock SET remaining_mm = $2 WHERE code = $1', [code, counted]);
    }
    await tx.query('UPDATE stock SET last_counted_mm = $2, last_counted_at = $3 WHERE code = $1', [
      code,
      counted,
      ctx.now.toISOString(),
    ]);
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'stock.count',
      target: code,
      before: String(locked.remaining_mm),
      after: String(counted),
      reason: differs ? reason : null,
    });
    return (await tx.one<StockRow>('SELECT * FROM stock WHERE code = $1', [code])) as StockRow;
  });
  return reply(200, await stockView(reader, updated, ctx.now), { etag: `"${updated.revision}"` });
}

export async function listCloths(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker', 'loft-hand']);
  const page = await answerWholeList<ClothRow, Record<string, unknown>>(
    'SELECT * FROM cloth ORDER BY code ASC',
    [],
    (row) => ({
      code: row.code,
      name: row.name,
      weight: row.weight,
      width_mm: row.width_mm,
      usable_width_mm: row.usable_width_mm,
      rate_pence_per_m2: row.rate_pence_per_m2,
    }),
  );
  return reply(200, page);
}

export async function listClosures(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker', 'loft-hand']);
  const page = await answerWholeList<{ closed_on: Date }, Record<string, unknown>>(
    'SELECT closed_on FROM closure ORDER BY closed_on ASC',
    [],
    (row) => ({ closed_on: row.closed_on.toISOString().slice(0, 10) }),
  );
  return reply(200, page);
}
