// Payout runs (DP-29 to DP-33) and the SEPA bank transfer file (DP-30).

import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str } from '../http.js';
import { ApiError } from '../errors.js';
import { sepaName } from '../../shared/sepa.js';
import { ibanPassesMod97 } from '../../shared/iban.js';
import { brusselsMidnight, brusselsDateOf, cutToSecond, toZ } from '../../shared/time.js';
import { eurosPlain } from '../../shared/money.js';
import { SHOP } from '../config.js';
import { statementMail, formatDateTime, formatMonth } from '../mails.js';

const HELD_BACK_REASON = 'No valid IBAN on file \u2014 held back until the next run.';

export const payoutRoutes: Route[] = [
  {
    method: 'GET', pattern: '/api/payout-runs', bodyLimit: 0, auth: 'books',
    handle: async (ctx) => {
      const { rows } = await ctx.services.pool.query(
        'SELECT month, started_at, started_by, ready_at, status, control_sum_cents FROM payout_runs ORDER BY month DESC'
      );
      const runs = [];
      for (const r of rows) {
        const starter = await memberName(ctx, r.started_by);
        runs.push(runJson(r, starter, []));
      }
      sendJson(ctx.res, 200, { runs });
    },
  },
  {
    method: 'POST', pattern: '/api/payout-runs', bodyLimit: 65536, auth: 'owner',
    handle: async (ctx) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const month = str(body.month);
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { month: 'Choose a month.' });
      }
      const now = cutToSecond(new Date());
      // A month must have ended: it ends at 00:00 Brussels on the first of the next month.
      const [y, m] = month.split('-').map(Number) as [number, number];
      const monthEnd = brusselsMidnight(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
      if (now.getTime() < monthEnd.getTime()) {
        throw new ApiError(409, 'month_not_ended', 'That month has not ended yet.');
      }

      // One run per month: two starts at the same moment produce one run (DP-31).
      const created = await withRunLock(ctx, month, async () => {
        const existing = await runOf(ctx, month);
        if (existing) return { run: existing, created: false };
        const due = await payoutsDue(ctx, month);
        const payouts = buildPayouts(month, due);
        if (!payouts.some((p) => p.status === 'paid')) {
          throw new ApiError(409, 'nothing_due', `There is nothing to pay for ${formatMonth(month)}.`);
        }
        await createRun(ctx, month, now, payouts);
        return { run: { month }, created: true };
      });

      if (!created.created) {
        // Answer 200 with that same run, naming who started it and when.
        const run = await loadRun(ctx, month);
        sendJson(ctx.res, 200, { run });
        return;
      }
      const run = await loadRun(ctx, month);
      sendJson(ctx.res, 201, { run });
    },
  },
  {
    method: 'GET', pattern: '/api/payout-runs/:month', bodyLimit: 0, auth: 'books',
    handle: async (ctx) => {
      const run = await loadRun(ctx, ctx.params.month!);
      if (!run) throw new ApiError(404, 'not_found', 'Not found.');
      sendJson(ctx.res, 200, { run });
    },
  },
  {
    method: 'GET', pattern: '/api/payout-runs/:month/file', bodyLimit: 0, auth: 'books',
    handle: async (ctx) => {
      const run = await loadRun(ctx, ctx.params.month!);
      if (!run) throw new ApiError(404, 'not_found', 'Not found.');
      const key = `payouts/PAYOUT-${run.month}.xml`;
      let bytes: Uint8Array;
      try {
        bytes = await ctx.services.storage.get(key);
      } catch {
        throw new ApiError(503, 'storage_unavailable', 'The bank file can\u2019t be loaded right now.');
      }
      ctx.res.writeHead(200, {
        'Content-Type': 'application/xml',
        'Content-Disposition': `attachment; filename="PAYOUT-${run.month}.xml"`,
        'Cache-Control': 'no-store',
      });
      ctx.res.end(Buffer.from(bytes));
    },
  },
];

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}

async function runOf(ctx: RouteContext, month: string): Promise<{ id: string } | null> {
  const { rows } = await ctx.services.pool.query('SELECT month FROM payout_runs WHERE month = $1', [month]);
  return rows[0] ?? null;
}

