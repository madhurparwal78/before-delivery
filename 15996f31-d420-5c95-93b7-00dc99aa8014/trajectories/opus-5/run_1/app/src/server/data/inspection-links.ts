import { createHash } from 'node:crypto';
import type { InspectionLinkStatus } from '../../shared/labels';
import { instant, one, text, type Queryable } from '../db';
import { apiError } from '../http/errors';
import { inspectionLinkState, type InspectionLinkState } from '../domain/transitions';
import { loadOrderAggregate, type OrderAggregate } from './orders';

export interface LinkHandle {
  id: string;
  orderId: string;
  orchardName: string;
  status: InspectionLinkStatus;
  expiresAt: Date;
  state: InspectionLinkState;
}

function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The link behind a token, whatever its state; an unknown token is a 404. */
export async function findLink(client: Queryable, token: string): Promise<LinkHandle> {
  const row = await one(
    client,
    `select l.id, l.order_id, l.status, l.expires_at, orc.name as orchard_name
       from inspection_links l
       join orders o on o.id = l.order_id
       join orchards orc on orc.id = o.orchard_id
      where l.token_hash = $1`,
    [hashLinkToken(token)],
  );
  if (row === null) throw apiError.notFound();
  const status = text(row.status) as InspectionLinkStatus;
  const expiresAt = instant(row.expires_at);
  return {
    id: text(row.id),
    orderId: text(row.order_id),
    orchardName: text(row.orchard_name),
    status,
    expiresAt,
    state: inspectionLinkState({ status, expiresAt }, new Date()),
  };
}

export function requireLiveLink(link: LinkHandle): void {
  if (link.state === 'signed') throw apiError.linkSigned(link.orchardName);
  if (link.state === 'expired') throw apiError.linkExpired();
}

export async function liveLinkOrder(
  client: Queryable,
  token: string,
): Promise<{ link: LinkHandle; order: OrderAggregate }> {
  const link = await findLink(client, token);
  requireLiveLink(link);
  const order = await loadOrderAggregate(client, link.orderId);
  if (order === null) throw apiError.notFound();
  return { link, order };
}

export async function markLinkUsed(client: Queryable, link: LinkHandle): Promise<void> {
  if (link.status !== 'issued') return;
  await client.query(`update inspection_links set status = 'used' where id = $1`, [link.id]);
}
