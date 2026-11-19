import type { Order } from '../../shared/api.js';
import { isUniqueViolation, transaction, type Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { holdExpiryFrom, isHoldExpired, nearestFreeEdition, secondsLeft } from '../domain/holds.js';
import { requireOrderMove, type EditionOrderState } from '../domain/states.js';
import { isSupportedBillingCountry, priceWithVat } from '../domain/vat.js';
import { KillBillUnavailable, chargeAndPay, ensureAccount } from '../providers/killbill.js';
import type { Principal } from '../auth/identity.js';
import { hasRole } from '../auth/identity.js';
import { COLLECTED_SQL, LIVE_HOLD_SQL, loadPieceBySlugFor } from './pieceRows.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OrderRow {
  id: string;
  piece_id: string;
  piece_slug: string;
  piece_title: string;
  collector_id: string;
  edition_number: number;
  edition_count: number;
  state: EditionOrderState;
  expires_at: Date | null;
  billing_name: string | null;
  email: string | null;
  billing_country: string | null;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  invoice_number: string | null;
  invoice_status: 'none' | 'pending' | 'ready';
  invoice_object_key: string | null;
  receipt_status: 'none' | 'queued' | 'sent';
  refunded_net_cents: number;
  paid_at: Date | null;
  killbill_invoice_id: string | null;
  killbill_payment_id: string | null;
  created_at: Date;
}

export const ORDER_SELECT = `
  SELECT o.id, o.piece_id, o.collector_id, o.edition_number, o.edition_count, o.state,
         o.expires_at, o.billing_name, o.email, o.billing_country, o.net_cents,
         o.vat_rate_percent, o.vat_cents, o.gross_cents, o.invoice_number, o.invoice_status,
         o.invoice_object_key, o.receipt_status, o.refunded_net_cents, o.paid_at,
         o.killbill_invoice_id, o.killbill_payment_id, o.created_at,
         p.slug AS piece_slug, p.title AS piece_title
  FROM edition_orders o
  JOIN pieces p ON p.id = o.piece_id
`;

/** A held order whose time has run out is reported as expired. */
function effectiveState(row: OrderRow, now: Date): EditionOrderState {
  if (row.state === 'held' && row.expires_at && isHoldExpired(row.expires_at, now)) {
    return 'expired';
  }
  return row.state;
}