/** One payout run per month (DP-31). */
async function withRunLock<T>(ctx: RouteContext, month: string, fn: () => Promise<T>): Promise<T> {
  const client = await ctx.services.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payout-run:${month}`]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

interface DueSale {
  saleId: string;
  consignorId: string;
  consignorName: string;
  consignorEmail: string | null;
  consignorIban: string | null;
  shareCents: number;
  tagCode: string;
  description: string;
  soldAt: Date;
  heldBackBefore: boolean;
}

/** Every unrefunded sale of that month, plus unrefunded sales held back earlier and not yet paid. */
async function payoutsDue(ctx: RouteContext, month: string): Promise<DueSale[]> {
  const start = brusselsMidnight(`${month}-01`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const end = brusselsMidnight(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
  const { rows } = await ctx.services.pool.query(`
    SELECT s.id, s.sold_at, s.consignor_share_cents, p.tag_digits, p.description, p.consignor_id,
           c.name AS consignor_name, c.email AS consignor_email, c.iban AS consignor_iban, c.status AS consignor_status
    FROM sales s
    JOIN pieces p ON p.id = s.piece_id
    JOIN consignors c ON c.id = p.consignor_id
    WHERE s.refunded_at IS NULL
      AND c.status <> 'erased'
      AND (
        (s.sold_at >= $1 AND s.sold_at < $2)
        OR EXISTS (
          SELECT 1 FROM payout_sales ps JOIN payouts po ON po.id = ps.payout_id
          WHERE ps.sale_id = s.id AND po.status = 'held_back'
            AND NOT EXISTS (SELECT 1 FROM payout_sales ps2 JOIN payouts po2 ON po2.id = ps2.payout_id WHERE ps2.sale_id = s.id AND po2.status = 'paid')
        )
      )
    ORDER BY c.name, p.tag_digits`, [start, end]);
  return rows.map((r) => ({
    saleId: r.id,
    consignorId: r.consignor_id,
    consignorName: r.consignor_status === 'erased' ? 'Erased consignor' : r.consignor_name,
    consignorEmail: r.consignor_email,
    consignorIban: r.consignor_iban,
    shareCents: r.consignor_share_cents,
    tagCode: r.tag_digits,
    description: r.description,
    soldAt: new Date(r.sold_at),
    heldBackBefore: false,
  }));
}

/**
 * The run is all or nothing: payouts, the bank file in MinIO and every statement
 * mail happen together, and Ready shows only after MinIO has confirmed the file.
 */
async function createRun(ctx: RouteContext, month: string, now: Date, payouts: BuiltPayout[]): Promise<void> {
  const client = await ctx.services.pool.connect();
  const controlSum = payouts.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amountCents, 0);
  const xml = sepaXml(month, now, payouts.filter((p) => p.status === 'paid'));
  const sender = { mailer: ctx.services.mailer, mailFrom: ctx.services.config.mailFrom };

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO payout_runs (month, started_at, started_by, ready_at, status, control_sum_cents)
       VALUES ($1, $2, $3, NULL, 'starting', $4)`,
      [month, now, ctx.member!.id, controlSum]
    );
    for (const p of payouts) {
      await client.query(
        `INSERT INTO payouts (id, month, consignor_id, consignor_name, iban, amount_cents, status, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [p.id, month, p.consignorId, p.consignorName, p.iban, p.amountCents, p.status, p.reason ?? null]
      );
      for (const saleId of p.saleIds) {
        await client.query('INSERT INTO payout_sales (payout_id, sale_id) VALUES ($1, $2)', [p.id, saleId]);
      }
    }
    // Store the bank file first; Ready comes only after MinIO confirms it.
    await ctx.services.storage.put(`payouts/PAYOUT-${month}.xml`, new TextEncoder().encode(xml), 'application/xml');
    // Every statement mail is accepted before the run is Ready.
    for (const p of payouts) {
      if (!p.consignorEmail) continue;
      await statementMail(sender, {
        to: p.consignorEmail,
        month,
        pieces: p.pieces.map((s) => ({
          tagCode: s.tagCode,
          description: s.description,
          saleDate: formatDateTime(s.soldAt),
          share: eurosPlain(s.shareCents),
        })),
        total: eurosPlain(p.amountCents),
        ...(p.status === 'paid' && p.iban ? { paidTo: { lastFour: p.iban.slice(-4) } } : {}),
        ...(p.status === 'held_back' ? { heldBackReason: HELD_BACK_REASON } : {}),
      });
    }
    await client.query("UPDATE payout_runs SET status = 'ready', ready_at = $1 WHERE month = $2", [now, month]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof ApiError) throw err;
    // MinIO or Mailpit failed: nothing is recorded, stored or sent.
    if (isStorageError(err)) {
      throw new ApiError(503, 'storage_unavailable',
        'The payout run didn\u2019t start: the bank file can\u2019t be stored right now. Nothing was paid or sent.');
    }
    throw new ApiError(503, 'mail_unavailable',
      'The payout run didn\u2019t start: statements can\u2019t be sent by mail right now. Nothing was paid or sent.');
  } finally {
    client.release();
  }
}

function isStorageError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  return name.includes('S3') || name.includes('Service') || /storage/i.test(String((err as Error)?.message ?? ''));
}

interface BuiltPayout { id: string; consignorId: string; consignorName: string; consignorEmail: string | null; iban: string | null; amountCents: number; status: 'paid' | 'held_back'; reason: string | null; saleIds: string[]; pieces: DueSale[] }

function buildPayouts(month: string, due: DueSale[]): BuiltPayout[] {
  const byConsignor = new Map<string, DueSale[]>();
  for (const sale of due) {
    const list = byConsignor.get(sale.consignorId) ?? [];
    list.push(sale);
    byConsignor.set(sale.consignorId, list);
  }
  const payouts = [...byConsignor.entries()].map(([consignorId, sales]) => {
    const iban = sales[0]!.consignorIban;
    const valid = iban !== null && ibanPassesMod97(iban);
    return {
      id: '',
      consignorId,
      consignorName: sales[0]!.consignorName,
      consignorEmail: sales[0]!.consignorEmail,
      iban,
      amountCents: sales.reduce((a, s) => a + s.shareCents, 0),
      status: valid ? 'paid' as const : 'held_back' as const,
      reason: valid ? null : HELD_BACK_REASON,
      saleIds: sales.map((s) => s.saleId),
      pieces: sales,
    };
  });
  // Payout ids in creditor-name order by the SEPA name rule, then by consignor id.
  payouts.sort((a, b) => {
    const an = sepaName(a.consignorName), bn = sepaName(b.consignorName);
    if (an !== bn) return an < bn ? -1 : 1;
    return a.consignorId < b.consignorId ? -1 : 1;
  });
  payouts.forEach((p, i) => { p.id = `PO-${month}-${String(i + 1).padStart(3, '0')}`; });
  return payouts;
}

/** ISO 20022 pain.001.001.03 credit transfer file (DP-30). */
function sepaXml(month: string, createdAt: Date, paid: { id: string; consignorName: string; iban: string | null; amountCents: number }[]): string {
  const msgId = `PAYOUT-${month}`;
  const total = paid.reduce((a, p) => a + p.amountCents, 0);
  const date = brusselsDateOf(createdAt);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `  <GrpHdr>`,
    `    <MsgId>${msgId}</MsgId>`,
    `    <CreDtTm>${toZ(createdAt)}</CreDtTm>`,
    `    <NbOfTxs>${paid.length}</NbOfTxs>`,
    `    <CtrlSum>${eurosPlain(total)}</CtrlSum>`,
    `    <InitgPty><Nm>${escapeXml(SHOP.legalName)}</Nm></InitgPty>`,
    `  </GrpHdr>`,
    `  <PmtInf>`,
    `    <PmtInfId>${msgId}</PmtInfId>`,
    `    <PmtMtd>TRF</PmtMtd>`,
    `    <NbOfTxs>${paid.length}</NbOfTxs>`,
    `    <CtrlSum>${eurosPlain(total)}</CtrlSum>`,
    `    <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>`,
    `    <ReqdExctnDt>${date}</ReqdExctnDt>`,
    `    <Dbtr><Nm>${escapeXml(SHOP.legalName)}</Nm></Dbtr>`,
    `    <DbtrAcct><Id><IBAN>${SHOP.iban}</IBAN></Id></DbtrAcct>`,
    `    <DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`,
    `    <ChrgBr>SLEV</ChrgBr>`,
  ];
  for (const p of paid) {
    lines.push(
      `    <CdtTrfTxInf>`,
      `      <PmtId><EndToEndId>${p.id}</EndToEndId></PmtId>`,
      `      <Amt><InstdAmt Ccy="EUR">${eurosPlain(p.amountCents)}</InstdAmt></Amt>`,
      `      <Cdtr><Nm>${escapeXml(sepaName(p.consignorName))}</Nm></Cdtr>`,
      `      <CdtrAcct><Id><IBAN>${p.iban ?? ''}</IBAN></Id></CdtrAcct>`,
      `      <RmtInf><Ustrd>Consignment payout ${formatMonth(month)}</Ustrd></RmtInf>`,
      `    </CdtTrfTxInf>`
    );
  }
  lines.push(`  </PmtInf>`, `</Document>`);
  return lines.join('\n') + '\n';
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function memberName(ctx: RouteContext, id: string): Promise<string> {
  const { rows } = await ctx.services.pool.query<{ name: string }>('SELECT name FROM members WHERE id = $1', [id]);
  return rows[0]?.name ?? 'A member';
}

interface RunRow { month: string; started_at: Date; started_by: string; ready_at: Date | null; status: string; control_sum_cents: number }

function runJson(r: RunRow, starterName: string, payouts: unknown[]): unknown {
  return {
    month: r.month,
    status: 'ready',
    startedAt: toZ(new Date(r.started_at)),
    startedBy: { id: r.started_by, name: starterName },
    readyAt: r.ready_at ? toZ(new Date(r.ready_at)) : null,
    msgId: `PAYOUT-${r.month}`,
    controlSumCents: r.control_sum_cents,
    payouts,
  };
}

async function loadRun(ctx: RouteContext, month: string): Promise<{ month: string } | null> {
  const { rows } = await ctx.services.pool.query<RunRow>(
    'SELECT month, started_at, started_by, ready_at, status, control_sum_cents FROM payout_runs WHERE month = $1', [month]
  );
  const run = rows[0];
  if (!run) return null;
  const starter = await memberName(ctx, run.started_by);
  const { rows: payouts } = await ctx.services.pool.query(
    'SELECT id, consignor_id, consignor_name, iban, amount_cents, status, reason FROM payouts WHERE month = $1 ORDER BY id', [month]
  );
  const payoutJson = payouts.map((p) => ({
    id: p.id,
    consignorId: p.consignor_id,
    consignorName: p.consignor_name,
    iban: p.iban,
    amountCents: p.amount_cents,
    status: p.status,
    reason: p.reason,
  }));
  return runJson(run, starter, payoutJson) as { month: string };
}
