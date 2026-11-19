import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { STATEMENT_FILE_LIMIT, conflict, invalid, unsupportedMediaType } from '../errors.js';
import { copy } from '../copy.js';
import { requireDesk } from '../session.js';
import { hasContentType } from '../http.js';
import { isMoneyString, moneyString, parseMoney } from '../../domain/money.js';
import { readStatement, statementRowKey, StatementRow } from '../../domain/statement.js';
import { contentDisposition, writeCsv } from '../../domain/text.js';
import { instantString, ukDateOf } from '../../domain/time.js';
import { loadHire } from '../data/hires.js';
import { accountLabel, ledgerLines, moneyHeld } from '../data/ledger.js';
import {
  PreviewLists,
  bringInStatement,
  hireExists,
  readPreview,
  recordRefundPaid,
  savePreview,
  seenRowKeys,
} from '../data/payments.js';
import { paymentStateLabel } from '../../domain/payments.js';
import { query } from '../db.js';

function rowJson(row: StatementRow): Record<string, unknown> {
  return {
    row: row.row,
    date: row.date,
    description: row.description,
    amount: moneyString(row.amount),
    balance: moneyString(row.balance),
    reference: row.reference,
  };
}

export const paymentRoutes: Route[] = [
  route(
    'POST',
    '/api/payments/statements/preview',
    'session',
    async (ctx) => {
      const desk = requireDesk(ctx);
      const raw = await ctx.body(STATEMENT_FILE_LIMIT);
      if (!hasContentType(ctx, 'text/csv')) throw unsupportedMediaType();
      const reading = readStatement(raw.toString('utf8'));
      if (!reading.ok) throw invalid(reading.message);
      const seen = await seenRowKeys(desk.id);
      const lists: PreviewLists = { matched: [], unmatched: [], moneyOut: [], alreadySeen: [], refused: reading.refused };
      for (const row of reading.rows) {
        const key = statementRowKey(row);
        if (row.amount < 0) {
          lists.moneyOut.push(row);
          continue;
        }
        if (seen.has(key)) {
          lists.alreadySeen.push(row);
          continue;
        }
        if (row.reference && (await hireExists(desk.id, row.reference))) {
          lists.matched.push(row);
          seen.add(key);
          continue;
        }
        lists.unmatched.push(row);
      }
      const previewId = await savePreview(desk.id, lists);
      ctx.json(200, {
        previewId,
        matched: lists.matched.map(rowJson),
        unmatched: lists.unmatched.map(rowJson),
        moneyOut: lists.moneyOut.map(rowJson),
        alreadySeen: lists.alreadySeen.map(rowJson),
        refused: lists.refused,
      });
    },
    { limit: STATEMENT_FILE_LIMIT },
  ),

  route('POST', '/api/payments/statements/:previewId/bring-in', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const previewId = pathParam(ctx, 'previewId');
    const preview = assertKnown(await readPreview(desk.id, previewId));
    await jsonBody(ctx);
    const answer = await bringInStatement(desk.id, previewId, preview.lists.matched);
    ctx.json(200, { broughtIn: answer.broughtIn, moneyHeld: moneyString(await moneyHeld(desk.id)) });
  }),

  route('GET', '/api/payments', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const rows = await query<{ id: string }>(
      'select id from enquiries where desk_id = $1 order by created_at desc, id',
      [desk.id],
    );
    const bookings = [];
    for (const row of rows) {
      const hire = await loadHire(desk.id, row.id);
      if (!hire || hire.vehicles.length === 0) continue;
      bookings.push({
        id: hire.id,
        reference: hire.reference,
        customerName: hire.customer.name,
        paymentState: hire.paymentState,
        paid: moneyString(hire.paid),
        owed: moneyString(hire.owed),
        credit: moneyString(hire.credit),
      });
    }
    ctx.json(200, { moneyHeld: moneyString(await moneyHeld(desk.id)), bookings });
  }),

  route('GET', '/api/hires/:id/ledger', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const lines = await ledgerLines(desk.id, hire.id);
    ctx.json(200, {
      lines: lines.map((line) => ({
        id: line.id,
        movementId: line.movementId,
        account: line.account,
        amount: moneyString(line.amount),
        at: instantString(line.at),
        vehicleId: line.vehicleId,
      })),
      sum: moneyString(lines.reduce((total, line) => total + line.amount, 0)),
    });
  }),

  route('POST', '/api/hires/:id/refunds', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
    const vehicle = hire.vehicles.find((held) => held.id === vehicleId);
    if (!vehicle) throw invalid('Choose a vehicle.', { vehicleId: 'Choose a vehicle.' });
    if (!isMoneyString(body.amount)) throw invalid(copy.enterAmount, { amount: copy.enterAmount });
    const amount = parseMoney(body.amount);
    if (amount <= 0 || amount > vehicle.refundsDue) {
      throw conflict('aboveRefundsDue', 'That is above what is due.');
    }
    await recordRefundPaid(desk.id, hire.id, vehicle.id, amount);
    const lines = await ledgerLines(desk.id, hire.id);
    ctx.json(201, {
      lines: lines.slice(-2).map((line) => ({
        id: line.id,
        movementId: line.movementId,
        account: line.account,
        amount: moneyString(line.amount),
        at: instantString(line.at),
        vehicleId: line.vehicleId,
      })),
    });
  }),

  route('GET', '/api/payments/download', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    ctx.send(200, await paymentsCsv(desk.id, null), {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition('payments.csv'),
    });
  }),

  route('GET', '/api/hires/:id/payments/download', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    ctx.send(200, await paymentsCsv(desk.id, hire.id), {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition(`${hire.customer.name} payments.csv`),
    });
  }),
];

async function paymentsCsv(deskId: string, hireId: string | null): Promise<string> {
  const lines = await ledgerLines(deskId, hireId ?? undefined);
  const rows: string[][] = [];
  const seatsOf = new Map<string, number>();
  const vehicles = await query<{ id: string; seats: number }>('select id, seats from vehicles where desk_id = $1', [
    deskId,
  ]);
  for (const vehicle of vehicles) seatsOf.set(vehicle.id, Number(vehicle.seats));
  const names = new Map<string, string>();
  const hires = await query<{ id: string; name: string }>(
    `select e.id, c.name from enquiries e join customers c on c.desk_id = e.desk_id and c.id = e.customer_id
     where e.desk_id = $1`,
    [deskId],
  );
  for (const hire of hires) names.set(hire.id, hire.name);
  const byHire = await query<{ id: string; hire_id: string }>(
    'select id, hire_id from ledger_lines where desk_id = $1',
    [deskId],
  );
  const hireOf = new Map(byHire.map((row) => [String(row.id), row.hire_id]));
  for (const line of lines) {
    const reference = hireOf.get(line.id) ?? '';
    rows.push([
      ukDateOf(line.at),
      reference,
      names.get(reference) ?? '',
      line.vehicleId ? String(seatsOf.get(line.vehicleId) ?? '') : '',
      accountLabel(line.account),
      moneyString(line.amount),
      line.description,
    ]);
  }
  return writeCsv(['Date', 'Reference', 'Customer', 'Vehicle', 'Account', 'Amount', 'Description'], rows);
}

export { paymentStateLabel };
