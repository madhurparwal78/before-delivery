import type { PoolClient } from 'pg';
import { one } from '../db/pool.js';
import { fail } from '../errors.js';
import { TRADE_ACCEPT_SECONDS, type ItemKind } from '../../shared/domain.js';
import type { TradeObject, TradeSide } from '../../shared/types.js';
import { instant } from '../util.js';
import { appendEvent } from './events.js';

/** The trade state machine, in one place. */

export interface TradeRow {
  id: string;
  server_id: string;
  state: 'open' | 'completed' | 'cancelled';
  version: number;
  a_char: string;
  b_char: string;
  a_coins: number;
  b_coins: number;
  a_items: { kind: ItemKind; count: number }[];
  b_items: { kind: ItemKind; count: number }[];
  a_accepted_at: Date | null;
  b_accepted_at: Date | null;
  updated_at: Date;
}

export const loadTrade = (id: string): Promise<TradeRow | null> =>
  one<TradeRow>('SELECT * FROM trades WHERE id = $1', [id]);

export async function lockTrade(client: PoolClient, id: string): Promise<TradeRow> {
  const rows = await client.query<TradeRow>('SELECT * FROM trades WHERE id = $1 FOR UPDATE', [id]);
  const row = rows.rows[0];
  if (row === undefined) throw fail('not_found');
  return row;
}

export const sideOf = (trade: TradeRow, characterId: string): 'a' | 'b' | null =>
  trade.a_char === characterId ? 'a' : trade.b_char === characterId ? 'b' : null;

/** An accept lapses 60 seconds after it is given, on server time. */
export const acceptStillGood = (at: Date | null, now: Date = new Date()): boolean =>
  at !== null && now.getTime() - at.getTime() < TRADE_ACCEPT_SECONDS * 1000;

export async function tradeObject(
  trade: TradeRow,
  client?: PoolClient,
): Promise<TradeObject> {
  const fetch = async (id: string): Promise<string> => {
    const sql = 'SELECT name FROM characters WHERE id = $1';
    const rows =
      client === undefined
        ? await one<{ name: string }>(sql, [id])
        : (await client.query<{ name: string }>(sql, [id])).rows[0] ?? null;
    return rows?.name ?? '';
  };
  const now = new Date();
  const sides: TradeSide[] = [
    {
      character_id: trade.a_char,
      name: await fetch(trade.a_char),
      coins: trade.a_coins,
      items: trade.a_items,
      accepted: acceptStillGood(trade.a_accepted_at, now),
      accepted_at: trade.a_accepted_at === null ? null : instant(trade.a_accepted_at),
    },
    {
      character_id: trade.b_char,
      name: await fetch(trade.b_char),
      coins: trade.b_coins,
      items: trade.b_items,
      accepted: acceptStillGood(trade.b_accepted_at, now),
      accepted_at: trade.b_accepted_at === null ? null : instant(trade.b_accepted_at),
    },
  ];
  return {
    id: trade.id,
    state: trade.state,
    version: trade.version,
    sides,
    updated_at: instant(trade.updated_at),
  };
}

/** Every change is pushed to both parties and nobody else. */
export async function publishTrade(
  client: PoolClient,
  trade: TradeRow,
): Promise<void> {
  const owners = await client.query<{ user_id: string }>(
    'SELECT user_id FROM characters WHERE id = ANY($1::text[])',
    [[trade.a_char, trade.b_char]],
  );
  const object = await tradeObject(trade, client);
  await appendEvent(
    {
      serverId: trade.server_id,
      stream: 'server',
      scopeId: trade.server_id,
      kind: 'trade',
      payload: object,
      audience: owners.rows.map((row) => row.user_id),
    },
    client,
  );
}

/** Every offer change increases `version` and clears both accepts. */
export async function changeOffer(
  client: PoolClient,
  trade: TradeRow,
  side: 'a' | 'b',
  coins: number,
  items: readonly { kind: ItemKind; count: number }[],
): Promise<TradeRow> {
  const column = side === 'a' ? 'a_coins' : 'b_coins';
  const itemColumn = side === 'a' ? 'a_items' : 'b_items';
  const rows = await client.query<TradeRow>(
    `UPDATE trades
        SET ${column} = $2, ${itemColumn} = $3,
            version = version + 1,
            a_accepted_at = NULL, b_accepted_at = NULL,
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [trade.id, coins, JSON.stringify(items.filter((item) => item.count > 0))],
  );
  return rows.rows[0];
}

export async function recordAccept(
  client: PoolClient,
  trade: TradeRow,
  side: 'a' | 'b',
): Promise<TradeRow> {
  const column = side === 'a' ? 'a_accepted_at' : 'b_accepted_at';
  const rows = await client.query<TradeRow>(
    `UPDATE trades SET ${column} = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [trade.id],
  );
  return rows.rows[0];
}

export async function clearAccepts(client: PoolClient, tradeId: string): Promise<TradeRow> {
  const rows = await client.query<TradeRow>(
    `UPDATE trades SET a_accepted_at = NULL, b_accepted_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [tradeId],
  );
  return rows.rows[0];
}

/** Both sides have accepted the same version and neither accept has lapsed. */
export const bothAccepted = (trade: TradeRow): boolean =>
  acceptStillGood(trade.a_accepted_at) && acceptStillGood(trade.b_accepted_at);

export async function openTradeOf(
  characterId: string,
  client?: PoolClient,
): Promise<TradeRow | null> {
  const sql = `SELECT * FROM trades WHERE state = 'open' AND (a_char = $1 OR b_char = $1) LIMIT 1`;
  if (client === undefined) return one<TradeRow>(sql, [characterId]);
  const rows = await client.query<TradeRow>(sql, [characterId]);
  return rows.rows[0] ?? null;
}
