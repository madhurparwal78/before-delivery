import { formatMl, type Ml } from '../domain/decimal.ts';
import { truncateToSecond } from '../domain/time.ts';
import { pool, type Queryable } from './db.ts';
import { type CardRow, CARD_SELECT, type OrderRow, type WindowRow, WINDOW_COLUMNS, WINDOW_FROM } from './records.ts';

/** The server's own clock, truncated to the whole second the API publishes. */
export function serverNow(): Date {
  return truncateToSecond(new Date());
}

export function db(client?: Queryable): Queryable {
  return client ?? pool;
}

/** Each channel's flow: the rates of orders started but not finished. */
export async function channelFlows(client?: Queryable): Promise<ReadonlyMap<string, Ml>> {
  const found = await db(client).query<{ channel_id: string; flow: string }>(
    `select w.channel_id, coalesce(sum(o.rate_ml_day),0)::text as flow
       from orders o join windows w on w.id = o.window_id
      where exists (select 1 from gate_cards gc
                     where gc.order_number = o.number and gc.kind = 'start' and gc.state = 'spent')
        and not exists (select 1 from gate_cards gc
                     where gc.order_number = o.number and gc.kind = 'finish' and gc.state = 'spent')
      group by w.channel_id`,
  );
  return new Map(found.rows.map((row) => [row.channel_id, BigInt(row.flow)]));
}

export async function windowRows(filter: { channelId?: string }, client?: Queryable): Promise<WindowRow[]> {
  const conditions = filter.channelId === undefined ? '' : 'where w.channel_id = $1';
  const values = filter.channelId === undefined ? [] : [filter.channelId];
  const found = await db(client).query<WindowRow>(
    `select ${WINDOW_COLUMNS} ${WINDOW_FROM} ${conditions} order by c.rail_order, w.opens_at, w.id`,
    values,
  );
  return found.rows;
}

export async function windowRow(windowId: string, client?: Queryable): Promise<WindowRow | null> {
  const found = await db(client).query<WindowRow>(
    `select ${WINDOW_COLUMNS} ${WINDOW_FROM} where w.id = $1`,
    [windowId],
  );
  return found.rows[0] ?? null;
}

/** Takes the window row first, the lock order every guarded step uses. */
export async function lockWindowRow(windowId: string, client: Queryable): Promise<WindowRow | null> {
  const locked = await client.query<{ id: string }>('select id from windows where id = $1 for update', [windowId]);
  if (locked.rows[0] === undefined) return null;
  return windowRow(windowId, client);
}

export async function orderRows(
  filter: { windowId?: string; growerId?: number; number?: string },
  client?: Queryable,
): Promise<OrderRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filter.windowId !== undefined) {
    values.push(filter.windowId);
    conditions.push(`o.window_id = $${values.length}`);
  }
  if (filter.growerId !== undefined) {
    values.push(filter.growerId);
    conditions.push(`o.grower_id = $${values.length}`);
  }
  if (filter.number !== undefined) {
    values.push(filter.number);
    conditions.push(`o.number = $${values.length}`);
  }
  const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
  const found = await db(client).query<OrderRow>(`${ORDER_SELECT} ${where} order by o.number`, values);
  return found.rows;
}

const ORDER_SELECT = `select o.*, g.name as grower_name from orders o join users g on g.id = o.grower_id`;

export async function orderRow(number: string, client?: Queryable): Promise<OrderRow | null> {
  const found = await db(client).query<OrderRow>(`${ORDER_SELECT} where o.number = $1`, [number]);
  return found.rows[0] ?? null;
}

export async function cardRows(
  filter: { windowId?: string; holderCode?: string; id?: string },
  client?: Queryable,
): Promise<CardRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filter.windowId !== undefined) {
    values.push(filter.windowId);
    conditions.push(`w.id = $${values.length}`);
  }
  if (filter.holderCode !== undefined) {
    values.push(filter.holderCode);
    conditions.push(`gc.holder_code = $${values.length}`);
  }
  if (filter.id !== undefined) {
    values.push(filter.id);
    conditions.push(`gc.id = $${values.length}`);
  }
  const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
  const found = await db(client).query<CardRow>(`${CARD_SELECT} ${where} order by gc.created_at desc, gc.id desc`, values);
  return found.rows;
}

export interface AllocationFigures {
  allocationMl: Ml;
  debitedMl: Ml;
  remainingMl: Ml;
}

export async function allocationOf(growerId: number, client?: Queryable): Promise<AllocationFigures> {
  const found = await db(client).query<{ allocation_ml: string; debited_ml: string }>(
    'select allocation_ml, debited_ml from users where id = $1',
    [growerId],
  );
  const row = found.rows[0] as { allocation_ml: string; debited_ml: string };
  const allocationMl = BigInt(row.allocation_ml);
  const debitedMl = BigInt(row.debited_ml);
  return { allocationMl, debitedMl, remainingMl: allocationMl - debitedMl };
}

export function allocationBody(figures: AllocationFigures): Record<string, string> {
  return {
    allocation_ml: formatMl(figures.allocationMl),
    debited_ml: formatMl(figures.debitedMl),
    remaining_ml: formatMl(figures.remainingMl),
  };
}
