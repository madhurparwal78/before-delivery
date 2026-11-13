import crypto from 'node:crypto';
import type { App, User } from './app.ts';
import { requireUser } from './platform.ts';
import type { RouteContext } from './http.ts';
import { ApiError, sendJson, validationFailed } from './http.ts';
import { readJson, asString, asInteger, asNumber } from './params.ts';
import { validKey, begin, finish, release } from '../core/idempotency.ts';
import { normalizeCard, decideCharge } from '../core/cards.ts';
import { cardCurrency, deriveStatus, seatsLeft, toPublicSession, type SessionRow } from './sessions.ts';
import { TICKET_PRICES, DONATION_MIN, DONATION_MAX, TIER_PRICES, TIER_NAMES } from '../core/seed.ts';
import { isCurrency, type Currency, minorToMajorString } from '../core/money.ts';
import { issueReceiptArtifacts, chargeKillBill, type ReceiptOrder } from '../core/commerce.ts';
import { allocateReceiptNumber } from '../core/receipts.ts';
import { FIELDS } from '../core/copy.ts';

/** The plan name Kill Bill holds for each tier. */
export function planForTier(tier: string): string {
  return `supporter-${tier}-monthly`;
}

export function tierOfPlan(plan: string): string {
  return plan.replace('supporter-', '').replace('-monthly', '');
}

