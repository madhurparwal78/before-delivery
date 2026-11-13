import crypto from 'node:crypto';
import type { App, User } from './app.ts';
import { recordAction } from './app.ts';
import { requireUser } from './platform.ts';
import type { RouteContext } from './http.ts';
import { ApiError, sendJson, validationFailed } from './http.ts';
import { readJson, asString, asInteger, type Value } from './params.ts';
import { FIELDS } from '../core/copy.ts';
import { parseIsoWithOffset, parseLisbonEntry, parseMonth, monthStart, monthEnd, toDateIso, offsetAt } from '../core/time.ts';
import { formatPrice, minorToMajorString, type Currency } from '../core/money.ts';
import { deriveStatus, seatsLeft, toPublicSession, type SessionRow } from './sessions.ts';

export function registerManagerRoutes(app: App, route: (method: string, pattern: string, handler: (ctx: RouteContext) => Promise<void>) => void): void {
  const requireManager = async (ctx: RouteContext): Promise<User> => {
    const user = await requireUser(ctx, app);
    if (user.role !== 'manager') throw new ApiError(403, 'forbidden');
    return user;
  };

  route('POST', '/api/manager/sessions', async (ctx) => {
    const user = await requireManager(ctx);
    const body = await readJson(ctx);
    const title = asString(body['title']);
    const startsAt = asString(body['starts_at']);
    const duration = asInteger(body['duration_minutes']);
    const capacity = asInteger(body['capacity']);
    const fields: Record<string, string> = {};
    if (title === null || title.trim().length < 3 || title.trim().length > 120) fields['title'] = FIELDS.sessionTitle;
    if (startsAt === null) fields['starts_at'] = FIELDS.sessionStart;
    if (duration === null || duration < 15 || duration > 240) fields['duration_minutes'] = FIELDS.duration;
    if (capacity === null || capacity < 1 || capacity > 200) fields['capacity'] = FIELDS.capacity;
    if (Object.keys(fields).length) throw validationFailed(fields);

    let ms: number;
    if (/^\d{4}-\d{2}-\d{2}T/.test(startsAt!)) {
      const parsed = parseIsoWithOffset(startsAt!);
      if (parsed === null) throw validationFailed({ starts_at: FIELDS.sessionStart });
      ms = parsed;
    } else {
      const r = parseLisbonEntry(startsAt!);
      if (r.kind === 'bad') throw validationFailed({ starts_at: FIELDS.sessionStart });
      if (r.kind === 'missing') throw validationFailed({ starts_at: FIELDS.skippedLisbonTime });
      ms = r.ms;
    }
    if (ms <= app.now()) throw validationFailed({ starts_at: FIELDS.sessionStart });

    const id = crypto.randomUUID();
    await app.pool.query(
      `INSERT INTO sessions (id, title, starts_at, duration_minutes, capacity) VALUES ($1,$2,$3,$4,$5)`,
      [id, title!.trim(), new Date(ms), duration, capacity],
    );
    await recordAction(app, user.email, 'session_created', 'session', id, { title: title!.trim() });
    const row: SessionRow = { id, title: title!.trim(), starts_at: new Date(ms), duration_minutes: duration!, capacity: capacity!, status: 'on_sale' };
    sendJson(ctx.res, 201, {
      session: toPublicSession(row, { status: 'on_sale', bookingClosesAt: ms - 30 * 60_000, seatsLeft: capacity! }, { minor: 1200, currency: 'EUR' }),
    });
  });

  route('POST', '/api/manager/sessions/:id/cancel', async (ctx) => {
    const user = await requireManager(ctx);
    const id = ctx.path.split('/')[4] ?? '';
    const body = await readJson(ctx);
    const reason = asString(body['reason']);
    if (reason === null || reason.trim().length < 3 || reason.trim().length > 500) {
      throw validationFailed({ reason: FIELDS.reason });
    }
    const res = await app.pool.query(`SELECT id, title, starts_at, duration_minutes, capacity, status FROM sessions WHERE id = $1`, [id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(404, 'not_found');
    const now = app.now();
    const srow: SessionRow = {
      id,
      title: String(row['title']),
      starts_at: new Date(row['starts_at'] as Date),
      duration_minutes: Number(row['duration_minutes']),
      capacity: Number(row['capacity']),
      status: String(row['status']),
    };
    const seats = await seatsLeft(app, id, srow.capacity);
    const derived = deriveStatus(srow, seats, now);
    if (derived.status === 'held' || srow.status === 'cancelled') throw new ApiError(409, 'session_not_cancellable');

    const upd = await app.pool.query(
      `UPDATE sessions SET status = 'cancelled' WHERE id = $1 AND status <> 'cancelled'
         AND starts_at + (duration_minutes || ' minutes')::interval > now()`,
      [id],
    );
    if ((upd.rowCount ?? 0) === 0) throw new ApiError(409, 'session_not_cancellable');

    const bookings = await app.pool.query(
      `SELECT b.id AS booking_id, b.user_id, o.id AS order_id, o.currency, o.amount_minor, o.killbill_payment_id
       FROM bookings b JOIN orders o ON o.session_id = b.session_id AND o.user_id = b.user_id
       WHERE b.session_id = $1 AND b.live`,
      [id],
    );
    let refunds = 0;
    for (const b of bookings.rows) {
      const amountMinor = Number(b['amount_minor']);
      const currency = String(b['currency']) as Currency;
      try {
        await app.kb.refundPayment(String(b['killbill_payment_id']), minorToMajorString(amountMinor, currency), currency);
      } catch {
        throw new ApiError(503, 'billing_unavailable');
      }
      await app.pool.query(
        `INSERT INTO refunds (id, order_id, amount_minor, reason, at, killbill_refund_id) VALUES ($1,$2,$3,$4,now(),$5)`,
        [crypto.randomUUID(), String(b['order_id']), amountMinor, reason.trim(), String(b['killbill_payment_id'])],
      );
      await app.pool.query(
        `UPDATE orders SET refunded_minor = $2, status = CASE WHEN $2 >= amount_minor THEN 'refunded' ELSE 'partially_refunded' END WHERE id = $1`,
        [String(b['order_id']), amountMinor],
      );
      await app.pool.query(`UPDATE bookings SET live = false WHERE id = $1`, [String(b['booking_id'])]);
      const buyer = await app.pb.getUserById(String(b['user_id']));
      await app.mail.enqueue({
        toEmail: buyer?.email ?? 'unknown@halden.test',
        toName: buyer?.name ?? 'Visitor',
        subject: `Cancelled: ${srow.title} — full refund issued`,
        body: [
          `Hello ${buyer?.name ?? 'visitor'},`,
          '',
          `Cancelled: ${srow.title} — full refund issued.`,
          '',
          'Halden Reading Room',
        ].join('\n'),
        dedupeKey: `session-cancel:${String(b['booking_id'])}`,
      });
      refunds++;
      await recordAction(app, user.email, 'refund', 'order', String(b['order_id']), { amount_minor: amountMinor, reason: reason.trim(), session_cancelled: true });
    }
    await recordAction(app, user.email, 'session_cancelled', 'session', id, { reason: reason.trim(), refunds });
    sendJson(ctx.res, 200, { session: { id, status: 'cancelled' }, refunds });
  });

  route('GET', '/api/manager/orders', async (ctx) => {
    await requireManager(ctx);
    const currency = ctx.query.get('currency');
    const kind = ctx.query.get('kind');
    const rows = await app.pool.query(
      `SELECT o.id, o.receipt_number, o.kind, o.user_id, o.description, o.currency, o.amount_minor, o.refunded_minor,
              o.status, o.settled_at, o.card_last4, o.killbill_invoice_id, o.killbill_payment_id
       FROM orders o
       WHERE ($1::text IS NULL OR o.currency = $1) AND ($2::text IS NULL OR o.kind = $2)
       ORDER BY o.settled_at DESC`,
      [currency || null, kind || null],
    );
    const ids = rows.rows.map((r) => String(r['id']));
    const refunds = ids.length
      ? await app.pool.query(`SELECT id, order_id, amount_minor, reason, at FROM refunds WHERE order_id = ANY($1)`, [ids])
      : { rows: [] as Array<Record<string, unknown>> };
    const notes = ids.length
      ? await app.pool.query(`SELECT id, order_id, text, author_email, at FROM order_notes WHERE order_id = ANY($1) ORDER BY at`, [ids])
      : { rows: [] as Array<Record<string, unknown>> };
    const users = new Map<string, { email: string; name: string }>();
    for (const r of rows.rows) {
      const uid = String(r['user_id']);
      if (!users.has(uid)) {
        const u = await app.pb.getUserById(uid);
        users.set(uid, { email: u?.email ?? '', name: u?.name ?? '' });
      }
    }
    const refundsByOrder = new Map<string, Array<Record<string, unknown>>>();
    for (const r of refunds.rows) {
      const key = String(r['order_id']);
      const list = refundsByOrder.get(key) ?? [];
      list.push({ id: String(r['id']), amount_minor: Number(r['amount_minor']), reason: String(r['reason']), at: new Date(r['at'] as Date).toISOString() });
      refundsByOrder.set(key, list);
    }
    const notesByOrder = new Map<string, Array<Record<string, unknown>>>();
    for (const r of notes.rows) {
      const key = String(r['order_id']);
      const list = notesByOrder.get(key) ?? [];
      list.push({ id: String(r['id']), text: String(r['text']), author_email: String(r['author_email']), at: new Date(r['at'] as Date).toISOString() });
      notesByOrder.set(key, list);
    }
    sendJson(ctx.res, 200, {
      orders: rows.rows.map((r) => ({
        id: String(r['id']),
        receipt_number: String(r['receipt_number']),
        kind: String(r['kind']),
        user_email: users.get(String(r['user_id']))?.email ?? '',
        description: String(r['description']),
        currency: String(r['currency']),
        amount_minor: Number(r['amount_minor']),
        refunded_minor: Number(r['refunded_minor']),
        status: String(r['status']),
        settled_at: new Date(r['settled_at'] as Date).toISOString(),
        card_last4: String(r['card_last4']),
        receipt_url: `/api/orders/${String(r['id'])}/receipt`,
        killbill_invoice_id: String(r['killbill_invoice_id'] ?? ''),
        killbill_payment_id: String(r['killbill_payment_id'] ?? ''),
        refunds: refundsByOrder.get(String(r['id'])) ?? [],
        notes: notesByOrder.get(String(r['id'])) ?? [],
      })),
    });
  });

  route('POST', '/api/manager/orders/:id/refunds', async (ctx) => {
    const user = await requireManager(ctx);
    const orderId = ctx.path.split('/')[4] ?? '';
    const body = await readJson(ctx);
    const amountMinor = asInteger(body['amount_minor']);
    const reason = asString(body['reason']);
    const fields: Record<string, string> = {};
    if (amountMinor === null || amountMinor <= 0) fields['amount_minor'] = FIELDS.amountFormat;
    if (reason === null || reason.trim().length < 3 || reason.trim().length > 500) fields['reason'] = FIELDS.reason;
    if (Object.keys(fields).length) throw validationFailed(fields);

    // The refund cap is judged at commit, under a lock on the order row.
    const conn = await app.pool.acquire();
    let currency = 'EUR';
    let paymentId = '';
    try {
      await conn.query('BEGIN');
      const orderRes = await conn.query(
        `SELECT id, currency, amount_minor, refunded_minor, killbill_payment_id FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = orderRes.rows[0];
      if (!order) throw new ApiError(404, 'not_found');
      const amount = Number(order['amount_minor']);
      const refunded = Number(order['refunded_minor']);
      const remaining = amount - refunded;
      if (remaining <= 0) throw new ApiError(409, 'fully_refunded');
      if (amountMinor! > remaining) {
        throw validationFailed({ amount_minor: FIELDS.refundCap(remaining, String(order['currency']) as Currency) });
      }
      currency = String(order['currency']);
      paymentId = String(order['killbill_payment_id']);
      await conn.query('COMMIT');
    } catch (e) {
      await conn.query('ROLLBACK');
      throw e;
    } finally {
      app.pool.release(conn);
    }

    try {
      await app.kb.refundPayment(paymentId, minorToMajorString(amountMinor!, currency as Currency), currency as Currency);
    } catch {
      throw new ApiError(503, 'billing_unavailable');
    }

    const conn2 = await app.pool.acquire();
    try {
      await conn2.query('BEGIN');
      const upd = await conn2.query(
        `UPDATE orders SET refunded_minor = refunded_minor + $2,
           status = CASE WHEN refunded_minor + $2 >= amount_minor THEN 'refunded' ELSE 'partially_refunded' END
         WHERE id = $1 RETURNING user_id, session_id`,
        [orderId, amountMinor],
      );
      const order = upd.rows[0];
      await conn2.query(
        `INSERT INTO refunds (id, order_id, amount_minor, reason, at, killbill_refund_id) VALUES ($1,$2,$3,$4,now(),$5)`,
        [crypto.randomUUID(), orderId, amountMinor, reason!.trim(), paymentId],
      );
      await conn2.query('COMMIT');
      if (order && order['session_id']) {
        const full = await app.pool.query(`SELECT amount_minor, refunded_minor FROM orders WHERE id = $1`, [orderId]);
        const row = full.rows[0];
        if (row && Number(row['refunded_minor']) >= Number(row['amount_minor'])) {
          await app.pool.query(`UPDATE bookings SET live = false WHERE session_id = $1 AND user_id = $2`, [
            String(order['session_id']),
            String(order['user_id']),
          ]);
        }
      }
    } catch (e) {
      await conn2.query('ROLLBACK');
      throw e;
    } finally {
      app.pool.release(conn2);
    }

    const buyerRow = await app.pool.query(`SELECT user_id, receipt_number FROM orders WHERE id = $1`, [orderId]);
    const buyer = await app.pb.getUserById(String(buyerRow.rows[0]!['user_id']));
    const receiptNumber = String(buyerRow.rows[0]!['receipt_number']);
    await app.mail.enqueue({
      toEmail: buyer?.email ?? 'unknown@halden.test',
      toName: buyer?.name ?? 'Visitor',
      subject: `Your refund — receipt ${receiptNumber}`,
      body: [
        `Hello ${buyer?.name ?? 'visitor'},`,
        '',
        `Your refund of ${formatPrice(amountMinor!, currency as Currency)} has been issued.`,
        '',
        'Halden Reading Room',
      ].join('\n'),
      dedupeKey: `refund:${orderId}:${amountMinor}`,
    });
    await recordAction(app, user.email, 'refund', 'order', orderId, { amount_minor: amountMinor, reason: reason!.trim() });
    const { orderById } = await import('./commerce.ts');
    const order = await orderById(app, orderId);
    sendJson(ctx.res, 201, { refund: { amount_minor: amountMinor, reason: reason!.trim() }, order });
  });

  route('POST', '/api/manager/orders/:id/notes', async (ctx) => {
    const user = await requireManager(ctx);
    const orderId = ctx.path.split('/')[4] ?? '';
    const body = await readJson(ctx);
    const text = asString(body['text']);
    if (text === null || text.length < 1 || text.length > 500) throw validationFailed({ text: 'Check the highlighted fields.' });
    const exists = await app.pool.query(`SELECT id FROM orders WHERE id = $1`, [orderId]);
    if (!exists.rows.length) throw new ApiError(404, 'not_found');
    const id = crypto.randomUUID();
    await app.pool.query(`INSERT INTO order_notes (id, order_id, text, author_email) VALUES ($1,$2,$3,$4)`, [id, orderId, text, user.email]);
    await recordAction(app, user.email, 'order_note', 'order', orderId, { text });
    sendJson(ctx.res, 201, { note: { id, text, author_email: user.email } });
  });

  route('GET', '/api/manager/dunning', async (ctx) => {
    await requireManager(ctx);
    const rows = await app.pool.query(
      `SELECT d.user_id, d.tier, d.currency, d.amount_minor, d.failed_at, d.attempts, d.next_retry_at
       FROM dunning d WHERE d.cancelled = false AND d.settled_order_id IS NULL`,
    );
    const out = [];
    for (const r of rows.rows) {
      const user = await app.pb.getUserById(String(r['user_id']));
      out.push({
        user_email: user?.email ?? '',
        name: user?.name ?? '',
        tier: String(r['tier']),
        currency: String(r['currency']),
        amount_due_minor: Number(r['amount_minor']),
        failed_at: new Date(r['failed_at'] as Date).toISOString(),
        attempts: Number(r['attempts']),
        next_retry_at: r['next_retry_at'] ? new Date(r['next_retry_at'] as Date).toISOString() : null,
      });
    }
    sendJson(ctx.res, 200, { overdue: out });
  });

  route('GET', '/api/manager/reconciliation', async (ctx) => {
    await requireManager(ctx);
    const month = ctx.query.get('month') ?? toDateIso(app.now()).slice(0, 7);
    if (!parseMonth(month)) throw validationFailed({ month: 'Check the highlighted fields.' });
    const start = monthStart(month);
    const end = monthEnd(month);

    const ledger = await app.pool.query(
      `SELECT currency, SUM(amount_minor) AS net FROM orders WHERE settled_at >= $1 AND settled_at < $2 GROUP BY currency`,
      [new Date(start), new Date(end)],
    );
    const ledgerRefunds = await app.pool.query(
      `SELECT o.currency, SUM(r.amount_minor) AS net FROM refunds r JOIN orders o ON o.id = r.order_id
       WHERE r.at >= $1 AND r.at < $2 GROUP BY o.currency`,
      [new Date(start), new Date(end)],
    );
    const ledgerMap = new Map<string, number>();
    for (const r of ledger.rows) ledgerMap.set(String(r['currency']), Number(r['net'] ?? 0));
    for (const r of ledgerRefunds.rows) {
      const key = String(r['currency']);
      ledgerMap.set(key, (ledgerMap.get(key) ?? 0) - Number(r['net'] ?? 0));
    }

    const accountIds = (await app.pool.query(`SELECT account_id FROM kb_accounts`)).rows.map((r) => String(r['account_id']));
    const kbMap = new Map<string, number>();
    try {
      for (const accountId of accountIds) {
        const payments = await app.kb.listAccountPayments(accountId);
        for (const p of payments) {
          for (const t of p.transactions) {
            const eff = Date.parse(t.effectiveDate);
            if (eff < start || eff >= end) continue;
            const scale = t.currency === 'JPY' ? 1 : 100;
            const amount = Math.round(t.processedAmount * scale);
            if (t.status !== 'SUCCESS') continue;
            if (t.transactionType === 'PURCHASE') kbMap.set(t.currency, (kbMap.get(t.currency) ?? 0) + amount);
            else if (t.transactionType === 'REFUND') kbMap.set(t.currency, (kbMap.get(t.currency) ?? 0) - amount);
          }
        }
      }
    } catch {
      throw new ApiError(503, 'billing_unavailable');
    }

    const currencies = ['EUR', 'GBP', 'USD', 'JPY'];
    sendJson(ctx.res, 200, {
      month,
      currencies: currencies.map((c) => {
        const ledgerNet = ledgerMap.get(c) ?? 0;
        const kbNet = kbMap.get(c) ?? 0;
        const difference = ledgerNet - kbNet;
        return { currency: c, ledger_net_minor: ledgerNet, killbill_net_minor: kbNet, difference_minor: difference, matched: difference === 0 };
      }),
    });
  });

  route('POST', '/api/manager/plan-prices', async (ctx) => {
    const user = await requireManager(ctx);
    const body = await readJson(ctx);
    const tier = asString(body['tier']);
    const currency = asString(body['currency']);
    const amountMinor = asInteger(body['amount_minor']);
    const effectiveOn = asString(body['effective_on']);
    const fields: Record<string, string> = {};
    if (tier !== 'reader' && tier !== 'fellow' && tier !== 'patron') fields['tier'] = 'Check the highlighted fields.';
    if (currency !== 'EUR' && currency !== 'GBP' && currency !== 'USD' && currency !== 'JPY') fields['currency'] = 'Check the highlighted fields.';
    if (amountMinor === null || amountMinor < 1 || amountMinor > 1_000_000) fields['amount_minor'] = FIELDS.amountFormat;
    if (effectiveOn === null || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) fields['effective_on'] = FIELDS.effectiveDate;
    if (Object.keys(fields).length) throw validationFailed(fields);

    const m = effectiveOn!.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
    const effectiveMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = app.now();
    const off = offsetAt(now);
    const shifted = new Date(now + off * 60_000);
    const todayMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    if (effectiveMs <= todayMs) throw validationFailed({ effective_on: FIELDS.effectiveDate });

    const existing = await app.pool.query(
      `SELECT effective_on FROM price_changes WHERE tier = $1 AND currency = $2 AND effective_on > CURRENT_DATE ORDER BY effective_on DESC LIMIT 1`,
      [tier, currency],
    );
    const latest = existing.rows[0]?.['effective_on'];
    if (latest !== undefined) {
      const latestMs = Date.parse(`${String(latest)}T00:00:00Z`);
      if (effectiveMs <= latestMs) throw new ApiError(409, 'price_change_conflict');
    }
    const id = crypto.randomUUID();
    await app.pool.query(
      `INSERT INTO price_changes (id, tier, currency, amount_minor, effective_on) VALUES ($1,$2,$3,$4,$5)`,
      [id, tier, currency, amountMinor, effectiveOn],
    );
    await recordAction(app, user.email, 'price_change', 'tier', tier!, { currency, amount_minor: amountMinor, effective_on: effectiveOn });
    sendJson(ctx.res, 201, { change: { tier, currency, amount_minor: amountMinor, effective_on: effectiveOn } });
  });

  route('GET', '/api/manager/audit', async (ctx) => {
    const user = await requireUser(ctx, app);
    if (user.role !== 'manager' && user.role !== 'lead_curator') throw new ApiError(403, 'forbidden');
    const rows = await app.pool.query(
      `SELECT id, at, actor_email, action, target_type, target_id, detail FROM audit ORDER BY id DESC LIMIT 200`,
    );
    sendJson(ctx.res, 200, {
      actions: rows.rows.map((r) => ({
        id: String(r['id']),
        at: new Date(r['at'] as Date).toISOString(),
        actor_email: String(r['actor_email']),
        action: String(r['action']),
        target_type: String(r['target_type']),
        target_id: String(r['target_id']),
        detail: r['detail'] ?? null,
      })),
    });
  });
}

export type { Value };
