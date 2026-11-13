import { Router } from 'express';
import { AppError } from '../../errors.js';
import { TIER_KEYS, copy, refundCapError, type TierKey } from '../../../shared/copy.js';
import { isCurrency, type Currency } from '../../../shared/money.js';
import { compareDayKeys, formatLisbonDateTime, lisbonDayKey, parseDayEntry, toLisbonIso } from '../../../shared/lisbon.js';
import { newId, pool, query, withAdvisoryLock } from '../../db/index.js';
import { body } from '../boundary.js';
import { requireManager, requireRole } from '../auth.js';
import { withIdempotency } from '../idempotency.js';
import { FieldErrors, readInteger, readText } from '../validate.js';
import { readIsoInstant } from './studio.js';
import { listAudit, record } from '../../domain/audit.js';
import {
  cancelBooking,
  cancelSessionAtomically,
  loadSession,
  toSessionView,
} from '../../domain/sessions.js';
import {
  listManagerOrders,
  loadOrder,
  recordRefund,
  refundedTotal,
  refundFacts,
  toOrderView,
} from '../../domain/orders.js';
import { buildCatalog, readPriceChanges, syncCatalog } from '../../domain/prices.js';
import { reconcile } from '../../domain/reconciliation.js';
import { readMembershipRow } from '../../domain/membership.js';
import * as mail from '../../services/mail.js';
import type { OrderKind, OverdueSupporter } from '../../../shared/types.js';

export const boxOfficeRouter = Router();

const now = (): number => Date.now();

boxOfficeRouter.get('/audit', async (request, response) => {
  requireRole(request, ['manager', 'lead_curator']);
  response.json({ actions: await listAudit() });
});

boxOfficeRouter.use((request, _response, next) => {
  requireManager(request);
  next();
});