export function registerCommerceRoutes(app: App, route: (method: string, pattern: string, handler: (ctx: RouteContext) => Promise<void>) => void): void {
  route('GET', '/api/catalog', async (ctx) => {
    const tiers = await scheduledPriceChanges(app);
    sendJson(ctx.res, 200, {
      currencies: ['EUR', 'GBP', 'USD', 'JPY'],
      ticket: { prices: TICKET_PRICES },
      tiers: ['reader', 'fellow', 'patron'].map((tier) => ({
        tier,
        name: TIER_NAMES[tier as 'reader' | 'fellow' | 'patron'],
        prices: TIER_PRICES[tier as 'reader' | 'fellow' | 'patron'],
        scheduled_changes: (tiers.get(tier) ?? []).map((c) => ({ currency: c.currency, amount_minor: c.amount_minor, effective_on: c.effective_on })),
      })),
      donation: { min_minor: DONATION_MIN, max_minor: DONATION_MAX },
    });
  });

  route('GET', '/api/sessions', async (ctx) => {
    const res = await app.pool.query(`SELECT id, title, starts_at, duration_minutes, capacity, status FROM sessions ORDER BY starts_at`);
    const user = await optionalUser(ctx, app);
    const currency = await cardCurrency(app, user);
    const now = app.now();
    let pricesAvailable = true;
    try {
      await app.kb.request('GET', '/1.0/kb/catalog');
    } catch {
      pricesAvailable = false;
    }
    const sessions = [];
    for (const row of res.rows) {
      const srow: SessionRow = {
        id: String(row['id']),
        title: String(row['title']),
        starts_at: new Date(row['starts_at'] as Date),
        duration_minutes: Number(row['duration_minutes']),
        capacity: Number(row['capacity']),
        status: String(row['status']),
      };
      const seats = await seatsLeft(app, srow.id, srow.capacity);
      const derived = deriveStatus(srow, seats, now);
      sessions.push(toPublicSession(srow, derived, pricesAvailable ? { minor: TICKET_PRICES[currency] ?? 1200, currency } : undefined));
    }
    sendJson(ctx.res, 200, { server_time: new Date(now).toISOString(), sessions });
  });

  const withIdempotency = (
    pattern: string,
    run: (ctx: RouteContext, user: User) => Promise<{ status: number; body: string }>,
  ): void => {
    route('POST', pattern, async (ctx) => {
      const user = await requireUser(ctx, app);
      const headerValue = ctx.req.headers['idempotency-key'];
      const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (!validKey(key)) throw new ApiError(400, 'idempotency_key_required');
      const raw = await ctx.rawBody();
      const outcome = await begin(app.pool, user.id, key, 'POST', ctx.path, raw);
      if (outcome.kind === 'conflict') throw new ApiError(409, 'idempotency_conflict');
      if (outcome.kind === 'replay') {
        ctx.res.writeHead(outcome.status, { 'Content-Type': 'application/json; charset=utf-8', 'Idempotent-Replayed': 'true' });
        ctx.res.end(outcome.body);
        return;
      }
      try {
        const result = await run(ctx, user);
        await finish(app.pool, user.id, key, result.status, result.body);
        if (!ctx.res.headersSent) {
          ctx.res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
          ctx.res.end(result.body);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          const body = JSON.stringify(e.body());
          await finish(app.pool, user.id, key, e.status, body);
          if (!ctx.res.headersSent) {
            ctx.res.writeHead(e.status, { 'Content-Type': 'application/json; charset=utf-8' });
            ctx.res.end(body);
          }
          return;
        }
        await release(app.pool, user.id, key);
        throw e;
      }
    });
  };

  withIdempotency('/api/sessions/:id/bookings', async (ctx, user) => createBooking(app, ctx, user));
  withIdempotency('/api/donations', async (ctx, user) => createDonation(app, ctx, user));

  route('GET', '/api/me/orders', async (ctx) => {
    const user = await requireUser(ctx, app);
    const orders = await listOrders(app, user.id);
    sendJson(ctx.res, 200, { orders });
  });

  route('GET', '/api/orders/:id/receipt', async (ctx) => {
    const user = await requireUser(ctx, app);
    const id = ctx.path.split('/')[3] ?? '';
    const res = await app.pool.query(`SELECT user_id, receipt_number FROM orders WHERE id = $1`, [id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(404, 'not_found');
    if (row['user_id'] !== user.id && user.role !== 'manager') throw new ApiError(404, 'not_found');
    try {
      const url = app.storage.presignGet(`receipts/${String(row['receipt_number'])}.pdf`);
      ctx.res.writeHead(302, { Location: url });
      ctx.res.end();
    } catch {
      throw new ApiError(503, 'storage_unavailable');
    }
  });
}

async function optionalUser(ctx: RouteContext, app: App): Promise<User | null> {
  const token = ctx.cookies['sl_session'];
  if (!token) return null;
  const { userForToken } = await import('./app.ts');
  return userForToken(app, token);
}

async function scheduledPriceChanges(app: App): Promise<Map<string, Array<{ currency: string; amount_minor: number; effective_on: string }>>> {
  const res = await app.pool.query(
    `SELECT tier, currency, amount_minor, to_char(effective_on, 'YYYY-MM-DD') AS effective_on FROM price_changes
     WHERE effective_on > CURRENT_DATE ORDER BY effective_on`,
  );
  const out = new Map<string, Array<{ currency: string; amount_minor: number; effective_on: string }>>();
  for (const row of res.rows) {
    const tier = String(row['tier']);
    const list = out.get(tier) ?? [];
    list.push({ currency: String(row['currency']), amount_minor: Number(row['amount_minor']), effective_on: String(row['effective_on']) });
    out.set(tier, list);
  }
  return out;
}

export async function listOrders(app: App, userId: string): Promise<unknown[]> {
  const res = await app.pool.query(
    `SELECT id, receipt_number, kind, description, currency, amount_minor, refunded_minor, status, settled_at, card_last4
     FROM orders WHERE user_id = $1 ORDER BY settled_at DESC`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: String(r['id']),
    receipt_number: String(r['receipt_number']),
    kind: String(r['kind']),
    description: String(r['description']),
    currency: String(r['currency']),
    amount_minor: Number(r['amount_minor']),
    refunded_minor: Number(r['refunded_minor']),
    status: String(r['status']),
    settled_at: new Date(r['settled_at'] as Date).toISOString(),
    card_last4: String(r['card_last4']),
    receipt_url: `/api/orders/${String(r['id'])}/receipt`,
  }));
}

interface BookingRequest {
  seats: number;
  currency: Currency;
  cardDigits: string;
}

