import type { PoolClient } from 'pg';
import { query } from '../db/pool.js';
import { newId } from '../util.js';
import type { LedgerEntryRow } from '../../shared/types.js';
import { instant } from '../util.js';

export type EntryKind = 'grant' | 'stake' | 'settlement' | 'top_up' | 'refund' | 'trade';

export interface Line {
  readonly account: string;
  readonly amount: number;
}

export interface EntryDraft {
  readonly serverId: string;
  readonly kind: EntryKind;
  readonly lines: readonly Line[];
  readonly gameId?: string | null;
  readonly tradeId?: string | null;
  readonly purchaseId?: string | null;
}

export const HOUSE = 'house';
export const escrowAccount = (gameId: string): string => `escrow:${gameId}`;

/** Every coin movement is one entry whose lines sum to zero. */
export async function writeEntry(client: PoolClient, draft: EntryDraft): Promise<string> {
  const total = draft.lines.reduce((sum, line) => sum + line.amount, 0);
  if (total !== 0) {
    throw new Error(`Ledger entry for ${draft.kind} does not balance: ${total}`);
  }
  const id = newId();
  await client.query(
    `INSERT INTO ledger_entries (id, server_id, kind, game_id, trade_id, purchase_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      draft.serverId,
      draft.kind,
      draft.gameId ?? null,
      draft.tradeId ?? null,
      draft.purchaseId ?? null,
    ],
  );
  for (const line of draft.lines) {
    if (line.amount === 0) continue;
    await client.query(
      'INSERT INTO ledger_lines (entry_id, server_id, account, amount) VALUES ($1, $2, $3, $4)',
      [id, draft.serverId, line.account, line.amount],
    );
  }
  return id;
}

/** An account's balance is the sum of its lines. */
export async function balanceOf(characterId: string, client?: PoolClient): Promise<number> {
  const sql = 'SELECT coalesce(sum(amount), 0) AS total FROM ledger_lines WHERE account = $1';
  const rows =
    client === undefined
      ? await query<{ total: string }>(sql, [characterId])
      : (await client.query<{ total: string }>(sql, [characterId])).rows;
  return Number(rows[0]?.total ?? 0);
}

/** Coins this character offers in open trades cannot be spent elsewhere. */
export async function heldCoins(characterId: string, client?: PoolClient): Promise<number> {
  const sql = `SELECT coalesce(sum(CASE WHEN a_char = $1 THEN a_coins ELSE b_coins END), 0) AS total
                 FROM trades
                WHERE state = 'open' AND (a_char = $1 OR b_char = $1)`;
  const rows =
    client === undefined
      ? await query<{ total: string }>(sql, [characterId])
      : (await client.query<{ total: string }>(sql, [characterId])).rows;
  return Number(rows[0]?.total ?? 0);
}

export interface Wallet {
  readonly balance: number;
  readonly available: number;
}

export async function walletOf(characterId: string, client?: PoolClient): Promise<Wallet> {
  const balance = await balanceOf(characterId, client);
  const held = await heldCoins(characterId, client);
  return { balance, available: balance - held };
}

export async function entriesForServer(serverId: string): Promise<LedgerEntryRow[]> {
  const entries = await query<{
    id: string;
    kind: EntryKind;
    game_id: string | null;
    trade_id: string | null;
    purchase_id: string | null;
    created_at: Date;
  }>(
    `SELECT id, kind, game_id, trade_id, purchase_id, created_at
       FROM ledger_entries WHERE server_id = $1 ORDER BY created_at, id`,
    [serverId],
  );
  const lines = await query<{ entry_id: string; account: string; amount: number }>(
    'SELECT entry_id, account, amount FROM ledger_lines WHERE server_id = $1',
    [serverId],
  );
  const byEntry = new Map<string, { account: string; amount: number }[]>();
  for (const line of lines) {
    const list = byEntry.get(line.entry_id) ?? [];
    list.push({ account: line.account, amount: line.amount });
    byEntry.set(line.entry_id, list);
  }
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    game_id: entry.game_id,
    trade_id: entry.trade_id,
    purchase_id: entry.purchase_id,
    lines: byEntry.get(entry.id) ?? [],
    created_at: instant(entry.created_at),
  }));
}

export async function walletLines(
  characterId: string,
): Promise<{ entry_id: string; kind: string; amount: number; created_at: string }[]> {
  const rows = await query<{
    entry_id: string;
    kind: string;
    amount: number;
    created_at: Date;
  }>(
    `SELECT l.entry_id, e.kind, l.amount, e.created_at
       FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
      WHERE l.account = $1 ORDER BY e.created_at, l.entry_id`,
    [characterId],
  );
  return rows.map((row) => ({
    entry_id: row.entry_id,
    kind: row.kind,
    amount: row.amount,
    created_at: instant(row.created_at),
  }));
}
