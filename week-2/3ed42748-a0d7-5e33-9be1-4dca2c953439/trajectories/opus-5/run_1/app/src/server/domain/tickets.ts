import type { IncomingMessage } from 'node:http';
import type { Transaction } from '../db/pool.js';
import { fail, validation } from '../http/errors.js';
import { TOKEN_SHAPE } from './requestFields.js';

export type TicketNamespace = 'handover' | 'purchase' | 'mail';

const HEADERS: Record<TicketNamespace, string> = {
  handover: 'Handover-Ticket',
  purchase: 'Purchase-Ticket',
  mail: 'Mail-Ticket',
};

/** Reads a ticket header, refusing a missing or malformed one by the header's own name. */
export function readTicket(request: IncomingMessage, namespace: TicketNamespace): string {
  const header = HEADERS[namespace];
  const raw = request.headers[header.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) throw validation({ [header]: 'required' });
  if (!TOKEN_SHAPE.test(value)) throw validation({ [header]: 'invalid' });
  return value;
}

export interface StoredTicket<T> {
  status: number;
  body: T;
}

/**
 * Serialises work sharing a ticket, replays a stored success byte for byte, refuses a ticket
 * reused for something else, and stores only a success.
 */
export async function withTicket<T>(
  tx: Transaction,
  courierId: string,
  namespace: TicketNamespace,
  ticket: string,
  fingerprint: string,
  run: () => Promise<StoredTicket<T>>,
): Promise<StoredTicket<T>> {
  await tx.lock(`ticket:${namespace}:${courierId}:${ticket}`);
  const stored = await tx.one<{ fingerprint: string; response: { status: number; body: T } }>(
    'select fingerprint, response from tickets where courier_id = $1 and namespace = $2 and ticket = $3',
    [courierId, namespace, ticket],
  );
  if (stored) {
    if (stored.fingerprint !== fingerprint) throw fail('ticket_conflict');
    return stored.response;
  }
  const reply = await run();
  await tx.query(
    `insert into tickets (courier_id, namespace, ticket, fingerprint, response, created_at)
     values ($1, $2, $3, $4, $5, now())`,
    [courierId, namespace, ticket, fingerprint, JSON.stringify(reply)],
  );
  return reply;
}