export function toOrder(row: OrderRow, now: Date = new Date()): Order {
  const state = effectiveState(row, now);
  const live = state === 'held';
  return {
    id: row.id,
    piece_slug: row.piece_slug,
    piece_title: row.piece_title,
    edition: row.edition_number,
    edition_count: row.edition_count,
    state,
    expires_at: live && row.expires_at ? row.expires_at.toISOString() : null,
    seconds_left: live && row.expires_at ? secondsLeft(row.expires_at, now) : null,
    billing_name: row.billing_name,
    email: row.email,
    billing_country: row.billing_country,
    net_cents: row.net_cents,
    vat_rate_percent: row.vat_rate_percent,
    vat_cents: row.vat_cents,
    gross_cents: row.gross_cents,
    currency: 'USD',
    invoice_number: row.invoice_number,
    invoice_status: row.invoice_status,
    receipt_status: row.receipt_status,
    refunded_net_cents: row.refunded_net_cents,
    paid_at: row.paid_at ? row.paid_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

export async function loadOrder(
  client: Queryable,
  orderId: string,
  forUpdate: boolean,
): Promise<OrderRow | null> {
  const result = await client.query<OrderRow>(
    `${ORDER_SELECT} WHERE o.id = $1${forUpdate ? ' FOR UPDATE OF o' : ''}`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

/** Owner or founder-operator; anyone else gets the same 404 as for a missing order. */
export async function getOrderFor(viewer: Principal, orderId: string): Promise<Order> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw ApiError.notFound();
  const row = await transaction((client) => loadOrder(client, orderId, false));
  if (!row) throw ApiError.notFound();
  if (row.collector_id !== viewer.id && !hasRole(viewer, 'founder-operator')) {
    throw ApiError.notFound();
  }
  return toOrder(row);
}

async function expireStaleHolds(client: Queryable, pieceId: string): Promise<void> {
  await client.query(
    `UPDATE edition_orders SET state = 'expired'
     WHERE piece_id = $1 AND state = 'held' AND expires_at <= now()`,
    [pieceId],
  );
}

async function takenNumbers(client: Queryable, pieceId: string): Promise<Set<number>> {
  const result = await client.query<{ edition_number: number }>(
    `SELECT o.edition_number FROM edition_orders o
     WHERE o.piece_id = $1 AND (${LIVE_HOLD_SQL} OR ${COLLECTED_SQL})`,
    [pieceId],
  );
  return new Set(result.rows.map((row) => row.edition_number));
}

/**
 * Reserves one edition number for one collector. When several collectors ask for
 * the same available number at once, exactly one gets it.
 */
export async function holdEdition(
  collector: Principal,
  slug: string,
  editionNumber: number,
): Promise<{ status: number; order: Order }> {
  return transaction(async (client) => {
    const piece = await loadPieceBySlugFor(client, slug, false);
    if (!piece || piece.state !== 'published' || piece.edition_count === null) {
      throw ApiError.notFound();
    }
    if (!Number.isInteger(editionNumber) || editionNumber < 1 || editionNumber > piece.edition_count) {
      throw ApiError.notFound();
    }
    if (piece.creator_id === collector.id) {
      throw new ApiError(409, 'own_piece', 'You cannot collect your own piece.');
    }

    await expireStaleHolds(client, piece.id);

    const mine = await client.query<OrderRow>(
      `${ORDER_SELECT}
       WHERE o.piece_id = $1 AND o.collector_id = $2 AND o.edition_number = $3
         AND (o.state = 'paying' OR (o.state = 'held' AND o.expires_at > now()))`,
      [piece.id, collector.id, editionNumber],
    );
    const existing = mine.rows[0];
    if (existing) {
      return { status: 200, order: toOrder(existing) };
    }

    // A collector has at most one held order per piece.
    await client.query(
      `UPDATE edition_orders SET state = 'expired'
       WHERE piece_id = $1 AND collector_id = $2 AND state = 'held'`,
      [piece.id, collector.id],
    );

    const grantedAt = new Date();
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO edition_orders (piece_id, collector_id, edition_number, edition_count, state,
                                     expires_at, net_cents)
         VALUES ($1, $2, $3, $4, 'held', $5, $6)
         RETURNING id`,
        [
          piece.id,
          collector.id,
          editionNumber,
          piece.edition_count,
          holdExpiryFrom(grantedAt),
          piece.price_cents ?? 0,
        ],
      );
      const orderId = inserted.rows[0]?.id;
      if (!orderId) throw new Error('Hold insert returned no id');
      const row = await loadOrder(client, orderId, false);
      if (!row) throw new Error('New hold vanished before it could be read');
      return { status: 201, order: toOrder(row) };
    } catch (error) {
      if (!isUniqueViolation(error, 'edition_orders_live_number_idx')) throw error;
      throw new ApiError(409, 'edition_taken', 'That edition was just taken.', {
        detail: { next_free: null },
      });
    }
  }).catch(async (error: unknown) => {
    if (!(error instanceof ApiError) || error.code !== 'edition_taken') throw error;
    const nextFree = await transaction(async (client) => {
      const piece = await loadPieceBySlugFor(client, slug, false);
      if (!piece || piece.edition_count === null) return null;
      await expireStaleHolds(client, piece.id);
      return nearestFreeEdition(
        editionNumber,
        piece.edition_count,
        await takenNumbers(client, piece.id),
      );
    });
    throw new ApiError(409, 'edition_taken', 'That edition was just taken.', {
      detail: { next_free: nextFree },
    });
  });
}

export async function currentOrderForPiece(collector: Principal, slug: string): Promise<Order> {
  const row = await transaction(async (client) => {
    const piece = await loadPieceBySlugFor(client, slug, false);
    if (!piece) throw ApiError.notFound();
    await expireStaleHolds(client, piece.id);
    const result = await client.query<OrderRow>(
      `${ORDER_SELECT}
       WHERE o.piece_id = $1 AND o.collector_id = $2
         AND (o.state = 'paying' OR (o.state = 'held' AND o.expires_at > now()))
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [piece.id, collector.id],
    );
    return result.rows[0] ?? null;
  });
  if (!row) throw ApiError.notFound();
  return toOrder(row);
}

export async function releaseHold(collector: Principal, orderId: string): Promise<Order> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw ApiError.notFound();
  return transaction(async (client) => {
    const row = await loadOrder(client, orderId, true);
    if (!row || row.collector_id !== collector.id) throw ApiError.notFound();
    requireOrderMove(row.state, 'expired');
    await client.query("UPDATE edition_orders SET state = 'expired' WHERE id = $1", [row.id]);
    const updated = await loadOrder(client, orderId, false);
    if (!updated) throw new Error('Released order vanished before it could be read');
    return toOrder(updated);
  });
}

interface BuyBody {
  billingName: string;
  email: string;
  billingCountry: string;
}

function readBuyBody(body: unknown): BuyBody {
  const fields: Record<string, string> = {};
  const input = (body ?? {}) as Record<string, unknown>;

  const billingName = typeof input.billing_name === 'string' ? input.billing_name.trim() : '';
  if (billingName === '' || billingName.length > 120) {
    fields.billing_name = 'Enter the name for the invoice.';
  }

  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!EMAIL_PATTERN.test(email)) {
    fields.email = 'Enter an email address.';
  }

  const billingCountry = typeof input.billing_country === 'string' ? input.billing_country : '';
  if (!isSupportedBillingCountry(billingCountry)) {
    fields.billing_country = "We can't invoice that country yet.";
  }

  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);
  return { billingName, email, billingCountry };
}

