import { CONFLICTS, FIELD_MESSAGES, STUDIO } from '../../../shared/copy.js';
import { money } from '../../../shared/money.js';
import type {
  AuditAction,
  AuditEntry,
  Money,
  OrderStatus,
  StaffRole,
} from '../../../shared/types.js';
import { takeNumber } from '../../db/numbers.js';
import { db, withTransaction, type Queryable } from '../../db/pool.js';
import { allocateRefund, zeroAllocation } from '../../domain/allocation.js';
import { creditMail, refundMail } from '../../email/templates.js';
import {
  boundedText,
  isValidEmail,
  parseBody,
  readBoolean,
  readInteger,
  readList,
  readShape,
  type Reader,
} from '../../http/body.js';
import type { ApiResponse, RequestContext } from '../../http/context.js';
import { errors } from '../../http/errors.js';
import { runIdempotent } from '../../http/idempotency.js';
import {
  issuedAllocations,
  loadCreditsFor,
  loadOrder,
  loadRefunds,
  serializeCredit,
  serializeOrder,
  serializeRefund,
  type OrderRecord,
} from '../../repo/orders.js';
import { loadSubscription, serializeSubscription } from '../../repo/subscriptions.js';
import { noteBillingFailure } from '../../services/billing-status.js';
import { BillingUnavailableError, killbill } from '../../services/killbill.js';
import { enqueueNotice, wakeOutbox } from '../../services/outbox.js';
import { requireRole } from '../sessions.js';

const FINANCE = ['maker', 'finance'] as const;

const readReason = boundedText(FIELD_MESSAGES.reason, 3, 500);

const readBarRef = readShape({
  batch: boundedText(FIELD_MESSAGES.bars_refund, 1, 32),
  bar: readInteger(1, 24, FIELD_MESSAGES.bars_refund),
});

const REFUND_SHAPE = {
  bars: readList(readBarRef, FIELD_MESSAGES.bars_refund, 1),
  restock: readBoolean(FIELD_MESSAGES.restock),
  reason: readReason,
} as const;

const readTarget: Reader<string> = (raw, path, report) => {
  if (typeof raw !== 'string' || !/^(PDL|SUB)-\d{6}$/.test(raw)) {
    report(path, FIELD_MESSAGES.unknown_key);
    return '';
  }
  return raw;
};

const CREDIT_SHAPE = {
  target: readTarget,
  amount_cents: readInteger(100, 2_500, FIELD_MESSAGES.amount_cents),
  reason: readReason,
} as const;

type AuditRow = {
  id: string;
  at: Date;
  actor: string;
  role: StaffRole;
  action: AuditAction;
  target: string;
  reason: string;
  amount_cents: number;
  killbill_ref: string | null;
  outcome: 'issued' | 'failed';
};

export function serializeAudit(row: AuditRow): AuditEntry {
  return {
    id: Number(row.id),
    at: row.at.toISOString(),
    actor: row.actor,
    role: row.role,
    action: row.action,
    target: row.target,
    reason: row.reason,
    amount: money(row.amount_cents),
    killbill_ref: row.killbill_ref,
    outcome: row.outcome,
  };
}

