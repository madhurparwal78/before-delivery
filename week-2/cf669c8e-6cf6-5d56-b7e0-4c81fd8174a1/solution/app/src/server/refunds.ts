/** Taking money back: line refunds drawn on payments, withdrawal, the balance re-spread and the switch to workshop fitting. */
import type { PoolClient } from 'pg';
import type { StageName, User } from '../shared/types.js';
import { one, query, sql, theRow, transaction, type Db } from './db.js';
import { fail, invalid, notFound } from './errors.js';
import type { Reply } from './http.js';
import { KillBillUnreachable, centsOf, ensureAccount, killbillIsUp, refund, type KbTransaction } from './killbill.js';
import { queueMail } from './mail.js';
import { creditNoteMail, vatCorrectionMail } from './mailtext.js';
import { STAGE_LABELS, allocateStages, vatOf, type AllocRow, type LineSpec } from './pricing.js';
import { assembleOrder, lineRows, loadOrder, orderRow, ownOrder, withdrawalIsOpen, type OrderRow } from './orders.js';
import { FIXED, WORKSHOP_RATE } from './catalogue.js';

interface Remaining { stage: StageName; position: number; grossLeft: number; vatLeft: number; paymentId: string | null }
interface DrawRecord { id: string; refund_id: string; order_id: string; stage: StageName; amount_cents: number; vat_cents: number; external_key: string; user_id: string; kb_payment_id: string }

/** What each paid stage still holds for a line: its allocation less pending and returned draws, latest stage first. */
async function remainingFor(db: Db, orderId: string, lineId: string): Promise<Remaining[]> {
  return query<Remaining>(
    db,
    `SELECT a.stage, s.position, a.gross_cents - COALESCE(d.gross, 0) AS "grossLeft", a.vat_cents - COALESCE(d.vat, 0) AS "vatLeft",
            (SELECT p.kb_payment_id FROM payments p WHERE p.order_id = a.order_id AND p.stage = a.stage AND p.outcome = 'success' ORDER BY p.created_at DESC LIMIT 1) AS "paymentId"
     FROM allocations a JOIN stages s ON s.order_id = a.order_id AND s.stage = a.stage
     LEFT JOIN (SELECT rd.stage, SUM(rd.amount_cents) AS gross, SUM(rd.vat_cents) AS vat FROM refund_draws rd JOIN refunds r ON r.id = rd.refund_id
                WHERE r.order_id = $1 AND r.line_id = $2 AND rd.status IN ('pending', 'returned') GROUP BY rd.stage) d ON d.stage = a.stage
     WHERE a.order_id = $1 AND a.line_id = $2 AND s.status = 'paid' ORDER BY s.position DESC`,
    [orderId, lineId],
  );
}

const sumLeft = (rows: Remaining[]): number => rows.reduce((sum, r) => sum + r.grossLeft, 0);

/** Create a refund of `amount` on a line, drawn from the latest payment first. */
async function createRefund(client: PoolClient, row: OrderRow, line: { id: string; vat_rate_pct: number }, amount: number, userId: string, key: string, seq: { next: number }): Promise<void> {
  const refundRow = await theRow<{ id: string }>(client, 'INSERT INTO refunds (order_id, line_id, amount_cents) VALUES ($1,$2,$3) RETURNING id', [row.id, line.id, amount]);
  let left = amount;
  for (const stage of await remainingFor(client, row.id, line.id)) {
    if (left <= 0) break;
    if (stage.grossLeft <= 0) continue;
    const take = Math.min(stage.grossLeft, left);
    const vat = take === stage.grossLeft ? stage.vatLeft : Math.min(vatOf(take, line.vat_rate_pct), stage.vatLeft);
    await query(client, 'INSERT INTO refund_draws (refund_id, order_id, stage, seq, amount_cents, vat_cents, external_key, user_id, kb_payment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      refundRow.id, row.id, stage.stage, seq.next, take, vat, `${userId}:${key}:${seq.next}`, userId, stage.paymentId,
    ]);
    seq.next += 1;
    left -= take;
  }
}

async function anyPending(db: Db, orderId: string): Promise<{ stage: boolean; refund: boolean }> {
  const stage = await one(db, "SELECT 1 FROM stages WHERE order_id = $1 AND status = 'pending'", [orderId]);
  const pending = await one(db, "SELECT 1 FROM refunds WHERE order_id = $1 AND status = 'pending'", [orderId]);
  return { stage: Boolean(stage), refund: Boolean(pending) };
}

