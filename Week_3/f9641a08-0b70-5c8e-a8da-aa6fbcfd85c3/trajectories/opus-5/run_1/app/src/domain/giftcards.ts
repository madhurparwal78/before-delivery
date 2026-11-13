import { randomUUID } from 'node:crypto';
import { Db } from '../db/pool';
import { normaliseCode } from './discounts';

export function giftCardLast4(code: string): string {
  return normaliseCode(code).slice(-4);
}

export async function giftCardExists(client: Db, code: string): Promise<boolean> {
  const row = await client.one<{ code: string }>('SELECT code FROM gift_cards WHERE code = $1', [
    normaliseCode(code)
  ]);
  return row !== null;
}

export async function giftCardBalance(client: Db, code: string): Promise<number> {
  const row = await client.one<{ total: string }>(
    `SELECT coalesce(sum(amount), 0)::bigint AS total FROM gift_card_entries
     WHERE code = $1 AND account = 'card'`,
    [normaliseCode(code)]
  );
  return row === null ? 0 : Number(row.total);
}

export async function lockGiftCard(client: Db, code: string): Promise<void> {
  await client.query('SELECT code FROM gift_cards WHERE code = $1 FOR UPDATE', [normaliseCode(code)]);
}

async function writeGroup(
  client: Db,
  code: string,
  cardAmount: number,
  counterAccount: string,
  reason: string,
  ref: string
): Promise<void> {
  const groupId = randomUUID();
  await client.query(
    `INSERT INTO gift_card_entries (group_id, code, account, amount, reason, ref)
     VALUES ($1, $2, $3, $4, $5, $6), ($1, $2, 'card', $7, $5, $6)`,
    [groupId, normaliseCode(code), counterAccount, -cardAmount, reason, ref, cardAmount]
  );
}

export async function spendGiftCard(client: Db, code: string, amount: number, orderNumber: string): Promise<void> {
  if (amount <= 0) return;
  await writeGroup(client, code, -amount, `order:${orderNumber}`, 'spent', orderNumber);
}

export async function refundGiftCard(client: Db, code: string, amount: number, orderNumber: string): Promise<void> {
  if (amount <= 0) return;
  await writeGroup(client, code, amount, `order:${orderNumber}`, 'refunded', orderNumber);
}

export async function giftCardEntries(
  client: Db,
  code: string
): Promise<Array<{ group_id: string; account: string; amount: number; reason: string; ref: string; at: string }>> {
  const rows = await client.query<{
    group_id: string;
    account: string;
    amount: number;
    reason: string;
    ref: string;
    at: Date;
  }>('SELECT group_id, account, amount, reason, ref, at FROM gift_card_entries WHERE code = $1 ORDER BY id ASC', [
    normaliseCode(code)
  ]);
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}
