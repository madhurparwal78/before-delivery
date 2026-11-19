import { INVOICE_STATUS_LABEL, type InvoiceStatus } from '../shared/domain.js';
import { clinicHm } from '../shared/clinictime.js';
import { config } from './config.js';
import { now } from './clock.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid } from './errors.js';
import { Ctx, route, type Staff } from './http.js';
import { publish } from './live.js';
import { fingerprint } from './lib/idempotency.js';
import { formatPounds, lineMoney } from './lib/money.js';
import { exportPdf } from './exports.js';
import { drawStock, lowFlagsChanged, returnDraws } from './stock.js';
import { type Body, isId, loadIn, ref, text, whole } from './support.js';

interface InvoiceRow {
  id: string;
  clinic_id: string;
  number_seq: number;
  patient_id: string;
  patient_name: string;
  appointment_id: string | null;
  status: InvoiceStatus;
  discount_percent: number;
  voided_by: string | null;
  voided_by_name: string | null;
  voided_at: Date | null;
  void_reason: string | null;
}

const SELECT = `
  SELECT i.id, i.clinic_id, i.number_seq, i.patient_id, p.name AS patient_name, i.appointment_id, i.status,
         i.discount_percent, i.voided_by, vu.name AS voided_by_name, i.voided_at, i.void_reason
    FROM invoices i JOIN patients p ON p.id = i.patient_id LEFT JOIN users vu ON vu.id = i.voided_by`;

const invoiceNumber = (seq: number) => `INV-${String(seq).padStart(4, '0')}`;

interface LineRow {
  id: string;
  stock_item_id: string;
  description: string;
  quantity: number;
  unit_price_pence: number;
}

interface PaymentRow {
  id: string;
  pence: number;
  at: Date;
  taken_by: string;
  taker: string;
}

interface InvoiceView {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  appointmentId: string | null;
  status: InvoiceStatus;
  discountPercent: number;
  vatPercent: number;
  lines: ReturnType<typeof shapeLine>[];
  totalPence: number;
  paidPence: number;
  balancePence: number;
  payments: { id: string; pence: number; at: string; takenBy: { id: string; name: string } }[];
  voidedBy: { id: string; name: string } | null;
  voidedAt: string | null;
  voidReason: string | null;
}

const shapeLine = (l: LineRow, discountPercent: number) => ({
  id: l.id,
  stockItemId: l.stock_item_id,
  description: l.description,
  quantity: l.quantity,
  unitPricePence: l.unit_price_pence,
  ...lineMoney(l.quantity, l.unit_price_pence, discountPercent, config.vatPercent),
});

export async function loadInvoice(db: Db, clinicId: string, id: string): Promise<InvoiceRow> {
  return loadIn<InvoiceRow>(db, `${SELECT} WHERE i.id = $1 AND i.clinic_id = $2`, id, clinicId);
}

async function viewInvoice(db: Db, inv: InvoiceRow): Promise<InvoiceView> {
  const lines = await rows<LineRow>(db, 'SELECT id, stock_item_id, description, quantity, unit_price_pence FROM invoice_lines WHERE invoice_id = $1 ORDER BY seq', [inv.id]);
  const payments = await rows<PaymentRow>(
    db,
    'SELECT p.id, p.pence, p.at, p.taken_by, u.name AS taker FROM payments p JOIN users u ON u.id = p.taken_by WHERE p.invoice_id = $1 ORDER BY p.seq',
    [inv.id],
  );
  const shaped = lines.map((l) => shapeLine(l, inv.discount_percent));
  const total = shaped.reduce((sum, l) => sum + l.totalPence, 0);
  const paid = payments.reduce((sum, p) => sum + p.pence, 0);
  return {
    id: inv.id,
    number: invoiceNumber(inv.number_seq),
    patientId: inv.patient_id,
    patientName: inv.patient_name,
    appointmentId: inv.appointment_id,
    status: inv.status,
    discountPercent: inv.discount_percent,
    vatPercent: config.vatPercent,
    lines: shaped,
    totalPence: total,
    paidPence: paid,
    balancePence: total - paid,
    payments: payments.map((p) => ({ id: p.id, pence: p.pence, at: p.at.toISOString(), takenBy: { id: p.taken_by, name: p.taker } })),
    voidedBy: inv.voided_by ? { id: inv.voided_by, name: inv.voided_by_name! } : null,
    voidedAt: inv.voided_at?.toISOString() ?? null,
    voidReason: inv.void_reason,
  };
}

