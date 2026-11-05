import type { Queryable } from '../db/pool.js';
import {
  loadReservationsForGroup,
  serializeReservation,
  type ReservationJson,
} from '../db/reservations.js';

export interface GroupJson {
  id: string;
  state: string;
  reservations: ReservationJson[];
  invoice: {
    kb_invoice_id: string;
    items: { bench: string; amount_cents: number }[];
    total_cents: number;
  } | null;
}

interface GroupRow {
  id: string;
  state: string;
}

interface GroupItemRow {
  bench: string;
  amount_cents: number;
  refunded_cents: number;
  kb_invoice_id: string;
}

export async function loadGroupRow(client: Queryable, groupId: string): Promise<GroupRow | null> {
  const result = await client.query<GroupRow>('select id, state from groups where id = $1', [
    groupId,
  ]);
  return result.rows[0] ?? null;
}

export async function serializeGroup(
  client: Queryable,
  group: GroupRow,
  at: Date,
): Promise<GroupJson> {
  const reservations = await loadReservationsForGroup(client, group.id);
  const items = await client.query<GroupItemRow>(
    `select r.bench, item.amount_cents, p.kb_invoice_id,
       coalesce((select sum(rf.amount_cents) from refunds rf
                 where rf.reservation_id = item.reservation_id and rf.payment_id = item.payment_id), 0)::int
         as refunded_cents
     from payments p
     join payment_items item on item.payment_id = p.id
     join reservations r on r.id = item.reservation_id
     where p.group_id = $1 and p.kind = 'group'
     order by r.bench`,
    [group.id],
  );

  const invoiceId = items.rows[0]?.kb_invoice_id ?? null;
  const invoice =
    invoiceId === null
      ? null
      : {
          kb_invoice_id: invoiceId,
          items: items.rows.map((row) => ({
            bench: row.bench,
            amount_cents: row.amount_cents - row.refunded_cents,
          })),
          total_cents: items.rows.reduce(
            (sum, row) => sum + row.amount_cents - row.refunded_cents,
            0,
          ),
        };

  return {
    id: group.id,
    state: group.state,
    reservations: reservations.map((row) => serializeReservation(row, at)),
    invoice,
  };
}

export async function groupIdsForBuyer(client: Queryable, buyerId: string): Promise<GroupRow[]> {
  const result = await client.query<GroupRow>(
    `select id, state from groups where buyer_id = $1 and state <> 'released' order by created_at`,
    [buyerId],
  );
  return result.rows;
}