export async function requestRefund(user: User, orderId: string, input: Record<string, unknown>, key: string): Promise<Reply> {
  const lineId = input['lineId'];
  const amount = input['amountCents'];
  await transaction(async (client) => {
    const row = await orderRow(client, orderId, true);
    if (!row) throw notFound();
    const line = typeof lineId === 'string' && /^[0-9a-f-]{36}$/i.test(lineId)
      ? await one<{ id: string; code: string; vat_rate_pct: number }>(client, 'SELECT id, code, vat_rate_pct FROM order_lines WHERE id = $1 AND order_id = $2', [lineId, orderId])
      : undefined;
    if (!line) throw notFound();
    const left = sumLeft(await remainingFor(client, orderId, line.id));
    if (row.state === 'quoted' || (row.state === 'withdrawn' && left === 0)) throw fail(409, 'illegal_transition');
    if ((await anyPending(client, orderId)).stage) throw fail(409, 'payment_in_flight');
    if (row.state === 'inspection passed' && line.code.startsWith('INSPECT-')) throw fail(409, 'fee_already_spent');
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) throw invalid({ amountCents: 'Enter a whole number of cents, at least 1.' });
    if (amount > left) throw invalid({ amountCents: 'That is more than this line has collected.' });
    if (!(await killbillIsUp(client))) throw fail(503, 'payments_paused');
    await createRefund(client, row, line, amount, user.id, key, { next: 1 });
  });
  await sendDraws(orderId);
  return { status: 202, body: await loadOrder(sql, orderId) };
}

export async function withdraw(user: User, orderId: string, key: string): Promise<Reply> {
  const done = await transaction(async (client) => {
    const row = await ownOrder(client, user, orderId, true);
    if (['withdrawn', 'fitted', 'inspection passed'].includes(row.state)) throw fail(409, 'illegal_transition');
    if (!withdrawalIsOpen(row)) throw fail(409, 'withdrawal_closed');
    const pending = await anyPending(client, orderId);
    if (pending.stage || pending.refund) throw fail(409, 'payment_in_flight');
    const lines = await lineRows(client, orderId);
    const owed: { line: (typeof lines)[number]; amount: number }[] = [];
    for (const line of lines) {
      const amount = sumLeft(await remainingFor(client, orderId, line.id));
      if (amount > 0) owed.push({ line, amount });
    }
    if (owed.length && !(await killbillIsUp(client))) throw fail(503, 'payments_paused');
    await query(client, "UPDATE orders SET state = 'withdrawn' WHERE id = $1", [orderId]);
    const seq = { next: 1 };
    for (const { line, amount } of owed) {
      await createRefund(client, row, { id: line.id, vat_rate_pct: line.vat_rate_pct }, amount, user.id, key, seq);
    }
    return owed.length;
  });
  if (done) await sendDraws(orderId);
  return { status: 200, body: await loadOrder(sql, orderId) };
}

// ---- sending draws and believing them -----------------------------------------------------------------------------------------

/** Send every unsent draw of an order, in order. A refused draw fails alone; an unreachable Kill Bill leaves the rest for later. */
async function sendDraws(orderId: string): Promise<void> {
  const draws = await query<DrawRecord>(sql, "SELECT id, refund_id, order_id, stage, amount_cents, vat_cents, external_key, user_id, kb_payment_id FROM refund_draws WHERE order_id = $1 AND sent = false AND status = 'pending' ORDER BY seq", [orderId]);
  const owner = await theRow<{ id: string; email: string; name: string }>(sql, 'SELECT u.id, u.email, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1', [orderId]);
  for (const draw of draws) {
    const claimed = await one(sql, "UPDATE refund_draws SET claimed_at = now() WHERE id = $1 AND sent = false AND status = 'pending' AND (claimed_at IS NULL OR claimed_at < now() - interval '20 seconds') RETURNING id", [draw.id]);
    if (!claimed) continue;
    try {
      const accountId = await ensureAccount(owner);
      const sent = await refund(accountId, draw.kb_payment_id, draw.external_key, draw.amount_cents);
      if (sent.kind === 'refused') await settleDraw(draw.id, 'failed');
      else await query(sql, 'UPDATE refund_draws SET sent = true WHERE id = $1', [draw.id]);
    } catch (error) {
      await query(sql, 'UPDATE refund_draws SET claimed_at = NULL WHERE id = $1', [draw.id]);
      if (error instanceof KillBillUnreachable) return;
      throw error;
    }
  }
}

export async function sendUnsentDraws(): Promise<void> {
  if (!(await killbillIsUp(sql))) return;
  const orders = await query<{ order_id: string }>(sql, "SELECT DISTINCT order_id FROM refund_draws WHERE sent = false AND status = 'pending'");
  for (const { order_id } of orders) await sendDraws(order_id);
}