export async function createInvoice(db: Db, clinicId: string, patientId: string, appointmentId: string | null): Promise<string> {
  const next = await one<{ n: number }>(db, 'SELECT COALESCE(MAX(number_seq), 0) + 1 AS n FROM invoices WHERE clinic_id = $1', [clinicId]);
  const made = await one<{ id: string }>(
    db,
    'INSERT INTO invoices (clinic_id, number_seq, patient_id, appointment_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [clinicId, next!.n, patientId, appointmentId],
  );
  return made!.id;
}

/** Adds a line, drawing stock first-expiry-first-out. The one place a line is created. */
export async function addLine(db: Db, clinicId: string, invoiceId: string, item: { id: string; name: string; unit_price_pence: number }, quantity: number, by: string): Promise<void> {
  const line = (await one<{ id: string }>(
    db,
    'INSERT INTO invoice_lines (invoice_id, stock_item_id, description, quantity, unit_price_pence) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [invoiceId, item.id, item.name, quantity, item.unit_price_pence],
  ))!;
  await drawStock(db, item, quantity, line.id, by);
  await lowFlagsChanged(db, clinicId);
}

export async function applyPayment(db: Db, inv: InvoiceRow, pence: number, by: string, at: Date): Promise<void> {
  const view = await viewInvoice(db, inv);
  if (pence > view.balancePence) throw new AppError('payment_too_large', undefined, 'pence');
  await db.query('INSERT INTO payments (invoice_id, pence, taken_by, at) VALUES ($1, $2, $3, $4)', [inv.id, pence, by, at]);
  await db.query('UPDATE invoices SET status = $2 WHERE id = $1', [inv.id, pence === view.balancePence ? 'paid' : 'part-paid']);
}

async function changed(db: Db, clinicId: string): Promise<void> {
  await publish(db, clinicId, { t: 'invoices' });
  await publish(db, clinicId, { t: 'stock' });
}

interface Stored {
  status: number;
  body: unknown;
}

/**
 * Runs `work` under the clinic lock. With an Idempotency-Key, a remembered key replays its stored response and the
 * same key with another method, path or body is refused; only successes are stored.
 */
async function idempotent(ctx: Ctx, user: Staff, body: Body, work: (db: Db) => Promise<Stored>): Promise<void> {
  const key = ctx.req.headers['idempotency-key'];
  const given = typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
  const print = fingerprint(ctx.method, ctx.url.pathname, body);
  const result = await transaction(user.clinicId, async (db) => {
    if (given) {
      await db.query(`DELETE FROM idempotency_keys WHERE clinic_id = $1 AND key = $2 AND created_at < $3`, [
        user.clinicId,
        given,
        new Date(now().getTime() - config.idempotencyKeyHours * 3_600_000),
      ]);
      const stored = await one<{ fingerprint: string; status: number; body: unknown }>(
        db,
        'SELECT fingerprint, status, body FROM idempotency_keys WHERE clinic_id = $1 AND key = $2',
        [user.clinicId, given],
      );
      if (stored) {
        if (stored.fingerprint !== print) throw new AppError('idempotency_key_reused');
        return { status: stored.status, body: stored.body };
      }
    }
    const done = await work(db);
    if (given) {
      await db.query('INSERT INTO idempotency_keys (clinic_id, key, fingerprint, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        user.clinicId,
        given,
        print,
        done.status,
        JSON.stringify(done.body),
        now(),
      ]);
    }
    return done;
  });
  ctx.send(result.status, result.body);
}

