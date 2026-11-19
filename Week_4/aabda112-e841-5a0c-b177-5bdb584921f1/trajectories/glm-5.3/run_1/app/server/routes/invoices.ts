import express from 'express';
import crypto from 'node:crypto';
import { q, one, pool } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { currentUser, handler, requireRole } from '../core.js';
import * as bus from '../live.js';
import { lineAmounts } from '../domain/money.js';
import { planDraw } from '../domain/stock.js';

export const router = express.Router();

const READ_ROLES = ['front-desk', 'vet', 'manager'];
const WRITE_ROLES = ['vet', 'manager'];
const MONEY_ROLES = ['front-desk', 'manager'];

async function loadInvoice(id: string, clinicId: string) {
  return one(
    `select * from invoices where id = $1 and clinic_id = $2`,
    [id, clinicId]
  );
}

export async function invoicePayload(id: string, clinicId: string) {
  const inv = await loadInvoice(id, clinicId);
  if (!inv) return null;
  const lines = await q(
    `select * from invoice_lines where invoice_id = $1 order by position`,
    [id]
  );
  const payments = await q(
    `select p.*, u.name as taker from invoice_payments p
     left join users u on u.id = p.taken_by
     where p.invoice_id = $1 order by p.at`,
    [id]
  );
  const voider = inv.voided_by
    ? await one(`select id, name from users where id = $1`, [inv.voided_by])
    : null;
  const total = lines.rows.reduce((s: number, l: any) => s + l.total_pence, 0);
  const paid = payments.rows.reduce((s: number, p: any) => s + p.pence, 0);
  return {
    id: inv.id,
    number: inv.number,
    patientId: inv.patient_id,
    patientName: (await one(`select name from patients where id = $1`, [inv.patient_id]))?.name,
    status: inv.status,
    discountPercent: inv.discount_percent,
    lines: lines.rows.map((l: any) => ({
      id: l.id,
      stockItemId: l.stock_item_id,
      description: l.description,
      quantity: l.quantity,
      unitPricePence: l.unit_price_pence,
      netPence: l.net_pence,
      discountPence: l.discount_pence,
      vatPence: l.vat_pence,
      totalPence: l.total_pence,
    })),
    totalPence: total,
    paidPence: paid,
    balancePence: total - paid,
    payments: payments.rows.map((p: any) => ({
      id: p.id,
      pence: p.pence,
      at: new Date(p.at).toISOString(),
      takenBy: p.taken_by ? { id: p.taken_by, name: p.taker } : null,
    })),
    voidedBy: voider,
    voidedAt: inv.voided_at ? new Date(inv.voided_at).toISOString() : null,
    voidReason: inv.void_reason ?? null,
  };
}

router.get('/invoices', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, READ_ROLES);
  const filter = typeof req.query.status === 'string' ? req.query.status : null;
  const r = await q(
    `select i.*, p.name as patient_name,
       (select coalesce(sum(l.total_pence),0) from invoice_lines l where l.invoice_id = i.id) as total,
       (select coalesce(sum(p.pence),0) from invoice_payments p where p.invoice_id = i.id) as paid
     from invoices i join patients p on p.id = i.patient_id
     where i.clinic_id = $1 order by i.created_at desc`,
    [user.clinicId]
  );
  let invoices = r.rows.map((row: any) => ({
    id: row.id,
    number: row.number,
    patientName: row.patient_name,
    status: row.status,
    totalPence: Number(row.total),
    balancePence: Number(row.total) - Number(row.paid),
  }));
  if (filter) invoices = invoices.filter((i: any) => i.status === filter);
  return { status: 200, body: { invoices } };
}));

router.post('/invoices', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, WRITE_ROLES);
  const { patientId, appointmentId } = req.body ?? {};
  if (typeof patientId !== 'string') throw validationError('patientId');
  const patient = await one(
    `select id from patients where id = $1 and clinic_id = $2`,
    [patientId, user.clinicId]
  );
  if (!patient) throw t('not_found');
  if (appointmentId !== undefined && appointmentId !== null) {
    if (typeof appointmentId !== 'string') throw notValid('appointmentId');
    const appt = await one(
      `select id from appointments where id = $1 and clinic_id = $2`,
      [appointmentId, user.clinicId]
    );
    if (!appt) throw t('not_found');
    const existing = await one(
      `select id from invoices where appointment_id = $1 and clinic_id = $2 and status <> 'voided'`,
      [appointmentId, user.clinicId]
    );
    if (existing) throw t('invoice_exists');
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    const seq = await client.query(
      `update clinics set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq`,
      [user.clinicId]
    );
    const number = `INV-${String(seq.rows[0].invoice_seq).padStart(4, '0')}`;
    const created = await client.query(
      `insert into invoices (clinic_id, patient_id, appointment_id, number)
       values ($1, $2, $3, $4) returning id`,
      [user.clinicId, patientId, appointmentId ?? null, number]
    );
    await client.query('commit');
    bus.pushClinic(user.clinicId, 'invoices', {});
    return { status: 201, body: await invoicePayload(created.rows[0].id, user.clinicId) };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}));