/**
 * Charges the gross price through Kill Bill and moves the order to paying.
 * Nothing is recorded locally when Kill Bill is unreachable.
 */
export async function buyOrder(
  collector: Principal,
  orderId: string,
  body: unknown,
): Promise<Order> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw ApiError.notFound();

  const prepared = await transaction(async (client) => {
    const row = await loadOrder(client, orderId, false);
    if (!row || row.collector_id !== collector.id) throw ApiError.notFound();

    if (row.state === 'held' && row.expires_at && isHoldExpired(row.expires_at, new Date())) {
      throw new ApiError(409, 'hold_expired', 'That hold has run out.');
    }
    requireOrderMove(row.state, 'paying');

    const buy = readBuyBody(body);
    const priced = priceWithVat(row.net_cents, buy.billingCountry);
    return { row, buy, priced };
  });

  let charge: { invoiceId: string; paymentId: string };
  try {
    const accountId = await ensureAccount({
      id: collector.id,
      displayName: collector.displayName,
      email: collector.email,
    });
    await transaction((client) =>
      client.query(
        `INSERT INTO killbill_accounts (user_id, account_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET account_id = EXCLUDED.account_id`,
        [collector.id, accountId],
      ),
    );
    charge = await chargeAndPay(
      accountId,
      prepared.priced.grossCents,
      `${prepared.row.piece_title} \u2014 edition ${prepared.row.edition_number} of ${prepared.row.edition_count}`,
    );
  } catch (error) {
    if (error instanceof KillBillUnavailable) throw ApiError.paymentsUnavailable();
    throw error;
  }

  return transaction(async (client) => {
    const row = await loadOrder(client, orderId, true);
    if (!row) throw ApiError.notFound();
    requireOrderMove(row.state, 'paying');

    await client.query(
      `UPDATE edition_orders
       SET state = 'paying', billing_name = $2, email = $3, billing_country = $4,
           vat_rate_percent = $5, vat_cents = $6, gross_cents = $7,
           killbill_invoice_id = $8, killbill_payment_id = $9
       WHERE id = $1`,
      [
        row.id,
        prepared.buy.billingName,
        prepared.buy.email,
        prepared.buy.billingCountry,
        prepared.priced.vatRatePercent,
        prepared.priced.vatCents,
        prepared.priced.grossCents,
        charge.invoiceId,
        charge.paymentId,
      ],
    );

    const updated = await loadOrder(client, orderId, false);
    if (!updated) throw new Error('Paying order vanished before it could be read');
    return toOrder(updated);
  });
}

export async function listOwnOrders(collector: Principal): Promise<Order[]> {
  const result = await transaction((client) =>
    client.query<OrderRow>(
      `${ORDER_SELECT}
       WHERE o.collector_id = $1 AND o.state <> 'expired'
       ORDER BY o.created_at DESC`,
      [collector.id],
    ),
  );
  const now = new Date();
  return result.rows.map((row) => toOrder(row, now)).filter((order) => order.state !== 'expired');
}
