import { jsonResponse, type ApiResponse, type RequestContext } from '../http/context.js';
import {
  conflict,
  mailUnavailable,
  notFound,
  storageUnavailable,
  validationFailed,
} from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { readTrimmed } from '../http/validate.js';
import {
  inTransaction,
  instantOf,
  instantParam,
  isUniqueViolation,
  maybeInstant,
  type Queryable,
} from '../db.js';
import {
  brusselsDate,
  endOfBrusselsMonth,
  formatMonth,
  isValidBrusselsMonth,
  isoSeconds,
  startOfBrusselsDay,
  type BrusselsMonth,
} from '../../shared/brussels.js';
import { isValidIban } from '../domain/iban.js';
import { sepaName } from '../domain/sepaName.js';
import { controlSumCents, renderBankFile, type CreditTransfer } from '../domain/pain001.js';
import { payoutFileKey, StorageUnavailable } from '../services/storage.js';
import { MailUnavailable, type StatementLine } from '../services/mail.js';
import { copy } from '../../shared/copy.js';
import { shop } from '../../shared/shop.js';

interface DueSale {
  saleId: string;
  consignorId: string;
  consignorName: string;
  consignorEmail: string | null;
  consignorIban: string | null;
  shareCents: number;
  soldAt: number;
  tagCode: string;
  description: string;
}

interface PayoutRow {
  id: string;
  consignorId: string;
  consignorName: string;
  iban: string | null;
  amountCents: number;
  status: 'paid' | 'held_back';
  reason: string | null;
}

interface RunRecord {
  month: BrusselsMonth;
  status: string;
  startedAt: number;
  startedById: string;
  startedByName: string;
  readyAt: number | null;
  msgId: string;
  controlSumCents: number;
}

const RUN_SELECT = `
  SELECT r.month, r.status, r.started_at, r.started_by, r.ready_at, r.msg_id,
         r.control_sum_cents, m.name AS started_by_name
    FROM payout_runs r JOIN members m ON m.id = r.started_by`;

function runOf(row: Record<string, unknown>): RunRecord {
  return {
    month: row['month'] as string,
    status: row['status'] as string,
    startedAt: instantOf(row['started_at']),
    startedById: row['started_by'] as string,
    startedByName: row['started_by_name'] as string,
    readyAt: maybeInstant(row['ready_at']),
    msgId: row['msg_id'] as string,
    controlSumCents: Number(row['control_sum_cents']),
  };
}

function runJson(run: RunRecord, payouts: readonly PayoutRow[] | null): unknown {
  return {
    month: run.month,
    status: run.status,
    startedAt: isoSeconds(run.startedAt),
    startedBy: { id: run.startedById, name: run.startedByName },
    readyAt: run.readyAt === null ? null : isoSeconds(run.readyAt),
    msgId: run.msgId,
    controlSumCents: run.controlSumCents,
    ...(payouts === null ? {} : { payouts: payouts.map((payout) => ({ ...payout })) }),
  };
}

async function payoutsOfRun(db: Queryable, month: string): Promise<PayoutRow[]> {
  const { rows } = await db.query(
    `SELECT id, consignor_id, consignor_name, iban, amount_cents, status, reason
       FROM payouts WHERE month = $1 ORDER BY sequence`,
    [month],
  );
  return rows.map((row) => ({
    id: row['id'] as string,
    consignorId: row['consignor_id'] as string,
    consignorName: row['consignor_name'] as string,
    iban: (row['iban'] as string | null) ?? null,
    amountCents: Number(row['amount_cents']),
    status: row['status'] as 'paid' | 'held_back',
    reason: (row['reason'] as string | null) ?? null,
  }));
}

async function loadRun(db: Queryable, month: string): Promise<RunRecord | null> {
  const { rows } = await db.query(`${RUN_SELECT} WHERE r.month = $1`, [month]);
  const row = rows[0];
  return row === undefined ? null : runOf(row);
}

/**
 * A run covers every unrefunded sale in its month with no payout yet, and every unrefunded
 * sale held back in an earlier run and not yet paid. Erased consignors are left out.
 */
