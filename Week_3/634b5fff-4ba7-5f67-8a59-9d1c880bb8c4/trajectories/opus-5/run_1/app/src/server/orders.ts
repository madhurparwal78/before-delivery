import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CertificateState, PaymentMethod, PaymentState } from '../shared/types.js';
import { one, query } from './db.js';

export interface OrderRow {
  reference: string;
  box_number: number;
  plate: string;
  method: PaymentMethod;
  payment_state: PaymentState;
  order_token: string;
  hold_token: string;
  buyer_name: string;
  buyer_email: string;
  street: string;
  postcode: string;
  city: string;
  is_gift: boolean;
  recipient_name: string | null;
  recipient_email: string | null;
  gift_message: string | null;
  rate_basis_points: number;
  gross_ore: number;
  courier_ore: number;
  total_ore: number;
  net_ore: number;
  vat_ore: number;
  charity_ore: number;
  maker_ore: number;
  payment_id: string | null;
  transfer_id: string | null;
  challenge_id: string | null;
  challenge_expires_at: Date | null;
  authorised_at: Date | null;
  auth_expires_at: Date | null;
  transfer_deadline_at: Date | null;
  capture_requested: boolean;
  gateway_captured: boolean;
  ledger_captured: boolean;
  paid_at: Date | null;
  killbill_account_id: string | null;
  killbill_invoice_id: string | null;
  ledger_authorised: boolean;
  certificate_state: CertificateState;
  certificate_key: string | null;
  tracking_code: string | null;
  live_claim: boolean;
  last_sequence: number;
  authorised_too_late: boolean;
}

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newReference(): string {
  const bytes = randomBytes(6);
  let tail = '';
  for (const byte of bytes) {
    tail += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return `LB-${tail}`;
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

export function newEventId(): string {
  return `evt_${randomUUID()}`;
}

export async function loadOrder(reference: string): Promise<OrderRow | null> {
  return one<OrderRow>('SELECT * FROM orders WHERE reference = $1', [reference]);
}

export async function loadOrderByHold(holdToken: string, boxNumber: number): Promise<OrderRow | null> {
  return one<OrderRow>(
    `SELECT * FROM orders WHERE hold_token = $1 AND box_number = $2 ORDER BY created_at DESC LIMIT 1`,
    [holdToken, boxNumber],
  );
}

export async function liveOrderForBox(boxNumber: number): Promise<OrderRow | null> {
  return one<OrderRow>('SELECT * FROM orders WHERE box_number = $1 AND live_claim', [boxNumber]);
}

type Executor = Pick<PoolClient, 'query'>;

export async function updateOrder(
  executor: Executor,
  reference: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(patch);
  if (columns.length === 0) return;
  const assignments = columns.map((column, index) => `${column} = $${index + 2}`).join(', ');
  await executor.query(
    `UPDATE orders SET ${assignments}, updated_at = now() WHERE reference = $1`,
    [reference, ...columns.map((column) => patch[column])],
  );
}

export async function refundedSoFar(reference: string): Promise<{
  grossOre: number;
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
}> {
  const rows = await query<{
    gross: string | null;
    net: string | null;
    vat: string | null;
    charity: string | null;
    maker: string | null;
  }>(
    `SELECT coalesce(sum(amount_ore),0)::text AS gross,
            coalesce(sum(net_ore),0)::text AS net,
            coalesce(sum(vat_ore),0)::text AS vat,
            coalesce(sum(charity_ore),0)::text AS charity,
            coalesce(sum(maker_ore),0)::text AS maker
       FROM refunds WHERE reference = $1 AND state IN ('pending','settled')`,
    [reference],
  );
  const row = rows[0];
  return {
    grossOre: Number(row?.gross ?? '0'),
    netOre: Number(row?.net ?? '0'),
    vatOre: Number(row?.vat ?? '0'),
    charityOre: Number(row?.charity ?? '0'),
    makerOre: Number(row?.maker ?? '0'),
  };
}