boxOfficeRouter.post('/sessions', async (request, response) => {
  const user = requireManager(request);
  const input = body(request);
  const errors = new FieldErrors();
  const title = readText(input.title)?.trim() ?? '';
  if (title.length < 3 || title.length > 120) errors.add('title', copy.titleLength);
  const startsAt = readIsoInstant(input.starts_at);
  if (startsAt === null || startsAt <= now()) errors.add('starts_at', copy.timeAfterNow);
  const duration = readInteger(input.duration_minutes);
  if (duration === null || duration < 15 || duration > 240) errors.add('duration_minutes', copy.durationRange);
  const capacity = readInteger(input.capacity);
  if (capacity === null || capacity < 1 || capacity > 200) errors.add('capacity', copy.capacityRange);
  errors.throwIfAny();
  const id = newId('ses');
  await pool.query(
    `INSERT INTO guided_sessions (id, title, starts_at, duration_minutes, capacity)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, title, new Date(startsAt as number), duration, capacity],
  );
  await record({ actorEmail: user.email, action: 'session_created', targetType: 'session', targetId: id });
  const row = await loadSession(id);
  if (!row) throw new AppError('not_found');
  const catalog = await buildCatalog(now());
  response.status(201).json({
    session: await toSessionView(row, now(), { amountMinor: catalog.ticket.prices.EUR, currency: 'EUR' }),
  });
});

boxOfficeRouter.post('/sessions/:id/cancel', async (request, response) => {
  const user = requireManager(request);
  const session = await loadSession(request.params.id as string);
  if (!session) throw new AppError('not_found');
  const outcome = await withIdempotency(request, response, async () => {
    const reason = readText(body(request).reason)?.trim() ?? '';
    const errors = new FieldErrors();
    if (reason.length < 3 || reason.length > 500) errors.add('reason', copy.reasonLength);
    errors.throwIfAny();
    const nowMs = now();
    const result = await cancelSessionAtomically(session.id, reason, nowMs);
    if (!result.cancelled) throw new AppError('session_not_cancellable');
    const startsAtDisplay = formatLisbonDateTime(session.starts_at.getTime());
    let refunds = 0;
    for (const booking of result.bookings) {
      const orderRows = await query<{ id: string }>('SELECT id FROM orders WHERE booking_id = $1', [booking.id]);
      const orderId = orderRows[0]?.id;
      if (!orderId) continue;
      await withAdvisoryLock(`order:${orderId}`, async () => {
        const row = await loadOrder(orderId);
        if (!row) return;
        const remaining = Number(row.amount_minor) - (await refundedTotal(orderId));
        if (remaining <= 0) return;
        const confirmed = await recordRefund(row, remaining, `Session cancelled: ${reason}`);
        await cancelBooking(booking.id);
        refunds += 1;
        await mail.send(
          mail.sessionCancelledMessage({
            ...refundFacts(row, confirmed.amountMinor, confirmed.atMs, row.receipt_number),
            sessionTitle: session.title,
            startsAtDisplay,
          }),
        );
      });
    }
    await record({
      actorEmail: user.email,
      action: 'session_cancelled',
      targetType: 'session',
      targetId: session.id,
      detail: { reason, refunds },
    });
    const updated = await loadSession(session.id);
    const catalog = await buildCatalog(nowMs);
    return {
      status: 200,
      payload: {
        session: await toSessionView(updated as NonNullable<typeof updated>, nowMs, {
          amountMinor: catalog.ticket.prices.EUR,
          currency: 'EUR',
        }),
        refunds,
      },
    };
  });
  response.status(outcome.status).json(outcome.payload);
});

boxOfficeRouter.get('/orders', async (request, response) => {
  const errors = new FieldErrors();
  let currency: Currency | null = null;
  const currencyText = request.query.currency;
  if (typeof currencyText === 'string' && currencyText !== '') {
    if (!isCurrency(currencyText)) errors.add('currency', 'Choose a currency.');
    else currency = currencyText;
  }
  let kind: OrderKind | null = null;
  const kindText = request.query.kind;
  if (typeof kindText === 'string' && kindText !== '') {
    const kinds: OrderKind[] = ['ticket', 'donation', 'membership_join', 'membership_upgrade'];
    if (!kinds.includes(kindText as OrderKind)) errors.add('kind', 'Choose an order kind.');
    else kind = kindText as OrderKind;
  }
  errors.throwIfAny();
  response.json({ orders: await listManagerOrders({ currency, kind }) });
});

boxOfficeRouter.post('/orders/:id/refunds', async (request, response) => {
  const user = requireManager(request);
  const existing = await loadOrder(request.params.id as string);
  if (!existing) throw new AppError('not_found');
  const outcome = await withIdempotency(request, response, async () => {
    const input = body(request);
    const amountMinor = readInteger(input.amount_minor);
    const reason = readText(input.reason)?.trim() ?? '';
    return withAdvisoryLock(`order:${existing.id}`, async () => {
      const row = await loadOrder(existing.id);
      if (!row) throw new AppError('not_found');
      const settled = Number(row.amount_minor);
      const already = await refundedTotal(row.id);
      const remaining = settled - already;
      if (remaining <= 0) throw new AppError('fully_refunded');
      const errors = new FieldErrors();
      if (reason.length < 3 || reason.length > 500) errors.add('reason', copy.reasonLength);
      if (amountMinor === null || amountMinor <= 0) errors.add('amount_minor', copy.amountFormat);
      else if (amountMinor > remaining) errors.add('amount_minor', refundCapError(remaining, row.currency));
      errors.throwIfAny();
      const confirmed = await recordRefund(row, amountMinor as number, reason);
      if (already + (amountMinor as number) >= settled && row.booking_id) await cancelBooking(row.booking_id);
      await mail.send(mail.refundMessage(refundFacts(row, confirmed.amountMinor, confirmed.atMs, row.receipt_number)));
      await record({
        actorEmail: user.email,
        action: 'refund',
        targetType: 'order',
        targetId: row.id,
        detail: { amount_minor: confirmed.amountMinor, reason },
      });
      return {
        status: 201,
        payload: {
          refund: {
            id: confirmed.refundId,
            amount_minor: confirmed.amountMinor,
            reason,
            at: toLisbonIso(confirmed.atMs),
          },
          order: await toOrderView((await loadOrder(row.id)) as NonNullable<typeof row>),
        },
      };
    });
  });
  response.status(outcome.status).json(outcome.payload);
});

boxOfficeRouter.post('/orders/:id/notes', async (request, response) => {
  const user = requireManager(request);
  const row = await loadOrder(request.params.id as string);
  if (!row) throw new AppError('not_found');
  const text = readText(body(request).text)?.trim() ?? '';
  const errors = new FieldErrors();
  if (text.length < 1 || text.length > 500) errors.add('text', 'Give a note of 1 to 500 characters.');
  errors.throwIfAny();
  const id = newId('note');
  await pool.query('INSERT INTO order_notes (id, order_id, text, author_email) VALUES ($1, $2, $3, $4)', [
    id,
    row.id,
    text,
    user.email,
  ]);
  await record({ actorEmail: user.email, action: 'order_note', targetType: 'order', targetId: row.id });
  response.status(201).json({ note: { id, text, author_email: user.email, at: toLisbonIso(now()) } });
});

boxOfficeRouter.get('/dunning', async (_request, response) => {
  const rows = await query<{
    user_id: string;
    amount_minor: string;
    currency: Currency;
    failed_at: Date;
    attempts: number;
    next_retry_at: Date | null;
  }>(
    `SELECT user_id, amount_minor::text, currency, failed_at, attempts, next_retry_at
     FROM dunning_state WHERE state IN ('active', 'retrying') ORDER BY failed_at`,
  );
  const overdue: OverdueSupporter[] = [];
  for (const row of rows) {
    const membership = await readMembershipRow(row.user_id);
    const account = await query<{ email: string; name: string }>(
      'SELECT email, name FROM killbill_accounts WHERE user_id = $1',
      [row.user_id],
    );
    overdue.push({
      user_email: account[0]?.email ?? '',
      name: account[0]?.name ?? '',
      tier: (membership?.tier ?? 'reader') as TierKey,
      currency: row.currency,
      amount_due_minor: Number(row.amount_minor),
      failed_at: toLisbonIso(row.failed_at.getTime()),
      attempts: row.attempts,
      next_retry_at: row.next_retry_at ? toLisbonIso(row.next_retry_at.getTime()) : null,
    });
  }
  response.json({ overdue });
});

boxOfficeRouter.get('/reconciliation', async (request, response) => {
  const month = request.query.month;
  const errors = new FieldErrors();
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    errors.add('month', 'Choose a month as YYYY-MM.');
  }
  errors.throwIfAny();
  response.json({ month, currencies: await reconcile(month as string) });
});

boxOfficeRouter.post('/plan-prices', async (request, response) => {
  const user = requireManager(request);
  const input = body(request);
  const errors = new FieldErrors();
  const tier = input.tier;
  if (!TIER_KEYS.includes(tier as TierKey)) errors.add('tier', 'Choose a supporter tier.');
  const currencyText = readText(input.currency);
  if (!isCurrency(currencyText)) errors.add('currency', 'Choose a currency.');
  const amountMinor = readInteger(input.amount_minor);
  if (amountMinor === null || amountMinor < 1 || amountMinor > 1_000_000) {
    errors.add('amount_minor', copy.amountFormat);
  }
  const effectiveText = readText(input.effective_on);
  const effectiveOn = effectiveText ? parseDayEntry(effectiveText) : null;
  const todayKey = lisbonDayKey(now());
  if (!effectiveOn || compareDayKeys(effectiveOn, todayKey) <= 0) {
    errors.add('effective_on', copy.dateAfterToday);
  }
  errors.throwIfAny();
  const changes = await readPriceChanges();
  const later = changes.some(
    (change) =>
      change.tier === tier &&
      change.currency === currencyText &&
      compareDayKeys(change.effectiveOn, effectiveOn as string) >= 0,
  );
  if (later) throw new AppError('price_change_conflict');
  await pool.query(
    'INSERT INTO plan_price_changes (tier, currency, amount_minor, effective_on) VALUES ($1, $2, $3, $4::date)',
    [tier as TierKey, currencyText as Currency, amountMinor as number, effectiveOn as string],
  );
  await syncCatalog();
  await record({
    actorEmail: user.email,
    action: 'price_change',
    targetType: 'tier',
    targetId: `${tier as string}:${currencyText as string}`,
    detail: { amount_minor: amountMinor, effective_on: effectiveOn },
  });
  response.status(201).json({
    change: {
      tier,
      currency: currencyText,
      amount_minor: amountMinor,
      effective_on: effectiveOn,
    },
  });
});
