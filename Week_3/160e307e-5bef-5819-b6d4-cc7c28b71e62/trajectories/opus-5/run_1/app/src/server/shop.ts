import { createHash } from 'node:crypto';
import { query, transaction } from './db.js';
import { conflict, forbidden, notFound, ApiError } from './errors.js';
import { addMovement, balanceOf } from './ledger.js';
import { chalkBalance, equippedFor, ownedFor } from './players.js';
import type { PlayerRow } from './players.js';
import { CATALOGUE, itemById } from '../shared/catalogue.js';

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function shopBody(player: PlayerRow): Promise<Record<string, unknown>> {
  const owned = new Set(await ownedFor(player.id));
  const equipped = await equippedFor(player.id);
  return {
    chalk: await chalkBalance(player.id),
    items: CATALOGUE.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      price: item.price,
      owned: owned.has(item.id),
      equipped: equipped[item.kind] === item.id,
    })),
  };
}

export async function purchase(
  player: PlayerRow,
  itemId: string,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const item = itemById(itemId);
  const print = fingerprint({ itemId });
  return transaction(async (client) => {
    await client.query('select id from players where id = $1 for update', [player.id]);
    const stored = await client.query<{ fingerprint: string; response: Record<string, unknown> }>(
      "select fingerprint, response from idempotency_keys where scope = 'purchase' and key = $1 and player_id = $2",
      [idempotencyKey, player.id],
    );
    const existing = stored.rows[0];
    if (existing !== undefined) {
      if (existing.fingerprint !== print) throw conflict('IDEMPOTENCY_CONFLICT');
      return existing.response;
    }
    if (item === undefined) throw notFound('ITEM_NOT_FOUND');

    const ownedRows = await client.query<{ item_id: string }>(
      'select item_id from owned_items where player_id = $1',
      [player.id],
    );
    const owned = ownedRows.rows.map((row) => row.item_id);
    if (owned.includes(itemId)) throw conflict('ALREADY_OWNED');

    const balance = await balanceOf(client, player.id);
    if (balance < item.price) {
      throw new ApiError(402, 'INSUFFICIENT_CHALK', { needed: item.price - balance });
    }
    await addMovement(client, player.id, -item.price, 'purchase', item.id);
    await client.query('insert into owned_items (player_id, item_id) values ($1, $2)', [player.id, item.id]);

    const response = { chalk: balance - item.price, owned: [...owned, item.id] };
    await client.query(
      `insert into idempotency_keys (scope, key, player_id, fingerprint, response)
       values ('purchase', $1, $2, $3, $4)`,
      [idempotencyKey, player.id, print, JSON.stringify(response)],
    );
    return response;
  });
}

export async function equip(player: PlayerRow, itemId: string): Promise<Record<string, unknown>> {
  const item = itemById(itemId);
  if (item === undefined) throw notFound('ITEM_NOT_FOUND');
  const owned = await ownedFor(player.id);
  if (!owned.includes(itemId)) throw forbidden('NOT_OWNED');
  await query(`update equipped_items set ${item.kind} = $2 where player_id = $1`, [player.id, itemId]);
  return { equipped: await equippedFor(player.id) };
}