router.get('/invoices/:id', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, READ_ROLES);
  const inv = await loadInvoice(req.params.id, user.clinicId);
  if (!inv) throw t('not_found');
  return { status: 200, body: await invoicePayload(inv.id, user.clinicId) };
}));

// Idempotency: the stored response of a remembered key replays.
async function idempotencyCheck(req: express.Request, clinicId: string): Promise<any | null> {
  const key = req.headers['idempotency-key'];
  if (!key || typeof key !== 'string') return null;
  const row = await one(
    `select * from idempotency_keys where clinic_id = $1 and key = $2`,
    [clinicId, key]
  );
  if (!row) return { key };
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
  if (row.method !== req.method || row.path !== req.path || row.body_hash !== bodyHash) {
    throw t('idempotency_key_reused');
  }
  return { key, stored: row };
}

async function rememberKey(clinicId: string, key: string, req: express.Request, status: number, body: any): Promise<void> {
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
  await q(
    `insert into idempotency_keys (key, clinic_id, method, path, body_hash, status, response, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (clinic_id, key) do nothing`,
    [key, clinicId, req.method, req.path, bodyHash, status, JSON.stringify(body)]
  );
}

router.post('/invoices/:id/lines', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, WRITE_ROLES);
  const inv = await loadInvoice(req.params.id, user.clinicId);
  if (!inv) throw t('not_found');
  const replay = await idempotencyCheck(req, user.clinicId);
  if (replay?.stored) return { status: replay.stored.status, body: replay.stored.response };
  const { stockItemId, quantity } = req.body ?? {};
  if (typeof stockItemId !== 'string') throw validationError('stockItemId');
  const item = await one(
    `select * from stock_items where id = $1 and clinic_id = $2`,
    [stockItemId, user.clinicId]
  );
  if (!item) throw t('not_found');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw notValid('quantity');
  }
  if (inv.status !== 'draft') throw t('invoice_not_draft');

  const draws = await drawStock(user.clinicId, item.id, quantity);
  if (draws === null) {
    const usable = await usableOf(item.id);
    throw t('insufficient_stock', { N: usable, Item: item.name, field: 'quantity' });
  }
  const amounts = lineAmounts(quantity, item.unit_price_pence, inv.discount_percent);
  const pos = await one(
    `select coalesce(max(position),0)::int + 1 as p from invoice_lines where invoice_id = $1`,
    [inv.id]
  );
  const line = await one(
    `insert into invoice_lines (invoice_id, stock_item_id, description, quantity, unit_price_pence,
      net_pence, discount_pence, vat_pence, total_pence, position)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [inv.id, item.id, item.name, quantity, item.unit_price_pence, amounts.net, amounts.discount,
     amounts.vat, amounts.total, pos.p]
  );
  await q(`update invoice_lines set discount_pence = $1, vat_pence = $2, total_pence = $3 where id = $4`,
    [amounts.discount, amounts.vat, amounts.total, line.id]);
  const body = await invoicePayload(inv.id, user.clinicId);
  if (replay?.key) await rememberKey(user.clinicId, replay.key, req, 201, body);
  bus.pushClinic(user.clinicId, 'invoices', {});
  bus.pushClinic(user.clinicId, 'stock', {});
  return { status: 201, body };
}));

router.delete('/invoices/:id/lines/:lineId', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, WRITE_ROLES);
  const inv = await loadInvoice(req.params.id, user.clinicId);
  if (!inv) throw t('not_found');
  if (inv.status !== 'draft') throw t('invoice_not_draft');
  const line = await one(
    `select * from invoice_lines where id = $1 and invoice_id = $2`,
    [req.params.lineId, inv.id]
  );
  if (!line) throw t('not_found');
  await returnDraws(inv.id, line.id, user.userId);
  await q(`delete from invoice_lines where id = $1`, [line.id]);
  const body = await invoicePayload(inv.id, user.clinicId);
  bus.pushClinic(user.clinicId, 'invoices', {});
  bus.pushClinic(user.clinicId, 'stock', {});
  return { status: 200, body };
}));

// A removal or void returns each draw to its own batch through a paired movement.
export async function returnDraws(invoiceId: string, lineId: string, byUserId: string | null): Promise<void> {
  const draws = await q(
    `select m.*, b.item_id from stock_movements m
     join stock_batches b on b.id = m.batch_id
     where m.invoice_line_id = $1 and m.reason = 'invoice-line'
     order by m.at`,
    [lineId]
  );
  for (const d of draws.rows) {
    const paired = await one(
      `select id from stock_movements where paired_movement_id = $1`,
      [d.id]
    );
    if (paired) continue;
    const bal = await one(
      `select coalesce(sum(m.delta),0)::int as b from stock_movements m
       join stock_batches b2 on b2.id = m.batch_id where b2.item_id = $1`,
      [d.item_id]
    );
    await q(
      `insert into stock_movements (item_id, batch_id, delta, reason, invoice_line_id, paired_movement_id, balance_after, by)
       values ($1, $2, $3, 'return', $4, $5, $6, $7)`,
      [d.item_id, d.batch_id, -d.delta, lineId, d.id, bal.b - d.delta, byUserId]
    );
  }
}

// The one place that decides the invoice state edges.
function invoiceTransition(inv: any, action: string): string {
  const status = inv.status;
  if (action === 'issue') {
    if (status !== 'draft') throw t('invoice_not_draft');
    return 'issued';
  }
  if (action === 'pay') {
    if (status === 'draft') throw t('invoice_not_issued');
    if (status === 'paid' || status === 'voided') throw t('invoice_closed');
    return 'part-paid';
  }
  if (action === 'void') {
    if (status === 'voided') throw t('invoice_closed');
    return 'voided';
  }
  throw t('invoice_closed');
}

router.patch('/invoices/:id', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, WRITE_ROLES);
  const inv = await loadInvoice(req.params.id, user.clinicId);
  if (!inv) throw t('not_found');
  if (inv.status !== 'draft') throw t('invoice_not_draft');
  const { discountPercent } = req.body ?? {};
  if (typeof discountPercent !== 'number' || !Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw notValid('discountPercent');
  }
  await q(`update invoices set discount_percent = $1 where id = $2`, [discountPercent, inv.id]);
  const lines = await q(`select * from invoice_lines where invoice_id = $1 order by position`, [inv.id]);
  for (const line of lines.rows) {
    const amounts = lineAmounts(line.quantity, line.unit_price_pence, discountPercent);
    await q(
      `update invoice_lines set net_pence = $1, discount_pence = $2, vat_pence = $3, total_pence = $4 where id = $5`,
      [amounts.net, amounts.discount, amounts.vat, amounts.total, line.id]
    );
  }
  const body = await invoicePayload(inv.id, user.clinicId);
  bus.pushClinic(user.clinicId, 'invoices', {});
  return { status: 200, body };
}));

router.post('/invoices/:id/issue', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, WRITE_ROLES);
  const inv = await loadInvoice(req.params.id, user.clinicId);
  if (!inv) throw t('not_found');
  invoiceTransition(inv, 'issue');
  const lines = await one(`select count(*)::int as c from invoice_lines where invoice_id = $1`, [inv.id]);
  if (lines.c === 0) throw t('no_lines', { field: 'lines' });
  await q(`update invoices set status = 'issued' where id = $1`, [inv.id]);
  const body = await invoicePayload(inv.id, user.clinicId);
  bus.pushClinic(user.clinicId, 'invoices', {});
  return { status: 200, body };
}));

router.post('/invoices/:id/payments', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, MONEY_ROLES);
  const inv = await loadInvoice(req.params.id, user.clinicId);
  if (!inv) throw t('not_found');
  const replay = await idempotencyCheck(req, user.clinicId);
  if (replay?.stored) return { status: replay.stored.status, body: replay.stored.response };
  const { pence } = req.body ?? {};
  if (typeof pence !== 'number' || !Number.isInteger(pence) || pence < 1) {
    throw notValid('pence');
  }
  invoiceTransition(inv, 'pay');
  const body0 = await invoicePayload(inv.id, user.clinicId);
  if (pence > body0.balancePence) throw t('payment_too_large', { field: 'pence' });
  await q(
    `insert into invoice_payments (invoice_id, pence, taken_by, at) values ($1, $2, $3, $4)`,
    [inv.id, pence, user.userId, clockNow()]
  );
  const newBalance = body0.balancePence - pence;
  const nextStatus = newBalance === 0 ? 'paid' : 'part-paid';
  await q(`update invoices set status = $1 where id = $2`, [nextStatus, inv.id]);
  const body = await invoicePayload(inv.id, user.clinicId);
  if (replay?.key) await rememberKey(user.clinicId, replay.key, req, 201, body);
  bus.pushClinic(user.clinicId, 'invoices', {});
  return { status: 201, body };
}));

router.post('/invoices/:id/void', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, MONEY_ROLES);
  const inv = await loadInvoice(req.params.id, user.clinicId);
  if (!inv) throw t('not_found');
  // has-payments is checked before the reason
  const hasPayments = await one(
    `select count(*)::int as c from invoice_payments where invoice_id = $1`,
    [inv.id]
  );
  if (inv.status === 'voided') throw t('invoice_closed');
  if (inv.status === 'paid' || hasPayments.c > 0) throw t('invoice_has_payments');
  const { reason } = req.body ?? {};
  if (typeof reason !== 'string' || reason.trim() === '' || reason.trim().length > 200) {
    throw validationError('reason');
  }
  const lines = await q(`select id from invoice_lines where invoice_id = $1`, [inv.id]);
  for (const line of lines.rows) {
    await returnDraws(inv.id, line.id, user.userId);
  }
  await q(
    `update invoices set status = 'voided', voided_by = $1, voided_at = $2, void_reason = $3 where id = $4`,
    [user.userId, clockNow(), reason.trim(), inv.id]
  );
  const body = await invoicePayload(inv.id, user.clinicId);
  bus.pushClinic(user.clinicId, 'invoices', {});
  bus.pushClinic(user.clinicId, 'stock', {});
  return { status: 200, body };
}));

export async function usableOf(itemId: string): Promise<number> {
  const r = await q(
    `select b.expires_on, coalesce(sum(m.delta),0) as remaining from stock_batches b
     join stock_movements m on m.batch_id = b.id
     where b.item_id = $1 group by b.id, b.expires_on, b.received_order order by b.received_order`,
    [itemId]
  );
  const { batchUsable, fmtDate } = await import('../domain/stock.js');
  let usable = 0;
  for (const row of r.rows) {
    if (batchUsable(fmtDate(row.expires_on)) && Number(row.remaining) > 0) usable += Number(row.remaining);
  }
  return usable;
}

// drawStock writes one invoice-line movement per batch, FEFO, in draw order.
export async function drawStock(clinicId: string, itemId: string, quantity: number): Promise<{ draws: { movementId: string; batchId: string; qty: number }[] } | null> {
  const batches = await q(
    `select b.*, coalesce(sum(m.delta),0)::int as remaining from stock_batches b
     left join stock_movements m on m.batch_id = b.id
     where b.item_id = $1 group by b.id, b.batch, b.expires_on, b.received_order
     order by b.received_order`,
    [itemId]
  );
  const { planDraw, fmtDate } = await import('../domain/stock.js');
  const plan = planDraw(
    batches.rows.map((b: any) => ({
      id: b.id, batch: b.batch, expiresOn: fmtDate(b.expires_on),
      remaining: Number(b.remaining), receivedOrder: b.received_order,
    })),
    quantity
  );
  if (!plan) return null;
  const draws: { movementId: string; batchId: string; qty: number }[] = [];
  for (const d of plan) {
    const bal = await one(
      `select coalesce(sum(m.delta),0)::int as b from stock_movements m
       join stock_batches b2 on b2.id = m.batch_id where b2.item_id = $1`,
      [itemId]
    );
    const r = await q(
      `insert into stock_movements (item_id, batch_id, delta, reason, balance_after)
       values ($1, $2, $3, 'invoice-line', $4) returning id`,
      [itemId, d.batchId, -d.qty, bal.b - d.qty]
    );
    draws.push({ movementId: r.rows[0].id, batchId: d.batchId, qty: d.qty });
  }
  return { draws };
}

export default router;