export async function writeAudit(
  client: Queryable,
  entry: {
    actor: string;
    role: StaffRole;
    action: AuditAction;
    target: string;
    reason: string;
    amount: Money;
    killbillRef: string | null;
    outcome: 'issued' | 'failed';
  },
): Promise<AuditEntry> {
  const result = await client.query<AuditRow>(
    `INSERT INTO audit_entries (actor, role, action, target, reason, amount_cents, killbill_ref, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, at, actor, role, action, target, reason, amount_cents, killbill_ref, outcome`,
    [
      entry.actor,
      entry.role,
      entry.action,
      entry.target,
      entry.reason,
      entry.amount.cents,
      entry.killbillRef,
      entry.outcome,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('audit entry not recorded');
  return serializeAudit(row);
}

function readIfMatch(ctx: RequestContext, version: number): void {
  const header = ctx.header('if-match');
  if (header === undefined || header === '') throw errors.preconditionRequired();
  if (header.replace(/"/g, '').trim() !== String(version)) throw errors.staleVersion();
}

export async function searchRecords(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, FINANCE);
  const term = (ctx.query.get('q') ?? '').trim();
  if (term === '') throw errors.invalid({ q: FIELD_MESSAGES.q });
  const email = isValidEmail(term.toLowerCase()) ? term.toLowerCase() : null;
  const orders = await db.query<{
    number: string;
    placed_at: Date;
    total_cents: number;
    status: OrderStatus;
  }>(
    `SELECT o.number, o.placed_at, o.total_cents, o.status FROM orders o
      WHERE o.number = $1 OR ($2::text IS NOT NULL AND o.email = $2)
      ORDER BY o.placed_at DESC, o.number DESC`,
    [term, email],
  );
  const subscriptions = await db.query<{
    number: string;
    state: string;
    scent: string;
    cadence: string;
    next_bill_date: string | null;
  }>(
    `SELECT s.number, s.state, s.scent, s.cadence, s.next_bill_date FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      WHERE s.number = $1 OR ($2::text IS NOT NULL AND c.email = $2)
      ORDER BY s.number`,
    [term, email],
  );
  return {
    status: 200,
    body: {
      orders: orders.rows.map((row) => ({
        number: row.number,
        placed_at: row.placed_at.toISOString(),
        total: money(row.total_cents),
        status: row.status,
      })),
      subscriptions: subscriptions.rows.map((row) => ({
        number: row.number,
        state: row.state,
        scent: row.scent,
        cadence: row.cadence,
        next_bill_date: row.next_bill_date,
      })),
    },
  };
}

export async function getStaffOrder(ctx: RequestContext): Promise<ApiResponse> {
  const record = await loadOrder(db, ctx.params['number'] ?? '');
  if (!record) throw errors.notFound();
  requireRole(ctx, FINANCE);
  const refunds = await loadRefunds(db, record.row.number);
  const credits = await loadCreditsFor(db, record.row.number);
  return {
    status: 200,
    body: {
      ...serializeOrder(record),
      refunds: refunds.map(serializeRefund),
      credits: credits.map(serializeCredit),
    },
    headers: { ETag: `"${record.row.version}"` },
  };
}

export async function getStaffSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const row = await loadSubscription(db, ctx.params['number'] ?? '');
  if (!row) throw errors.notFound();
  requireRole(ctx, FINANCE);
  const customer = await db.query<{ email: string }>('SELECT email FROM customers WHERE id = $1', [
    row.customer_id,
  ]);
  const credits = await loadCreditsFor(db, row.number);
  return {
    status: 200,
    body: {
      ...serializeSubscription(row, new Date()),
      email: customer.rows[0]?.email ?? '',
      credits: credits.map(serializeCredit),
    },
    headers: { ETag: `"${row.version}"` },
  };
}

function peekBars(body: unknown): { batch: string; bar: number }[] {
  if (body === null || typeof body !== 'object') return [];
  const raw = (body as Record<string, unknown>)['bars'];
  if (!Array.isArray(raw)) return [];
  const out: { batch: string; bar: number }[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry['batch'] === 'string' && typeof entry['bar'] === 'number') {
      out.push({ batch: entry['batch'], bar: entry['bar'] });
    }
  }
  return out;
}

function statusAfterRefund(record: OrderRecord, refundedBars: number): OrderStatus {
  const stillOpen = record.lines.filter((line) => !line.refunded).length - refundedBars;
  return stillOpen === 0 ? 'refunded' : 'partially_refunded';
}

export async function issueRefund(ctx: RequestContext): Promise<ApiResponse> {
  const number = ctx.params['number'] ?? '';
  const existing = await loadOrder(db, number);
  if (!existing) throw errors.notFound();
  const staff = requireRole(ctx, FINANCE);

  return runIdempotent(ctx, 'refunds', staff.email, async () => {
    readIfMatch(ctx, existing.row.version);
    const peeked = peekBars(ctx.body);
    if (peeked.length > 0) {
      const alreadyRefunded = peeked.some((bar) =>
        existing.lines.some(
          (line) => line.batch_code === bar.batch && line.bar === bar.bar && line.refunded,
        ),
      );
      if (alreadyRefunded) throw errors.conflict('already_refunded', CONFLICTS.alreadyRefunded);
    }
    const parsed = parseBody(ctx.body, REFUND_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    const requested = parsed.value.bars;
    const unknownBar = requested.some(
      (bar) => !existing.lines.some((line) => line.batch_code === bar.batch && line.bar === bar.bar),
    );
    if (unknownBar) throw errors.invalid({ bars: FIELD_MESSAGES.bars_refund });
    const duplicate = new Set(requested.map((bar) => `${bar.batch}:${bar.bar}`)).size !== requested.length;
    if (duplicate) throw errors.invalid({ bars: FIELD_MESSAGES.bars_refund });
    if (parsed.value.restock) {
      const withdrawn = await db.query(
        `SELECT 1 FROM batches WHERE code = ANY($1) AND state = 'withdrawn'`,
        [[...new Set(requested.map((bar) => bar.batch))]],
      );
      if (withdrawn.rowCount !== 0) throw errors.invalid({ restock: FIELD_MESSAGES.restock });
    }

    try {
      const outcome = await withTransaction(async (client) => {
        const record = await loadOrder(client, number, { forUpdate: true });
        if (!record) throw errors.notFound();
        if (record.row.version !== existing.row.version) throw errors.staleVersion();
        const stillRefundable = requested.every((bar) =>
          record.lines.some(
            (line) => line.batch_code === bar.batch && line.bar === bar.bar && !line.refunded,
          ),
        );
        if (!stillRefundable) throw errors.conflict('already_refunded', CONFLICTS.alreadyRefunded);
        const earlier = issuedAllocations(await loadRefunds(client, number));
        const openBars = record.lines.filter((line) => !line.refunded).length;
        const isFinal = requested.length === openBars;
        const barCents = requested.length * (record.lines[0]?.unit_price_cents ?? 0);
        const split = allocateRefund(
          {
            shippingFeeCents: record.row.shipping_cents,
            taxes: record.row.taxes,
            earlier,
          },
          barCents,
          isFinal,
        );
        const killbillRef = await killbill.refundWithItemAdjustments({
          paymentId: record.row.killbill_payment_id,
          amountCents: split.amount.cents,
          adjustments: adjustmentsFor(record, requested, split.allocation, isFinal),
          actor: staff.email,
        });
        const refundNumber = await takeNumber(client, 'refund');
        await client.query(
          `INSERT INTO refunds (number, order_number, status, restock, bars, amount_cents,
              alloc_bars_cents, alloc_shipping_cents, alloc_taxes, reason, killbill_ref)
           VALUES ($1, $2, 'issued', $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            refundNumber,
            number,
            parsed.value.restock,
            JSON.stringify(requested),
            split.amount.cents,
            split.allocation.bars.cents,
            split.allocation.shipping.cents,
            JSON.stringify(split.allocation.taxes),
            parsed.value.reason,
            killbillRef,
          ],
        );
        for (const bar of requested) {
          await client.query(
            `UPDATE order_lines SET refunded = true
              WHERE order_number = $1 AND batch_code = $2 AND bar = $3`,
            [number, bar.batch, bar.bar],
          );
        }
        await client.query(`UPDATE orders SET status = $2, version = version + 1 WHERE number = $1`, [
          number,
          statusAfterRefund(record, requested.length),
        ]);
        if (parsed.value.restock) {
          const byBatch = new Map<string, number[]>();
          for (const bar of requested) {
            byBatch.set(bar.batch, [...(byBatch.get(bar.batch) ?? []), bar.bar]);
          }
          for (const [batch, bars] of [...byBatch].sort(([left], [right]) => (left < right ? -1 : 1))) {
            await client.query(
              `INSERT INTO stock_movements (batch_code, kind, bars, ref) VALUES ($1, 'restock', $2, $3)`,
              [batch, bars.sort((left, right) => left - right), refundNumber],
            );
          }
        }
        const scentOf = new Map(record.lines.map((line) => [`${line.batch_code}:${line.bar}`, line.scent]));
        const mail = refundMail(
          {
            number: refundNumber,
            order: number,
            bars: requested.map((bar) => ({
              batch: bar.batch,
              bar: bar.bar,
              scent: scentOf.get(`${bar.batch}:${bar.bar}`) ?? bar.batch,
            })),
            amount: split.amount,
          },
          record.row.locale,
        );
        await enqueueNotice(client, {
          key: `refund.${refundNumber}`,
          kind: 'refund',
          recipient: record.row.email,
          locale: record.row.locale,
          subject: mail.subject,
          body: mail.body,
        });
        await writeAudit(client, {
          actor: staff.email,
          role: staff.role,
          action: 'refund',
          target: number,
          reason: parsed.value.reason,
          amount: split.amount,
          killbillRef,
          outcome: 'issued',
        });
        return refundNumber;
      });
      const refunds = await loadRefunds(db, number);
      const refundRow = refunds.find((row) => row.number === outcome);
      const record = await loadOrder(db, number);
      if (!refundRow || !record) throw errors.notFound();
      wakeOutbox();
      return {
        status: 201,
        body: { refund: serializeRefund(refundRow), order: serializeOrder(record) },
      };
    } catch (error) {
      if (!(error instanceof BillingUnavailableError)) throw error;
      noteBillingFailure();
      const failed = await withTransaction(async (client) => {
        const refundNumber = await takeNumber(client, 'refund');
        await client.query(
          `INSERT INTO refunds (number, order_number, status, restock, bars, amount_cents,
              alloc_bars_cents, alloc_shipping_cents, alloc_taxes, reason, killbill_ref)
           VALUES ($1, $2, 'failed', $3, $4, 0, 0, 0, $5, $6, NULL)`,
          [
            refundNumber,
            number,
            parsed.value.restock,
            JSON.stringify(requested),
            JSON.stringify(zeroAllocation(existing.row.taxes).taxes),
            parsed.value.reason,
          ],
        );
        await client.query('UPDATE orders SET version = version + 1 WHERE number = $1', [number]);
        await writeAudit(client, {
          actor: staff.email,
          role: staff.role,
          action: 'refund',
          target: number,
          reason: parsed.value.reason,
          amount: money(0),
          killbillRef: null,
          outcome: 'failed',
        });
        return refundNumber;
      });
      throw errors.billingUnavailable(STUDIO.refundFailed(failed));
    }
  });
}

function adjustmentsFor(
  record: OrderRecord,
  bars: readonly { batch: string; bar: number }[],
  allocation: { bars: Money; shipping: Money; taxes: readonly { code: string; amount: Money }[] },
  isFinal: boolean,
): { invoiceItemId: string; amountCents: number }[] {
  const items = record.row.killbill_items;
  const out: { invoiceItemId: string; amountCents: number }[] = [];
  const unitPrice = record.lines[0]?.unit_price_cents ?? 0;
  for (const bar of bars) {
    const id = items[`bar:${bar.batch}:${bar.bar}`];
    if (id) out.push({ invoiceItemId: id, amountCents: unitPrice });
  }
  if (isFinal && allocation.shipping.cents > 0) {
    const id = items['shipping'];
    if (id) out.push({ invoiceItemId: id, amountCents: allocation.shipping.cents });
  }
  for (const tax of allocation.taxes) {
    const id = items[`tax:${tax.code}`];
    if (id && tax.amount.cents > 0) out.push({ invoiceItemId: id, amountCents: tax.amount.cents });
  }
  return out;
}

type CreditTarget = { kind: 'order' | 'subscription'; customerId: string; version: number; locale: string; email: string };

async function loadCreditTarget(client: Queryable, target: string): Promise<CreditTarget | null> {
  if (target.startsWith('PDL-')) {
    const record = await loadOrder(client, target);
    if (!record) return null;
    return {
      kind: 'order',
      customerId: record.row.customer_id,
      version: record.row.version,
      locale: record.row.locale,
      email: record.row.email,
    };
  }
  const row = await loadSubscription(client, target);
  if (!row) return null;
  const customer = await client.query<{ email: string }>('SELECT email FROM customers WHERE id = $1', [
    row.customer_id,
  ]);
  return {
    kind: 'subscription',
    customerId: row.customer_id,
    version: row.version,
    locale: row.locale,
    email: customer.rows[0]?.email ?? '',
  };
}

export async function addCredit(ctx: RequestContext): Promise<ApiResponse> {
  const rawTarget =
    ctx.body !== null && typeof ctx.body === 'object'
      ? (ctx.body as Record<string, unknown>)['target']
      : undefined;
  const target = typeof rawTarget === 'string' ? rawTarget : '';
  const found = await loadCreditTarget(db, target);
  if (!found) throw errors.notFound();
  const staff = requireRole(ctx, FINANCE);

  return runIdempotent(ctx, 'credits', staff.email, async () => {
    readIfMatch(ctx, found.version);
    const parsed = parseBody(ctx.body, CREDIT_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    const accountId = await db
      .query<{ killbill_account_id: string | null }>(
        'SELECT killbill_account_id FROM customers WHERE id = $1',
        [found.customerId],
      )
      .then((result) => result.rows[0]?.killbill_account_id ?? null);
    const locale = found.locale === 'fr-CA' ? 'fr-CA' : 'en-CA';
    const table = found.kind === 'order' ? 'orders' : 'subscriptions';

    try {
      if (!accountId) throw new BillingUnavailableError('customer has no Kill Bill account');
      const creditNumber = await withTransaction(async (client) => {
        const number = await takeNumber(client, 'credit');
        const killbillRef = await killbill.addAccountCredit({
          accountId,
          amountCents: parsed.value.amount_cents,
          description: `Goodwill ${number}`,
          actor: staff.email,
        });
        await client.query(
          `INSERT INTO credits (number, target, customer_id, status, amount_cents, reason, killbill_ref)
           VALUES ($1, $2, $3, 'issued', $4, $5, $6)`,
          [number, target, found.customerId, parsed.value.amount_cents, parsed.value.reason, killbillRef],
        );
        await client.query(`UPDATE ${table} SET version = version + 1 WHERE number = $1`, [target]);
        const mail = creditMail({ number, amount: money(parsed.value.amount_cents) }, locale);
        await enqueueNotice(client, {
          key: `credit.${number}`,
          kind: 'credit',
          recipient: found.email,
          locale,
          subject: mail.subject,
          body: mail.body,
        });
        await writeAudit(client, {
          actor: staff.email,
          role: staff.role,
          action: 'credit',
          target,
          reason: parsed.value.reason,
          amount: money(parsed.value.amount_cents),
          killbillRef,
          outcome: 'issued',
        });
        return number;
      });
      const credits = await loadCreditsFor(db, target);
      const row = credits.find((credit) => credit.number === creditNumber);
      if (!row) throw errors.notFound();
      wakeOutbox();
      return { status: 201, body: { credit: serializeCredit(row) } };
    } catch (error) {
      if (!(error instanceof BillingUnavailableError)) throw error;
      noteBillingFailure();
      const failed = await withTransaction(async (client) => {
        const number = await takeNumber(client, 'credit');
        await client.query(
          `INSERT INTO credits (number, target, customer_id, status, amount_cents, reason, killbill_ref)
           VALUES ($1, $2, $3, 'failed', $4, $5, NULL)`,
          [number, target, found.customerId, parsed.value.amount_cents, parsed.value.reason],
        );
        await client.query(`UPDATE ${table} SET version = version + 1 WHERE number = $1`, [target]);
        await writeAudit(client, {
          actor: staff.email,
          role: staff.role,
          action: 'credit',
          target,
          reason: parsed.value.reason,
          amount: money(0),
          killbillRef: null,
          outcome: 'failed',
        });
        return number;
      });
      throw errors.billingUnavailable(STUDIO.creditFailed(failed));
    }
  });
}

export async function listAudit(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, FINANCE);
  const result = await db.query<AuditRow>(
    `SELECT id, at, actor, role, action, target, reason, amount_cents, killbill_ref, outcome
       FROM audit_entries ORDER BY id DESC`,
  );
  return { status: 200, body: { entries: result.rows.map(serializeAudit) } };
}
