import { query, type DbClient } from './db.js';
import { apiError } from './errors.js';
import { SEED_RATE_BPS } from './edition.js';

export interface OrderRow {
  reference: string;
  order_token: string;
  number: number;
  plate: string;
  method: 'card' | 'bank';
  payment_state: string;
  box_state: string;
  buyer_name: string;
  buyer_email: string;
  address_street: string;
  address_postcode: string;
  address_city: string;
  gift_recipient_name: string | null;
  gift_recipient_email: string | null;
  gift_message: string | null;
  rate_bps: number;
  total_ore: number;
  gross_ore: number;
  net_ore: number;
  vat_ore: number;
  charity_ore: number;
  maker_ore: number;
  courier_ore: number;
  gateway_fee_ore: number | null;
  authorised_at: Date | null;
  paid_at: Date | null;
  certificate_state: string;
  certificate_key: string | null;
  tracking_code: string | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  gateway_payment_id: string | null;
  gateway_transfer_id: string | null;
  hold_token: string | null;
  hold_expires_at: Date | null;
  auth_expires_at: Date | null;
  transfer_deadline_at: Date | null;
  transfer_iban: string | null;
  transfer_reference: string | null;
  challenge_id: string | null;
  challenge_expires_at: Date | null;
  created_at: Date;
}

/** Box transitions in exactly one place. */
export function nextBoxState(from: string, to: string): boolean {
  const allowed: Record<string, string[]> = {
    available: ['held'],
    held: ['claimed', 'awaiting_transfer', 'available'],
    awaiting_transfer: ['claimed', 'available'],
    claimed: ['packed', 'available', 'returned'],
    packed: ['shipped', 'returned'],
    shipped: ['returned'],
    returned: ['available'],
  };
  return (allowed[from] ?? []).includes(to);
}

/** Payment-state transitions, forward by gateway sequence only. */
const paymentRank: Record<string, number> = {
  started: 0,
  challenge: 1,
  declined: 0,
  authorised: 2,
  captured: 3,
  partially_refunded: 4,
  refunded: 5,
  voided: 6,
  capture_failed: 2,
  authorisation_expired: 6,
  pending: 0,
  settled: 3,
  lapsed: 6,
};

export function isPaymentForward(from: string, to: string): boolean {
  return (paymentRank[to] ?? -1) > (paymentRank[from] ?? -1);
}

export async function getOrder(reference: string): Promise<OrderRow | null> {
  const rows = await query<OrderRow>('SELECT * FROM orders WHERE reference = $1', [reference]);
  return rows[0] ?? null;
}

/** Public state for one box: taken for everything from awaiting_transfer on. */
export function publicBoxState(boxState: string): 'available' | 'held' | 'taken' {
  if (boxState === 'available') return 'available';
  if (boxState === 'held') return 'held';
  return 'taken';
}

/** Move the box and its live order row together, in the caller's
 * transaction, so a box that returns to sale never carries a stale order. */
export async function moveBox(client: DbClient, number: number, from: string, to: string, reference?: string): Promise<void> {
  if (!nextBoxState(from, to)) {
    throw apiError(409, 'illegal_transition');
  }
  const res = await client.query('UPDATE boxes SET box_state = $1 WHERE number = $2 AND box_state = $3', [to, number, from]);
  if (res.rowCount !== 1) throw apiError(409, 'illegal_transition');
  // The order that owns this box follows the box.
  if (reference) {
    await client.query('UPDATE orders SET box_state = $1 WHERE reference = $2', [to, reference]);
  } else {
    await client.query(
      "UPDATE orders SET box_state = $1 WHERE number = $2 AND box_state IN ('held','claimed','awaiting_transfer','packed','shipped','returned')",
      [to, number],
    );
  }
}

export async function setBoxState(client: DbClient, number: number, to: string): Promise<string> {
  const res = await client.query<{ box_state: string }>(
    'UPDATE boxes SET box_state = $1 WHERE number = $2 RETURNING box_state',
    [to, number],
  );
  if (res.rowCount !== 1) throw apiError(404, 'not_found');
  return res.rows[0].box_state;
}

/** Rate in force at an instant (inclusive of the instant). */
export async function rateAtInstant(instant: Date): Promise<number> {
  const rows = await query<{ rate_bps: number }>(
    'SELECT rate_bps FROM rate_changes WHERE effective_from <= $1 ORDER BY effective_from DESC, id DESC LIMIT 1',
    [instant.toISOString()],
  );
  if (rows.length === 0) return SEED_RATE_BPS;
  return rows[0].rate_bps;
}

/** Stock counts boxes available or held. */
export async function remainingStock(): Promise<number> {
  const rows = await query<{ n: number }>("SELECT count(*)::int AS n FROM boxes WHERE box_state IN ('available','held')");
  return rows[0]?.n ?? 0;
}

export function referenceChars(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[crypto.getRandomValues(new Uint32Array(1))[0] % alphabet.length];
  }
  return out;
}

export function newReference(): string {
  return `LB-${referenceChars()}`;
}

export function newToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Insert the order; the unique partial index enforces one live claim. */
export async function insertOrder(client: DbClient, order: OrderRow): Promise<void> {
  await client.query(
    `INSERT INTO orders (reference, order_token, number, plate, method, payment_state, box_state,
      buyer_name, buyer_email, address_street, address_postcode, address_city,
      gift_recipient_name, gift_recipient_email, gift_message,
      rate_bps, total_ore, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, courier_ore,
      gateway_payment_id, kb_account_id, kb_invoice_id, kb_payment_id,
      authorised_at, auth_expires_at, hold_token, hold_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
    [
      order.reference, order.order_token, order.number, order.plate, order.method, order.payment_state, order.box_state,
      order.buyer_name, order.buyer_email, order.address_street, order.address_postcode, order.address_city,
      order.gift_recipient_name, order.gift_recipient_email, order.gift_message,
      order.rate_bps, order.total_ore, order.gross_ore, order.net_ore, order.vat_ore, order.charity_ore, order.maker_ore, order.courier_ore,
      order.gateway_payment_id ?? null, order.kb_account_id ?? null, order.kb_invoice_id ?? null, order.kb_payment_id ?? null,
      order.authorised_at?.toISOString() ?? null, order.auth_expires_at?.toISOString() ?? null,
      order.hold_token ?? null, order.hold_expires_at?.toISOString() ?? null,
    ],
  );
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === '23505';
}

export interface BoxStateRow { number: number; plate: string; box_state: string }

export async function allBoxes(): Promise<BoxStateRow[]> {
  return query<BoxStateRow>('SELECT number, plate, box_state FROM boxes ORDER BY number');
}
