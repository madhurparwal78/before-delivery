import { randomUUID } from 'node:crypto';
import { formatNumber, type Currency } from '../shared/domain';
import { playerById, isMinor, type PlayerRow } from './auth';
import { query, transaction, type Db } from './db';
import { ApiError, notFound, validationFailed } from './errors';
import { route, type Reply } from './http';
import { purchase, PaymentsDown } from './killbill';
import { balance, lockPlayer, SYSTEM, wallet, writePair } from './ledger';
import { sendOrQueue } from './mail';
import { notifyPlayer } from './realtime';

interface ItemRow {
  id: string;
  kind: 'cue' | 'cloth';
  name: string;
  currency: Currency;
  price: string;
  min_level: number;
  aim: number;
  power: number;
  spin: number;
  time: number;
}

interface PackRow {
  id: string;
  name: string;
  cash: string;
  price_cents: number;
}

export interface CueStats {
  aim: number;
  power: number;
  spin: number;
  time: number;
}

const PAYMENTS_DOWN = 'Payments are down. You have not been charged.';
const MAX_KEY_LENGTH = 64;
const CURRENCY_WORD: Record<Currency, string> = { coins: 'Coins', cash: 'Cash' };

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function equippedCueStats(client: Db, playerId: string): Promise<CueStats> {
  const { rows } = await client.query<CueStats>(
    `SELECT i.aim, i.power, i.spin, i.time FROM items i JOIN players p ON p.equipped_cue_id = i.id WHERE p.id = $1`,
    [playerId],
  );
  return rows[0];
}

async function itemById(client: Db, id: string): Promise<ItemRow> {
  const { rows } = await client.query<ItemRow>('SELECT * FROM items WHERE id = $1', [id]);
  if (rows.length === 0) throw notFound();
  return rows[0];
}

async function owns(client: Db, playerId: string, itemId: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM owned_items WHERE player_id = $1 AND item_id = $2', [playerId, itemId]);
  return rows.length > 0;
}

function purchaseReply(reply: unknown, status: number): Reply {
  return { status, body: reply };
}

async function storedPurchase(playerId: string, key: string, packId: string): Promise<Reply | null> {
  const rows = await query<{ pack_id: string; response: unknown }>(
    'SELECT pack_id, response FROM cash_purchases WHERE player_id = $1 AND idempotency_key = $2',
    [playerId, key],
  );
  if (rows.length === 0) return null;
  if (rows[0].pack_id !== packId) throw new ApiError(409, 'idempotency_conflict', 'That key was used for a different pack.');
  return purchaseReply(rows[0].response, 200);
}

function assertEligible(player: PlayerRow): void {
  if (isMinor(player.birth_year)) throw new ApiError(403, 'age_restricted', 'Players under 18 cannot buy Cash.');
  if (!player.email_verified) throw new ApiError(403, 'email_unverified', 'Verify your email to buy Cash.');
}