function parseBookingRequest(ctx: RouteContext): Promise<BookingRequest> {
  return readJson(ctx).then((body) => {
    const seats = asInteger(body['seats']);
    const currency = body['currency'];
    const cardInput = asString(body['card_number']);
    const fields: Record<string, string> = {};
    if (seats === null || seats < 1 || seats > 4) fields['seats'] = FIELDS.seats;
    if (!isCurrency(currency)) fields['currency'] = 'Check the highlighted fields.';
    const cardDigits = cardInput === null ? null : normalizeCard(cardInput);
    if (cardDigits === null) fields['card_number'] = FIELDS.card;
    if (Object.keys(fields).length) throw validationFailed(fields);
    return { seats: seats!, currency: currency as Currency, cardDigits: cardDigits! };
  });
}

/**
 * Booking: seats are decided atomically before charging, and a booking that
 * commits after the seats are gone is refused with no Kill Bill charge.
 */
async function createBooking(app: App, ctx: RouteContext, user: User): Promise<{ status: number; body: string }> {
  const req = await parseBookingRequest(ctx);
  const sessionId = ctx.path.split('/')[3] ?? '';
  const res = await app.pool.query(
    `SELECT id, title, starts_at, duration_minutes, capacity, status FROM sessions WHERE id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) throw new ApiError(404, 'not_found');
  const srow: SessionRow = {
    id: String(row['id']),
    title: String(row['title']),
    starts_at: new Date(row['starts_at'] as Date),
    duration_minutes: Number(row['duration_minutes']),
    capacity: Number(row['capacity']),
    status: String(row['status']),
  };
  const now = app.now();
  const seatsNow = await seatsLeft(app, srow.id, srow.capacity);
  const derived = deriveStatus(srow, seatsNow, now);
  if (derived.status !== 'on_sale') throw new ApiError(409, 'booking_closed');
  if (derived.seatsLeft < req.seats) throw new ApiError(409, 'sold_out');

  const account = await ensureAccount(app, user, req.currency);
  if (account.currency !== req.currency) {
    throw new ApiError(409, 'currency_locked', undefined, `Your supporter account pays in ${account.currency}. Choose ${account.currency} to continue.`);
  }

  await assertBilling(app);
  await assertStorage(app);

  const ticketCode = `T-${randomTicket()}`;
  const taken = await takeSeats(app, srow.id, user.id, req.seats, ticketCode);
  if (!taken) throw new ApiError(409, 'sold_out');
  // From here a failure removes the booking row, freeing the seats again.
  const releaseTaken = async (): Promise<void> => {
    await app.pool.query(`DELETE FROM bookings WHERE id = $1`, [taken.bookingId]);
  };

  const decision = await decideCharge(app.pool, user.id, req.cardDigits);
  const priceMinor = (TICKET_PRICES[req.currency] ?? 0) * req.seats;
  const description = `Guided session: ${srow.title} × ${req.seats}`;

  if (!decision.approved) {
    await releaseTaken();
    throw new ApiError(402, 'card_declined');
  }

  let charge;
  try {
    charge = await chargeKillBill(app.kb, account.accountId, priceMinor, req.currency, description);
  } catch (e) {
    await releaseTaken();
    throw new ApiError(503, 'billing_unavailable');
  }

  const orderId = crypto.randomUUID();
  let receipt: string;
  try {
    receipt = await recordSettlement(app, {
      id: orderId,
      userId: user.id,
      kind: 'ticket',
      description,
      currency: req.currency,
      amountMinor: priceMinor,
      cardLast4: decision.last4,
      sessionId: srow.id,
      ticketCode,
      kbAccountId: account.accountId,
      kbInvoiceId: charge.invoiceId,
      kbPaymentId: charge.paymentId,
    });
  } catch {
    await releaseTaken();
    try {
      await app.kb.refundPayment(charge.paymentId, minorToMajorString(priceMinor, req.currency), req.currency);
    } catch {
      /* retried by the reconciliation sweep */
    }
    throw new ApiError(503, 'storage_unavailable');
  }
  const bookingId = taken.bookingId;

  const order = (await orderById(app, orderId)) as unknown as ReceiptOrder;
  const receiptEmail = await issueReceiptArtifacts(app, {
    userName: user.name,
    userEmail: user.email,
    receipt,
    order,
    kind: 'ticket',
    sessionStartsAtMs: srow.starts_at.getTime(),
    seats: req.seats,
    ticketCode,
    subject: `Your ticket for ${srow.title} — receipt ${receipt}`,
  });

  const responseBody = JSON.stringify({
    booking: { id: bookingId, ticket_code: ticketCode, session_id: srow.id, seats: req.seats },
    order,
    receipt_email: receiptEmail,
  });
  return { status: 201, body: responseBody };
}

/** Seats fit only when the counter plus the request stays within capacity. */
/**
 * Seats are taken atomically before charging: the booking row is inserted
 * inside the same transaction that checks capacity, so simultaneous bookings
 * are serialised against the live seat count. A failed charge removes the row.
 */
async function takeSeats(
  app: App,
  sessionId: string,
  userId: string,
  seats: number,
  ticketCode: string,
): Promise<{ bookingId: string } | null> {
  const conn = await app.pool.acquire();
  try {
    await conn.query('BEGIN');
    const cap = await conn.query(`SELECT capacity FROM sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
    if (!cap.rows.length) {
      await conn.query('ROLLBACK');
      return null;
    }
    const takenRes = await conn.query(
      `SELECT COALESCE(SUM(seats), 0) AS taken FROM bookings WHERE session_id = $1 AND live`,
      [sessionId],
    );
    const taken = Number(takenRes.rows[0]!['taken']);
    const capacity = Number(cap.rows[0]!['capacity']);
    if (taken + seats > capacity) {
      await conn.query('ROLLBACK');
      return null;
    }
    const bookingId = crypto.randomUUID();
    await conn.query(
      `INSERT INTO bookings (id, session_id, user_id, seats, ticket_code, live) VALUES ($1,$2,$3,$4,$5,true)`,
      [bookingId, sessionId, userId, seats, ticketCode],
    );
    await conn.query('COMMIT');
    return { bookingId };
  } catch {
    await conn.query('ROLLBACK');
    return null;
  } finally {
    app.pool.release(conn);
  }
}

