import { createHash } from 'node:crypto';
import type { OrderStatus, ReturnStatus } from './transitions.js';

export const GENESIS_DIGEST = '0'.repeat(64);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type HistoryEntry = {
  seq: number;
  type: string;
  at: Date;
  data: { [key: string]: JsonValue };
  digest: string;
};

/** JSON with keys sorted by code point at every depth and no whitespace. */
function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(',')}}`;
}

function canonicalBody(
  orderId: string,
  seq: number,
  type: string,
  at: Date,
  data: { [key: string]: JsonValue },
): string {
  return canonicalJson({ at: at.toISOString(), data, order_id: orderId, seq, type });
}

function digestOf(previousDigest: string, body: string): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(previousDigest, 'utf8'), Buffer.from(body, 'utf8')]))
    .digest('hex');
}

export function nextDigest(
  previousDigest: string,
  orderId: string,
  seq: number,
  type: string,
  at: Date,
  data: { [key: string]: JsonValue },
): string {
  return digestOf(previousDigest, canonicalBody(orderId, seq, type, at, data));
}

/** The `seq` of the first entry that breaks the chain, or null when the chain holds. */
export function firstBrokenSeq(orderId: string, entries: HistoryEntry[]): number | null {
  let previous = GENESIS_DIGEST;
  let expectedSeq = 1;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) return entry.seq;
    const expected = nextDigest(previous, orderId, entry.seq, entry.type, entry.at, entry.data);
    if (expected !== entry.digest) return entry.seq;
    previous = entry.digest;
    expectedSeq += 1;
  }
  return null;
}

export type ReplayResult = {
  status: OrderStatus;
  lastSeq: number;
  totalCents: number;
  refundedCents: number;
  returns: { id: string; status: ReturnStatus; refund_cents: number }[];
};

/** Rebuilds the order's stored state from the history entries alone. */
export function replay(entries: HistoryEntry[]): ReplayResult {
  let status: OrderStatus = 'placed';
  let lastSeq = 0;
  let totalCents = 0;
  const returns = new Map<string, { id: string; status: ReturnStatus; refund_cents: number }>();

  for (const entry of entries) {
    lastSeq = entry.seq;
    switch (entry.type) {
      case 'order.placed':
        totalCents = entry.data['total_cents'] as number;
        status = 'placed';
        break;
      case 'order.picking':
      case 'order.ready':
      case 'order.collected':
      case 'order.cancelled':
        status = entry.data['to'] as OrderStatus;
        break;
      case 'return.requested':
        returns.set(entry.data['return_id'] as string, {
          id: entry.data['return_id'] as string,
          status: 'requested',
          refund_cents: entry.data['refund_cents'] as number,
        });
        break;
      case 'return.received':
      case 'return.settled':
      case 'return.declined': {
        const id = entry.data['return_id'] as string;
        const existing = returns.get(id);
        if (existing) existing.status = entry.data['to'] as ReturnStatus;
        break;
      }
    }
  }

  let refundedCents = 0;
  for (const item of returns.values()) {
    if (item.status === 'settled') refundedCents += item.refund_cents;
  }

  return { status, lastSeq, totalCents, refundedCents, returns: [...returns.values()] };
}