async function salesDueFor(db: Queryable, month: BrusselsMonth): Promise<DueSale[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.sold_at, s.consignor_share_cents, p.tag_code, p.description,
            c.id AS consignor_id, c.name AS consignor_name, c.email, c.iban
       FROM sales s
       JOIN pieces p ON p.id = s.piece_id
       JOIN consignors c ON c.id = p.consignor_id
      WHERE s.refunded_at IS NULL
        AND c.status <> 'erased'
        AND NOT EXISTS (
          SELECT 1 FROM payout_sales ps JOIN payouts po ON po.id = ps.payout_id
           WHERE ps.sale_id = s.id AND po.status = 'paid')
        AND (
          (s.sold_at >= $1 AND s.sold_at < $2)
          OR EXISTS (
            SELECT 1 FROM payout_sales ps JOIN payouts po ON po.id = ps.payout_id
             WHERE ps.sale_id = s.id AND po.status = 'held_back')
        )
      ORDER BY s.sold_at, s.id`,
    [instantParam(startOfBrusselsDay(`${month}-01`)), instantParam(endOfBrusselsMonth(month))],
  );
  return rows.map((row) => ({
    saleId: row['id'] as string,
    consignorId: row['consignor_id'] as string,
    consignorName: row['consignor_name'] as string,
    consignorEmail: (row['email'] as string | null) ?? null,
    consignorIban: (row['iban'] as string | null) ?? null,
    shareCents: Number(row['consignor_share_cents']),
    soldAt: instantOf(row['sold_at']),
    tagCode: row['tag_code'] as string,
    description: row['description'] as string,
  }));
}

interface PlannedPayout extends PayoutRow {
  creditorName: string;
  email: string | null;
  lines: StatementLine[];
  saleIds: string[];
}

/** Payouts are numbered from 001 by creditor name, compared by Unicode code point, then id. */
function planPayouts(month: BrusselsMonth, due: readonly DueSale[]): PlannedPayout[] {
  const byConsignor = new Map<string, DueSale[]>();
  for (const sale of due) {
    const found = byConsignor.get(sale.consignorId);
    if (found === undefined) byConsignor.set(sale.consignorId, [sale]);
    else found.push(sale);
  }

  const grouped = [...byConsignor.entries()]
    .map(([consignorId, sales]) => {
      const first = sales[0] as DueSale;
      return {
        consignorId,
        consignorName: first.consignorName,
        creditorName: sepaName(first.consignorName),
        email: first.consignorEmail,
        iban: first.consignorIban,
        amountCents: sales.reduce((sum, sale) => sum + sale.shareCents, 0),
        sales,
      };
    })
    .filter((group) => group.amountCents !== 0)
    .sort((left, right) => {
      if (left.creditorName !== right.creditorName) {
        return left.creditorName < right.creditorName ? -1 : 1;
      }
      return left.consignorId < right.consignorId ? -1 : 1;
    });

  return grouped.map((group, index) => {
    const paid = isValidIban(group.iban);
    return {
      id: `PO-${month}-${String(index + 1).padStart(3, '0')}`,
      consignorId: group.consignorId,
      consignorName: group.consignorName,
      creditorName: group.creditorName,
      iban: group.iban,
      amountCents: group.amountCents,
      status: paid ? 'paid' : 'held_back',
      reason: paid ? null : copy.payoutHeldBack,
      email: group.email,
      lines: group.sales.map((sale) => ({
        tagCode: sale.tagCode,
        description: sale.description,
        soldAt: sale.soldAt,
        shareCents: sale.shareCents,
      })),
      saleIds: group.sales.map((sale) => sale.saleId),
    };
  });
}

async function startRun(ctx: RequestContext, month: BrusselsMonth): Promise<ApiResponse> {
  const existing = await loadRun(ctx.app.db, month);
  if (existing !== null) {
    return jsonResponse(200, { run: runJson(existing, await payoutsOfRun(ctx.app.db, month)) });
  }

  const due = await salesDueFor(ctx.app.db, month);
  const planned = planPayouts(month, due);
  if (!planned.some((payout) => payout.status === 'paid')) {
    throw conflict('nothing_due', copy.payoutRunNothingDue(formatMonth(month)));
  }

  const member = ctx.signedInMember();
  const msgId = `PAYOUT-${month}`;
  const fileKey = payoutFileKey(month);
  const transfers: CreditTransfer[] = planned
    .filter((payout) => payout.status === 'paid')
    .map((payout) => ({
      payoutId: payout.id,
      creditorName: payout.creditorName,
      iban: payout.iban as string,
      amountCents: payout.amountCents,
    }));
  const controlSum = controlSumCents(transfers);

  let fileStored = false;
  try {
    const run = await inTransaction(ctx.app.db, async (tx) => {
      try {
        await tx.query(
          `INSERT INTO payout_runs (month, status, started_at, started_by, msg_id,
                                     control_sum_cents)
           VALUES ($1, 'starting', $2, $3, $4, $5)`,
          [month, instantParam(ctx.now), member.id, msgId, controlSum],
        );
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }

      for (const [index, payout] of planned.entries()) {
        await tx.query(
          `INSERT INTO payouts (id, month, consignor_id, consignor_name, creditor_name, iban,
                                amount_cents, status, reason, sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            payout.id,
            month,
            payout.consignorId,
            payout.consignorName,
            payout.creditorName,
            payout.iban,
            payout.amountCents,
            payout.status,
            payout.reason,
            index + 1,
          ],
        );
        for (const saleId of payout.saleIds) {
          await tx.query(
            `INSERT INTO payout_sales (payout_id, sale_id) VALUES ($1, $2)`,
            [payout.id, saleId],
          );
        }
      }

      const xml = renderBankFile({
        month,
        msgId,
        createdAt: ctx.now,
        executionDate: brusselsDate(ctx.now),
        debtorName: shop.legalName,
        debtorIban: shop.iban,
        transfers,
      });

      try {
        await ctx.app.storage.putObject(fileKey, Buffer.from(xml, 'utf8'), 'application/xml');
        fileStored = true;
        if (!(await ctx.app.storage.objectExists(fileKey))) throw new StorageUnavailable();
      } catch (error) {
        if (error instanceof StorageUnavailable) {
          throw storageUnavailable(copy.payoutRunStorageDown);
        }
        throw error;
      }

      try {
        for (const payout of planned) {
          if (payout.email === null) continue;
          await ctx.app.mailer.sendStatement({
            to: payout.email,
            month,
            lines: payout.lines,
            totalCents: payout.amountCents,
            ibanLast4:
              payout.status === 'paid' ? (payout.iban as string).slice(-4) : null,
          });
        }
      } catch (error) {
        if (error instanceof MailUnavailable) throw mailUnavailable(copy.payoutRunMailDown);
        throw error;
      }

      await tx.query(`UPDATE payout_runs SET status = 'ready', ready_at = $2 WHERE month = $1`, [
        month,
        instantParam(ctx.now),
      ]);
      const { rows } = await tx.query(`${RUN_SELECT} WHERE r.month = $1`, [month]);
      return runOf(rows[0] as Record<string, unknown>);
    });

    if (run === null) {
      const winner = await loadRun(ctx.app.db, month);
      if (winner === null) throw conflict('nothing_due', copy.payoutRunNothingDue(formatMonth(month)));
      return jsonResponse(200, { run: runJson(winner, await payoutsOfRun(ctx.app.db, month)) });
    }
    return jsonResponse(201, { run: runJson(run, await payoutsOfRun(ctx.app.db, month)) });
  } catch (error) {
    if (fileStored) await ctx.app.storage.deleteObject(fileKey).catch(() => undefined);
    throw error;
  }
}