async function createDonation(app: App, ctx: RouteContext, user: User): Promise<{ status: number; body: string }> {
  const body = await readJson(ctx);
  const amountMinor = asInteger(body['amount_minor']) ?? 0;
  const currency: unknown = body['currency'];
  const cardInput = asString(body['card_number']);
  const note = body['note'];
  const fields: Record<string, string> = {};
  const cur: Currency = isCurrency(currency) ? currency : 'EUR';
  const minMinor = DONATION_MIN[cur] ?? 100;
  const maxMinor = DONATION_MAX[cur] ?? 500000;
  if (amountMinor < minMinor || amountMinor > maxMinor) {
    fields['amount_minor'] = FIELDS.donationAmount(minMinor, maxMinor, cur);
  }
  if (!isCurrency(currency)) fields['currency'] = 'Check the highlighted fields.';
  const cardDigits = cardInput === null ? null : normalizeCard(cardInput);
  if (cardDigits === null) fields['card_number'] = FIELDS.card;
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    fields['note'] = 'Check the highlighted fields.';
  }
  if (Object.keys(fields).length) throw validationFailed(fields);

  const account = await ensureAccount(app, user, cur);
  if (account.currency !== cur) {
    throw new ApiError(409, 'currency_locked', undefined, `Your supporter account pays in ${account.currency}. Choose ${account.currency} to continue.`);
  }

  await assertBilling(app);
  await assertStorage(app);

  const decision = await decideCharge(app.pool, user.id, cardDigits!);
  if (!decision.approved) throw new ApiError(402, 'card_declined');

  let charge;
  try {
    charge = await chargeKillBill(app.kb, account.accountId, amountMinor, cur, 'Donation');
  } catch {
    throw new ApiError(503, 'billing_unavailable');
  }

  const orderId = crypto.randomUUID();
  let receipt: string;
  try {
    receipt = await recordSettlement(app, {
      id: orderId,
      userId: user.id,
      kind: 'donation',
      description: 'Donation',
      currency: cur,
      amountMinor,
      cardLast4: decision.last4,
      kbAccountId: account.accountId,
      kbInvoiceId: charge.invoiceId,
      kbPaymentId: charge.paymentId,
    });
  } catch {
    try {
      await app.kb.refundPayment(charge.paymentId, minorToMajorString(amountMinor, cur), cur);
    } catch {
      /* retried by the sweep */
    }
    throw new ApiError(503, 'storage_unavailable');
  }

  const order = (await orderById(app, orderId)) as unknown as ReceiptOrder;
  const receiptEmail = await issueReceiptArtifacts(app, {
    userName: user.name,
    userEmail: user.email,
    receipt,
    order,
    kind: 'donation',
    subject: `Thank you for your donation — receipt ${receipt}`,
  });
  return { status: 201, body: JSON.stringify({ order, receipt_email: receiptEmail }) };
}