export function registerInvoiceRoutes(): void {
  route('GET', '/api/invoices', async (ctx) => {
    const user = await ctx.user();
    ctx.allow(user, 'invoices.read');
    const status = ctx.query.get('status');
    if (status !== null && !(status in INVOICE_STATUS_LABEL)) throw invalid('status', 'status');
    const everyone = await Promise.all((await rows<InvoiceRow>(pool, `${SELECT} WHERE i.clinic_id = $1 ORDER BY i.number_seq DESC`, [user.clinicId])).map((i) => viewInvoice(pool, i)));
    const shown = status === null ? everyone : everyone.filter((v) => v.status === status);
    ctx.send(200, {
      invoices: shown.map((v) => ({ id: v.id, number: v.number, patientName: v.patientName, status: v.status, totalPence: v.totalPence, balancePence: v.balancePence })),
      outstandingPence: everyone.filter((v) => v.status === 'issued' || v.status === 'part-paid').reduce((sum, v) => sum + v.balancePence, 0),
    });
  });

  route('POST', '/api/invoices', async (ctx) => {
    const user = await ctx.user();
    const body = await ctx.json();
    const patient = await ref(body, 'patientId', (id) => one<{ id: string }>(pool, 'SELECT id FROM patients WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]));
    const appointment = await ref(body, 'appointmentId', (id) => one<{ id: string }>(pool, 'SELECT id FROM appointments WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]));
    ctx.allow(user, 'invoices.write');
    if (!patient) throw invalid('patientId', 'Patient', true);
    const id = await transaction(user.clinicId, async (db) => {
      if (appointment) {
        const exists = await one(db, `SELECT 1 FROM invoices WHERE appointment_id = $1 AND status <> 'voided'`, [appointment.id]);
        if (exists) throw new AppError('invoice_exists');
      }
      const made = await createInvoice(db, user.clinicId, patient.id, appointment?.id ?? null);
      await changed(db, user.clinicId);
      return made;
    });
    ctx.send(201, await viewInvoice(pool, await loadInvoice(pool, user.clinicId, id)));
  });

  route('GET', '/api/invoices/:id.pdf', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'invoices.read');
    const view = await viewInvoice(pool, inv);
    const body = view.lines.map((l) => `${l.description} x${l.quantity} ${formatPounds(l.totalPence)}`);
    const closing = [
      `Total ${formatPounds(view.totalPence)}`,
      `Paid ${formatPounds(view.paidPence)}`,
      `Balance due ${formatPounds(view.balancePence)}`,
      ...view.payments.map((p) => `Payment ${formatPounds(p.pence)} taken by ${p.takenBy.name} at ${clinicHm(new Date(p.at))}`),
      ...(view.voidedBy ? [`Voided by ${view.voidedBy.name} at ${clinicHm(new Date(view.voidedAt!))}: ${view.voidReason}`] : []),
    ];
    await exportPdf(ctx, user.clinicId, `invoice-${inv.id}`, { heading: `Invoice ${view.number}`, body, closing, created: now() });
  });

  route('GET', '/api/invoices/:id', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'invoices.read');
    ctx.send(200, await viewInvoice(pool, inv));
  });

  route('POST', '/api/invoices/:id/lines', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    const body = await ctx.json();
    const item = await ref(body, 'stockItemId', (id) =>
      one<{ id: string; name: string; unit_price_pence: number }>(pool, 'SELECT id, name, unit_price_pence FROM stock_items WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]),
    );
    ctx.allow(user, 'invoices.write');
    await idempotent(ctx, user, body, async (db) => {
      const current = await loadInvoice(db, user.clinicId, inv.id);
      if (current.status !== 'draft') throw new AppError('invoice_not_draft');
      if (!item) throw invalid('stockItemId', 'Stock item', true);
      const quantity = whole(body, 'quantity', 1, 999);
      await addLine(db, user.clinicId, inv.id, item, quantity, user.id);
      await changed(db, user.clinicId);
      return { status: 201, body: await viewInvoice(db, current) };
    });
  });

  route('DELETE', '/api/invoices/:id/lines/:lineId', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    if (!isId(ctx.params.lineId) || !(await one(pool, 'SELECT 1 FROM invoice_lines WHERE id = $1 AND invoice_id = $2', [ctx.params.lineId, inv.id]))) throw new AppError('not_found');
    ctx.allow(user, 'invoices.write');
    const view = await transaction(user.clinicId, async (db) => {
      const current = await loadInvoice(db, user.clinicId, inv.id);
      if (current.status !== 'draft') throw new AppError('invoice_not_draft');
      await returnDraws(db, ctx.params.lineId, user.id);
      await db.query('DELETE FROM invoice_lines WHERE id = $1', [ctx.params.lineId]);
      await lowFlagsChanged(db, user.clinicId);
      await changed(db, user.clinicId);
      return viewInvoice(db, current);
    });
    ctx.send(200, view);
  });

  route('PATCH', '/api/invoices/:id', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'invoices.write');
    const body = await ctx.json();
    const view = await transaction(user.clinicId, async (db) => {
      const current = await loadInvoice(db, user.clinicId, inv.id);
      if (current.status !== 'draft') throw new AppError('invoice_not_draft');
      const percent = whole(body, 'discountPercent', 0, 100);
      await db.query('UPDATE invoices SET discount_percent = $2 WHERE id = $1', [inv.id, percent]);
      await changed(db, user.clinicId);
      return viewInvoice(db, await loadInvoice(db, user.clinicId, inv.id));
    });
    ctx.send(200, view);
  });

  route('POST', '/api/invoices/:id/issue', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'invoices.write');
    const view = await transaction(user.clinicId, async (db) => {
      const current = await loadInvoice(db, user.clinicId, inv.id);
      if (current.status !== 'draft') throw new AppError('invoice_not_draft');
      const count = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM invoice_lines WHERE invoice_id = $1', [inv.id]);
      if (count!.n === 0) throw new AppError('no_lines', undefined, 'lines');
      await db.query(`UPDATE invoices SET status = 'issued' WHERE id = $1`, [inv.id]);
      await changed(db, user.clinicId);
      return viewInvoice(db, await loadInvoice(db, user.clinicId, inv.id));
    });
    ctx.send(200, view);
  });

  route('POST', '/api/invoices/:id/payments', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'payments.take');
    const body = await ctx.json();
    await idempotent(ctx, user, body, async (db) => {
      const current = await loadInvoice(db, user.clinicId, inv.id);
      if (current.status === 'draft') throw new AppError('invoice_not_issued');
      if (current.status === 'paid' || current.status === 'voided') throw new AppError('invoice_closed');
      const pence = whole(body, 'pence', 1, Number.MAX_SAFE_INTEGER, 'pence');
      await applyPayment(db, current, pence, user.id, now());
      await changed(db, user.clinicId);
      return { status: 201, body: await viewInvoice(db, await loadInvoice(db, user.clinicId, inv.id)) };
    });
  });

  route('POST', '/api/invoices/:id/void', async (ctx) => {
    const user = await ctx.user();
    const inv = await loadInvoice(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'payments.take');
    const body = await ctx.json();
    const view = await transaction(user.clinicId, async (db) => {
      const current = await loadInvoice(db, user.clinicId, inv.id);
      if (current.status === 'voided') throw new AppError('invoice_closed');
      const paid = await one(db, 'SELECT 1 FROM payments WHERE invoice_id = $1 LIMIT 1', [inv.id]);
      if (paid) throw new AppError('invoice_has_payments');
      const reason = text(body, 'reason', { max: 200 });
      for (const line of await rows<{ id: string }>(db, 'SELECT id FROM invoice_lines WHERE invoice_id = $1 ORDER BY seq', [inv.id])) {
        await returnDraws(db, line.id, user.id);
      }
      await db.query(`UPDATE invoices SET status = 'voided', voided_by = $2, voided_at = $3, void_reason = $4 WHERE id = $1`, [inv.id, user.id, now(), reason]);
      await lowFlagsChanged(db, user.clinicId);
      await changed(db, user.clinicId);
      return viewInvoice(db, await loadInvoice(db, user.clinicId, inv.id));
    });
    ctx.send(200, view);
  });
}