function requireEndedMonth(value: string, now: number): BrusselsMonth {
  if (!isValidBrusselsMonth(value)) {
    throw validationFailed({ month: 'Choose a month as YYYY-MM.' });
  }
  if (now < endOfBrusselsMonth(value)) {
    throw conflict('month_not_ended', `${formatMonth(value)} has not ended yet.`);
  }
  return value;
}

async function runInPath(ctx: RequestContext): Promise<RunRecord> {
  const month = ctx.param('month');
  if (!isValidBrusselsMonth(month)) throw notFound();
  const run = await loadRun(ctx.app.db, month);
  if (run === null) throw notFound();
  return run;
}

export const payoutRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/payout-runs',
    access: 'books',
    handle: async (ctx) => {
      const { rows } = await ctx.app.db.query(`${RUN_SELECT} ORDER BY r.month DESC`);
      return jsonResponse(200, { runs: rows.map((row) => runJson(runOf(row), null)) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/payout-runs',
    access: 'owner',
    handle: async (ctx) => {
      const month = requireEndedMonth(readTrimmed(ctx.json(), 'month'), ctx.now);
      return startRun(ctx, month);
    },
  }),

  route({
    method: 'GET',
    path: '/api/payout-runs/:month',
    access: 'books',
    resolve: runInPath,
    handle: async (ctx, run) =>
      jsonResponse(200, { run: runJson(run, await payoutsOfRun(ctx.app.db, run.month)) }),
  }),

  route({
    method: 'GET',
    path: '/api/payout-runs/:month/file',
    access: 'books',
    resolve: runInPath,
    handle: async (ctx, run) => {
      const stored = await ctx.app.storage.getObject(payoutFileKey(run.month));
      if (stored === null) throw notFound();
      return {
        kind: 'bytes',
        status: 200,
        body: stored.body,
        contentType: 'application/xml',
        headers: {
          'Content-Disposition': `attachment; filename="${run.msgId}.xml"`,
          'Cache-Control': 'no-store',
        },
      };
    },
  }),
];