async function assertBilling(app: App): Promise<void> {
  try {
    await app.kb.request('GET', '/1.0/kb/catalog');
  } catch {
    throw new ApiError(503, 'billing_unavailable');
  }
}

async function assertStorage(app: App): Promise<void> {
  // HEAD a probe object: an answer of any kind (found or not) proves storage is
  // reachable, and only an unreachable storage is an outage.
  await app.storage.head(`receipts/reachable-probe.txt`);
}

/**
 * The Kill Bill account is created at the first payment attempt, in that
 * attempt's currency, which is fixed from then on.
 */
export async function ensureAccount(app: App, user: User, currency: Currency): Promise<{ accountId: string; currency: string }> {
  const res = await app.pool.query(`SELECT account_id, currency FROM kb_accounts WHERE user_id = $1`, [user.id]);
  const row = res.rows[0];
  if (row) return { accountId: String(row['account_id']), currency: String(row['currency']) };
  let account;
  try {
    account = await app.kb.createAccount(user.id, user.name, user.email, currency);
    await app.kb.addAutoPayOff(account.accountId);
  } catch {
    throw new ApiError(503, 'billing_unavailable');
  }
  await app.pool.query(
    `INSERT INTO kb_accounts (user_id, account_id, currency) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING`,
    [user.id, account.accountId, currency],
  );
  return { accountId: account.accountId, currency };
}

/** One ledger row with the next receipt number, allocated atomically. */
export async function recordSettlement(app: App, input: {
  id: string;
  userId: string;
  kind: string;
  description: string;
  currency: Currency;
  amountMinor: number;
  cardLast4: string;
  sessionId?: string | null;
  ticketCode?: string | null;
  kbAccountId: string;
  kbInvoiceId: string;
  kbPaymentId: string;
}): Promise<string> {
  const conn = await app.pool.acquire();
  try {
    await conn.query('BEGIN');
    const receipt = await allocateReceiptNumber(conn);
    await conn.query(
      `INSERT INTO orders (id, receipt_number, kind, user_id, description, currency, amount_minor, refunded_minor,
         status, settled_at, card_last4, session_id, ticket_code, killbill_invoice_id, killbill_payment_id, killbill_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,'settled',now(),$8,$9,$10,$11,$12,$13)`,
      [
        input.id, receipt, input.kind, input.userId, input.description, input.currency, input.amountMinor,
        input.cardLast4, input.sessionId ?? null, input.ticketCode ?? null,
        input.kbInvoiceId, input.kbPaymentId, input.kbAccountId,
      ],
    );
    await conn.query('COMMIT');
    return receipt;
  } catch (e) {
    await conn.query('ROLLBACK');
    throw e;
  } finally {
    app.pool.release(conn);
  }
}

export async function orderById(app: App, id: string): Promise<Record<string, unknown>> {
  const res = await app.pool.query(
    `SELECT id, receipt_number, kind, description, currency, amount_minor, refunded_minor, status, settled_at, card_last4
     FROM orders WHERE id = $1`,
    [id],
  );
  const r = res.rows[0]!;
  return {
    id: String(r['id']),
    receipt_number: String(r['receipt_number']),
    kind: String(r['kind']),
    description: String(r['description']),
    currency: String(r['currency']),
    amount_minor: Number(r['amount_minor']),
    refunded_minor: Number(r['refunded_minor']),
    status: String(r['status']),
    settled_at: new Date(r['settled_at'] as Date).toISOString(),
    card_last4: String(r['card_last4']),
    receipt_url: `/api/orders/${id}/receipt`,
  };
}

function randomTicket(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

export { asNumber };