async function settleDraw(drawId: string, outcome: 'returned' | 'failed'): Promise<void> {
  await transaction(async (client) => {
    const draw = await one<{ order_id: string; refund_id: string }>(client, 'SELECT order_id, refund_id FROM refund_draws WHERE id = $1', [drawId]);
    if (!draw) return;
    await orderRow(client, draw.order_id, true);
    const claimed = await one(client, "UPDATE refund_draws SET status = $2, sent = true WHERE id = $1 AND status = 'pending' RETURNING id", [drawId, outcome]);
    if (claimed) await settleRefund(client, draw.refund_id);
  });
}

/** A notification's refund transaction, once the re-read agrees on type, amount and currency. */
export async function applyDrawOutcome(kb: KbTransaction, paymentId: string, outcome: 'success' | 'failed'): Promise<void> {
  const draw = await one<DrawRecord & { status: string }>(sql, "SELECT id, refund_id, order_id, stage, amount_cents, vat_cents, external_key, user_id, kb_payment_id, status FROM refund_draws WHERE external_key = $1", [kb.transactionExternalKey]);
  if (!draw || draw.status !== 'pending' || draw.kb_payment_id !== paymentId || centsOf(kb.amount) !== draw.amount_cents) return;
  await settleDraw(draw.id, outcome === 'success' ? 'returned' : 'failed');
}

/** Once every draw of a refund is settled, the refund reads returned, partly returned or failed, and its effects follow. */
async function settleRefund(client: PoolClient, refundId: string): Promise<void> {
  const draws = await query<{ status: string; amount_cents: number; vat_cents: number }>(client, 'SELECT status, amount_cents, vat_cents FROM refund_draws WHERE refund_id = $1', [refundId]);
  if (draws.some((d) => d.status === 'pending')) return;
  const returned = draws.filter((d) => d.status === 'returned');
  const gross = returned.reduce((s, d) => s + d.amount_cents, 0);
  const vat = returned.reduce((s, d) => s + d.vat_cents, 0);
  const status = returned.length === 0 ? 'failed' : returned.length === draws.length ? 'returned' : 'partly returned';
  const { order_id: orderId, line_id: lineId } = await theRow<{ order_id: string; line_id: string }>(client, 'UPDATE refunds SET status = $2, settled_at = now() WHERE id = $1 RETURNING order_id, line_id', [refundId, status]);
  if (gross === 0) return;
  await query(client, 'UPDATE order_lines SET gross_cents = gross_cents - $2, vat_cents = vat_cents - $3 WHERE id = $1', [lineId, gross, vat]);
  await query(client, 'UPDATE orders SET total_cents = total_cents - $2, vat_cents = vat_cents - $3, partly_refunded = true WHERE id = $1', [orderId, gross, vat]);
  const order = await loadOrder(client, orderId);
  if (order.state !== 'withdrawn') await respread(client, orderId);
  const { email } = await theRow<{ email: string }>(client, 'SELECT u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1', [orderId]);
  const mail = creditNoteMail(order, order.refunds.filter((r) => r.id === refundId)[0]);
  await queueMail(client, `credit:${refundId}`, email, mail.subject, mail.body);
}

// ---- the unpaid balance ---------------------------------------------------------------------------------------------------------

/**
 * Level the unpaid stages again over the unpaid balance (the current total less money confirmed and not returned) and
 * re-allocate them against the current line amounts. Confirmed stages never change.
 */
async function respread(client: PoolClient, orderId: string): Promise<void> {
  const { total_cents: totalCents } = await theRow<{ total_cents: number }>(client, 'SELECT total_cents FROM orders WHERE id = $1', [orderId]);
  const lines = await lineRows(client, orderId);
  const stages = await query<{ stage: StageName; status: string; amount_cents: number }>(client, 'SELECT stage, status, amount_cents FROM stages WHERE order_id = $1 ORDER BY position', [orderId]);
  const returned = await query<{ line_id: string; gross: number; vat: number }>(
    client,
    `SELECT r.line_id, SUM(d.amount_cents) AS gross, SUM(d.vat_cents) AS vat FROM refund_draws d JOIN refunds r ON r.id = d.refund_id
     WHERE d.order_id = $1 AND d.status = 'returned' GROUP BY r.line_id`,
    [orderId],
  );
  const confirmed = stages.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.amount_cents, 0);
  const returnedTotal = returned.reduce((sum, r) => sum + r.gross, 0);
  const unpaid = stages.filter((s) => s.status !== 'paid');
  const balance = totalCents - (confirmed - returnedTotal);
  const each = Math.floor(balance / unpaid.length);
  const extra = balance - each * unpaid.length;
  const amounts = stages.map((s) => s.amount_cents);
  unpaid.forEach((s, i) => { amounts[stages.indexOf(s)] = each + (i < extra ? 1 : 0); });

  const specs: LineSpec[] = lines.map((l) => ({ code: l.code, name: l.name, grossCents: l.gross_cents, vatRatePct: l.vat_rate_pct, vatCents: l.vat_cents }));
  const fixed = new Map<StageName, AllocRow[]>();
  for (const s of stages.filter((x) => x.status === 'paid')) {
    const rows = await query<{ line_id: string; gross_cents: number; vat_cents: number }>(client, 'SELECT line_id, gross_cents, vat_cents FROM allocations WHERE order_id = $1 AND stage = $2', [orderId, s.stage]);
    fixed.set(s.stage, rows.map((r) => ({ stage: s.stage, lineIndex: lines.findIndex((l) => l.id === r.line_id), grossCents: r.gross_cents, vatCents: r.vat_cents })));
  }
  const given = lines.map((l) => {
    const found = returned.find((r) => r.line_id === l.id);
    return { grossCents: found?.gross ?? 0, vatCents: found?.vat ?? 0 };
  });
  const rows = allocateStages(specs, amounts, fixed, given);
  for (const s of unpaid) {
    await query(client, 'UPDATE stages SET amount_cents = $3 WHERE order_id = $1 AND stage = $2', [orderId, s.stage, amounts[stages.indexOf(s)]]);
    await query(client, 'DELETE FROM allocations WHERE order_id = $1 AND stage = $2', [orderId, s.stage]);
  }
  for (const r of rows) {
    await query(client, 'INSERT INTO allocations (order_id, stage, line_id, gross_cents, vat_cents) VALUES ($1,$2,$3,$4,$5)', [orderId, r.stage, lines[r.lineIndex].id, r.grossCents, r.vatCents]);
  }
}