export function registerShopRoutes(): void {
  route('GET', '/api/shop', async ({ session }) => {
    const items = await query<ItemRow & { owned: boolean; equipped: boolean }>(
      `SELECT i.*, o.item_id IS NOT NULL AS owned, i.id IN (p.equipped_cue_id, p.equipped_cloth_id) AS equipped
       FROM items i JOIN players p ON p.id = $1
       LEFT JOIN owned_items o ON o.item_id = i.id AND o.player_id = p.id ORDER BY i.sort`,
      [session.playerId],
    );
    const packs = await query<PackRow>('SELECT * FROM cash_packs ORDER BY price_cents');
    return {
      status: 200,
      body: {
        items: items.map((item) => ({
          id: item.id, kind: item.kind, name: item.name, currency: item.currency, price: Number(item.price), minLevel: item.min_level,
          aim: item.aim, power: item.power, spin: item.spin, time: item.time, owned: item.owned, equipped: item.equipped,
        })),
        packs: packs.map((pack) => ({ id: pack.id, name: pack.name, cash: Number(pack.cash), priceUsd: dollars(pack.price_cents) })),
      },
    };
  });

  route('POST', '/api/shop/items/{id}/buy', async ({ session, params }) => {
    const balances = await transaction(async (client) => {
      const item = await itemById(client, params.id);
      await lockPlayer(client, session.playerId);
      const player = await playerById(client, session.playerId);
      if (player.level < item.min_level) throw new ApiError(403, 'level_locked', `Reach level ${item.min_level} to buy this.`);
      if (await owns(client, player.id, item.id)) throw new ApiError(409, 'already_owned', `You already own ${item.name}.`);
      const price = Number(item.price);
      const held = await balance(client, player.id, item.currency);
      if (held < price) {
        throw new ApiError(409, 'insufficient_funds', `You need ${formatNumber(price - held)} more ${CURRENCY_WORD[item.currency]}.`);
      }
      await client.query('INSERT INTO owned_items (player_id, item_id) VALUES ($1,$2)', [player.id, item.id]);
      await writePair(client, {
        from: wallet(player.id), to: SYSTEM, amount: price, currency: item.currency,
        kind: item.currency === 'coins' ? 'cue_purchase' : 'item_purchase', refId: item.id,
      });
      return { coins: await balance(client, player.id, 'coins'), cash: await balance(client, player.id, 'cash') };
    });
    notifyPlayer(session.playerId);
    return { status: 201, body: balances };
  });

  route('POST', '/api/shop/items/{id}/equip', async ({ session, params }) => {
    const equipped = await transaction(async (client) => {
      const item = await itemById(client, params.id);
      if (!(await owns(client, session.playerId, item.id))) throw new ApiError(409, 'not_owned', `You do not own ${item.name}.`);
      const column = item.kind === 'cue' ? 'equipped_cue_id' : 'equipped_cloth_id';
      const { rows } = await client.query<{ equipped_cue_id: string; equipped_cloth_id: string }>(
        `UPDATE players SET ${column} = $1 WHERE id = $2 RETURNING equipped_cue_id, equipped_cloth_id`,
        [item.id, session.playerId],
      );
      return { equippedCueId: rows[0].equipped_cue_id, equippedClothId: rows[0].equipped_cloth_id };
    });
    notifyPlayer(session.playerId);
    return { status: 200, body: equipped };
  });

  route('POST', '/api/shop/cash-packs/{id}/purchase', async ({ session, params, idempotencyKey }) => {
    const packs = await query<PackRow>('SELECT * FROM cash_packs WHERE id = $1', [params.id]);
    if (packs.length === 0) throw notFound();
    const pack = packs[0];
    const key = idempotencyKey;
    if (key !== undefined && key.length >= 1 && key.length <= MAX_KEY_LENGTH) {
      const stored = await storedPurchase(session.playerId, key, pack.id);
      if (stored !== null) return stored;
    }
    const player = await transaction((client) => playerById(client, session.playerId));
    assertEligible(player);
    if (key === undefined || key.length < 1 || key.length > MAX_KEY_LENGTH) {
      throw validationFailed({ 'Idempotency-Key': 'Send a key of 1 to 64 characters.' });
    }
    return buyPack(player, pack, key);
  });
}

/** The advisory lock makes a simultaneous duplicate wait for the first request and then replay its stored answer. */
async function buyPack(player: PlayerRow, pack: PackRow, key: string): Promise<Reply> {
  const purchaseId = randomUUID();
  const settled = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${player.id}:${key}`]);
    const stored = await client.query<{ pack_id: string; response: unknown }>(
      'SELECT pack_id, response FROM cash_purchases WHERE player_id = $1 AND idempotency_key = $2',
      [player.id, key],
    );
    if (stored.rows.length > 0) return { replay: stored.rows[0].response };

    let paymentId: string;
    try {
      paymentId = await purchase({ playerId: player.id, email: player.email, name: player.display_name, amountUsd: dollars(pack.price_cents), paymentKey: purchaseId });
    } catch (error) {
      if (error instanceof PaymentsDown) throw new ApiError(503, 'payments_unavailable', PAYMENTS_DOWN);
      throw error;
    }
    const cash = Number(pack.cash);
    await lockPlayer(client, player.id);
    await writePair(client, { from: SYSTEM, to: wallet(player.id), amount: cash, currency: 'cash', kind: 'cash_purchase', refId: purchaseId });
    const body = [
      `Thanks for your purchase.`,
      '',
      `Pack: ${pack.name}`,
      `Cash: ${formatNumber(cash)}`,
      `Price: $${dollars(pack.price_cents)}`,
      `Payment id: ${paymentId}`,
      '',
    ].join('\n');
    const receipt = (await sendOrQueue(client, player.id, 'receipt', player.email, 'Your Long Rail receipt', body)) ? 'sent' : 'delayed';
    const response = { purchaseId, status: 'confirmed', cash: await balance(client, player.id, 'cash'), paymentId, receipt };
    await client.query(
      'INSERT INTO cash_purchases (id, player_id, idempotency_key, pack_id, response) VALUES ($1,$2,$3,$4,$5)',
      [purchaseId, player.id, key, pack.id, response],
    );
    return { response };
  });
  if ('replay' in settled) return purchaseReply(settled.replay, 200);
  notifyPlayer(player.id);
  return purchaseReply(settled.response, 201);
}
