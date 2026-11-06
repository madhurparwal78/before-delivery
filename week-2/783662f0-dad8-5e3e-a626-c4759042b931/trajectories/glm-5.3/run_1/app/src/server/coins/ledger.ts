/** The coin ledger: every coin movement is one entry whose lines sum to zero. */

import type { Client, Pool } from "../db/pool.js";
import { newId } from "../db/seed.js";

export type LedgerKind = "grant" | "stake" | "settlement" | "top_up" | "refund" | "trade";

export interface LedgerLine {
  account: string;
  amount: number;
}

/** Writes one ledger entry. The lines must sum to zero; that is checked by the callers' tests. */
export async function writeLedgerEntry(
  client: Client | Pool,
  input: { serverId: string; kind: LedgerKind; lines: LedgerLine[]; gameId?: string; tradeId?: string; purchaseId?: string }
): Promise<void> {
  await client.query(
    `INSERT INTO ledger_entries (id, server_id, kind, game_id, trade_id, purchase_id, lines)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId(), input.serverId, input.kind, input.gameId ?? null, input.tradeId ?? null, input.purchaseId ?? null, JSON.stringify(input.lines)]
  );
}

export async function balanceOf(client: Client | Pool, characterId: string): Promise<number> {
  const res = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM((line->>'amount')::numeric), 0)::text AS total
     FROM ledger_entries, jsonb_array_elements(lines) AS line
     WHERE line->>'account' = $1`,
    [characterId]
  );
  return Number(res.rows[0]?.total ?? 0);
}

/** Held coins: staked in games in play, or offered in open trades. */
export async function heldCoins(client: Client | Pool, characterId: string): Promise<{ games: number; trades: number }> {
  const games = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(stake),0)::text AS total FROM seats s JOIN tables_ t ON t.id = s.table_id
     WHERE s.character_id = $1 AND t.state IN ('seated','in_play','finished')`,
    [characterId]
  );
  const trades = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(coins),0)::text AS total FROM trade_sides ts JOIN trades tr ON tr.id = ts.trade_id
     WHERE ts.character_id = $1 AND tr.state = 'open'`,
    [characterId]
  );
  return { games: Number(games.rows[0]?.total ?? 0), trades: Number(trades.rows[0]?.total ?? 0) };
}

/** The character's balance minus the coins held in open trades. */
export async function availableCoins(client: Client | Pool, characterId: string): Promise<number> {
  const balance = await balanceOf(client, characterId);
  const held = await heldCoins(client, characterId);
  return balance - held.trades;
}

export interface WalletLine {
  kind: LedgerKind;
  game_id: string | null;
  trade_id: string | null;
  purchase_id: string | null;
  amount: number;
  created_at: Date;
}

/** The wallet's ledger lines for this character, oldest first. */
export async function walletLines(client: Client | Pool, characterId: string): Promise<WalletLine[]> {
  const res = await client.query<WalletLine>(
    `SELECT e.kind, e.game_id, e.trade_id, e.purchase_id, (line->>'amount')::numeric::int AS amount, e.created_at
     FROM ledger_entries e, jsonb_array_elements(e.lines) AS line
     WHERE line->>'account' = $1
     ORDER BY e.created_at, e.id`,
    [characterId]
  );
  return res.rows;
}