// ---- switching to workshop fitting --------------------------------------------------------------------------------------------------

export async function switchToWorkshop(user: User, orderId: string): Promise<Reply> {
  await transaction(async (client) => {
    const row = await ownOrder(client, user, orderId, true);
    const returned = await one(client, "SELECT 1 FROM refunds WHERE order_id = $1 AND status IN ('returned', 'partly returned')", [orderId]);
    if (row.kind !== 'kit' || row.fulfilment !== 'posted' || !['deposit confirmed', 'instalments running'].includes(row.state) || returned) throw fail(409, 'illegal_transition');
    const pending = await anyPending(client, orderId);
    if (pending.stage || pending.refund) throw fail(409, 'payment_in_flight');

    const before = await assembleOrder(client, row);
    await query(client, "UPDATE order_lines SET code = 'FIT', name = $2, gross_cents = $3 WHERE order_id = $1 AND code = 'POST'", [orderId, FIXED.FIT.name, FIXED.FIT.grossCents]);
    await query(client, 'UPDATE order_lines SET vat_rate_pct = $2 WHERE order_id = $1 AND vat_rate_pct > 0', [orderId, WORKSHOP_RATE]);
    const lines = await lineRows(client, orderId);
    for (const line of lines) await query(client, 'UPDATE order_lines SET vat_cents = $2 WHERE id = $1', [line.id, vatOf(line.gross_cents, line.vat_rate_pct)]);
    const refreshed = await lineRows(client, orderId);
    const total = refreshed.reduce((s, l) => s + l.gross_cents, 0);
    const vat = refreshed.reduce((s, l) => s + l.vat_cents, 0);
    const config = { ...row.config, fulfilment: 'workshop' };
    await query(client, "UPDATE orders SET fulfilment = 'workshop', config = $2, total_cents = $3, vat_cents = $4 WHERE id = $1", [orderId, JSON.stringify(config), total, vat]);

    const corrections: { label: string; before: number; after: number }[] = [];
    for (const stage of before.schedule.filter((s) => s.status === 'paid')) {
      let after = 0;
      for (const alloc of stage.allocations) {
        const rate = refreshed.filter((l) => l.id === alloc.lineId)[0].vat_rate_pct;
        const newVat = vatOf(alloc.grossCents, rate);
        after += newVat;
        await query(client, 'UPDATE allocations SET vat_cents = $4 WHERE order_id = $1 AND stage = $2 AND line_id = $3', [orderId, stage.stage, alloc.lineId, newVat]);
      }
      await query(client, 'UPDATE stages SET vat_corrected_cents = $3 WHERE order_id = $1 AND stage = $2', [orderId, stage.stage, after - stage.vatCents]);
      corrections.push({ label: STAGE_LABELS[stage.stage], before: stage.vatCents, after });
    }
    await respread(client, orderId);
    if (corrections.reduce((s, c) => s + (c.after - c.before), 0) !== 0) {
      const owner = await theRow<{ email: string }>(client, 'SELECT email FROM users WHERE id = $1', [row.user_id]);
      const mail = vatCorrectionMail(before, corrections);
      await queueMail(client, `vat-correction:${orderId}`, owner.email, mail.subject, mail.body);
    }
  });
  return { status: 200, body: await loadOrder(sql, orderId) };
}
