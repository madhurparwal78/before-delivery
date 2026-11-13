import type { Db } from './db.js';
import type { Ctx } from './http.js';
import { sendJson } from './http.js';
import { ApiError, errors } from './errors.js';
import { copy } from './copy.js';
import { requirePlayerId, refreshCachedBalances } from './auth.js';
import { writePair } from './ledger.js';
import { loadPlayer } from './players.js';
import type { CashPack, ShopItem } from '../shared/types.js';
import type { KillBillPort } from './killbill.js';
import type { MailPort } from './mail.js';
import type { Config } from './config.js';
import { id as newId } from './util.js';

export interface ShopDeps {
  db: Db;
  config: Config;
  killbill: KillBillPort;
  mail: MailPort;
  onMeChange: (playerId: string) => void;
}

interface ItemRow {
  id: string;
  kind: 'cue' | 'cloth';
  name: string;
  currency: 'coins' | 'cash';
  price: number;
  min_level: number;
  aim: number;
  power: number;
  spin: number;
  time: number;
}

export async function getShop(deps: ShopDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const items = await deps.db.query<ItemRow & { owned: boolean; equipped: boolean }>(
    `SELECT i.*, (o.player_id IS NOT NULL) AS owned,
            ((i.id = p.equipped_cue_id AND i.kind = 'cue') OR (i.id = p.equipped_cloth_id AND i.kind = 'cloth')) AS equipped
     FROM items i
     LEFT JOIN item_owners o ON o.item_id = i.id AND o.player_id = $1
     CROSS JOIN players p WHERE p.id = $1
     ORDER BY i.currency, i.price`,
    [playerId]
  );
  const packs = await deps.db.query<{ id: string; name: string; cash: string; price_usd: string }>(
    `SELECT id, name, cash, price_usd FROM cash_packs ORDER BY cash`
  );
  const out: ShopItem[] = items.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    currency: row.currency,
    price: Number(row.price),
    minLevel: row.min_level,
    aim: row.aim,
    power: row.power,
    spin: row.spin,
    time: row.time,
    owned: row.owned,
    equipped: row.equipped,
  }));
  const packsOut: CashPack[] = packs.rows.map((row) => ({
    id: row.id,
    name: row.name,
    cash: Number(row.cash),
    priceUsd: row.price_usd,
  }));
  sendJson(ctx, 200, { items: out, packs: packsOut });
}

export async function buyItem(deps: ShopDeps, ctx: Ctx, itemId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const item = (await client.query<ItemRow>(`SELECT * FROM items WHERE id = $1`, [itemId])).rows[0];
    if (!item) throw errors.notFound();
    const owned = (await client.query(`SELECT 1 FROM item_owners WHERE player_id = $1 AND item_id = $2`, [playerId, itemId])).rowCount ?? 0;
    if (owned > 0) throw new ApiError(409, 'already_owned', 'You already own this.');
    const player = await loadPlayer(client, playerId);
    if (!player) throw errors.unauthenticated();
    if (player.level < item.min_level) {
      throw new ApiError(403, 'level_locked', copy.levelLockedItem(item.min_level));
    }
    const balance = await walletOf(client, playerId, item.currency);
    if (balance < item.price) {
      const short = item.price - balance;
      throw new ApiError(409, 'insufficient_funds', copy.shortFunds(short, item.currency === 'coins' ? 'Coins' : 'Cash'));
    }
    await writePair(client, {
      kind: item.currency === 'coins' ? 'cue_purchase' : 'item_purchase',
      refId: itemId,
      currency: item.currency,
      lines: [
        { playerId, currency: item.currency, account: 'wallet', amount: -item.price },
        { playerId: null, currency: item.currency, account: 'system', amount: item.price },
      ],
    });
    await client.query(`INSERT INTO item_owners (player_id, item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [playerId, itemId]);
  });
  await refreshCachedBalances(deps.db, playerId);
  const balances = await cachedBalances(deps.db, playerId);
  deps.onMeChange(playerId);
  sendJson(ctx, 201, balances);
}

export async function equipItem(deps: ShopDeps, ctx: Ctx, itemId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const result = await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const item = (await client.query<ItemRow>(`SELECT * FROM items WHERE id = $1`, [itemId])).rows[0];
    if (!item) throw errors.notFound();
    const owned = (await client.query(`SELECT 1 FROM item_owners WHERE player_id = $1 AND item_id = $2`, [playerId, itemId])).rowCount ?? 0;
    if (owned === 0) throw new ApiError(409, 'not_owned', 'You do not own this.');
    if (item.kind === 'cue') {
      await client.query(`UPDATE players SET equipped_cue_id = $2 WHERE id = $1`, [playerId, itemId]);
    } else {
      await client.query(`UPDATE players SET equipped_cloth_id = $2 WHERE id = $1`, [playerId, itemId]);
    }
    const player = await loadPlayer(client, playerId);
    return { equippedCueId: player?.equipped_cue_id ?? 'cue-starter', equippedClothId: player?.equipped_cloth_id ?? 'cloth-hall-blue' };
  });
  deps.onMeChange(playerId);
  sendJson(ctx, 200, result);
}

async function walletOf(client: { query: Db['query'] }, playerId: string, currency: 'coins' | 'cash'): Promise<number> {
  const res = await client.query<{ sum: string }>(
    `SELECT COALESCE(SUM(amount),0) AS sum FROM ledger_lines WHERE player_id = $1 AND currency = $2 AND account = 'wallet'`,
    [playerId, currency]
  );
  return Number(res.rows[0]?.sum ?? 0);
}

async function cachedBalances(db: Db, playerId: string): Promise<{ coins: number; cash: number }> {
  const res = await db.query<{ coins: string; cash: string }>(`SELECT coins, cash FROM players WHERE id = $1`, [playerId]);
  return { coins: Number(res.rows[0]?.coins ?? 0), cash: Number(res.rows[0]?.cash ?? 0) };
}

export async function purchasePack(deps: ShopDeps, ctx: Ctx, packId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 1 || key.length > 64) {
    throw errors.validation({ 'Idempotency-Key': 'Send an Idempotency-Key of 1 to 64 characters.' });
  }

  const existing = await deps.db.query<{ id: string; status: string; response: unknown; pack_id: string }>(
    `SELECT id, status, response, pack_id FROM purchases WHERE player_id = $1 AND idempotency_key = $2`,
    [playerId, key]
  );
  const prior = existing.rows[0];
  if (prior && prior.status === 'confirmed') {
    if (prior.pack_id !== packId) {
      throw new ApiError(409, 'idempotency_conflict', 'That key was used for a different pack.');
    }
    sendJson(ctx, 200, prior.response);
    return;
  }

  const pack = (await deps.db.query<{ id: string; name: string; cash: string; price_usd: string }>(
    `SELECT id, name, cash, price_usd FROM cash_packs WHERE id = $1`, [packId]
  )).rows[0];
  if (!pack) throw errors.notFound();

  const playerRow = (await deps.db.query<{ minor: boolean; email_verified: boolean; email: string }>(
    `SELECT minor, email_verified, email FROM players WHERE id = $1`, [playerId]
  )).rows[0];
  if (!playerRow) throw errors.unauthenticated();
  if (playerRow.minor) throw new ApiError(403, 'age_restricted', copy.under18);
  if (!playerRow.email_verified) throw new ApiError(403, 'email_unverified', copy.unverified);

  // Reserve the idempotency key so simultaneous duplicates wait and replay.
  const pending = await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const already = (await client.query(`SELECT id, status, response, pack_id FROM purchases WHERE player_id = $1 AND idempotency_key = $2 FOR UPDATE`, [playerId, key])).rows[0];
    if (already && already.status === 'confirmed') return already;
    if (already && already.status === 'pending') return already;
    if (already && already.pack_id !== packId) {
      throw new ApiError(409, 'idempotency_conflict', 'That key was used for a different pack.');
    }
    const rowId = newId('purchase');
    await client.query(
      `INSERT INTO purchases (id, player_id, pack_id, idempotency_key, status, cash, price_snapshot)
       VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
      [rowId, playerId, packId, key, Number(pack.cash), pack.price_usd]
    );
    return null;
  });
  if (pending && pending.status === 'confirmed') {
    if (pending.pack_id !== packId) throw new ApiError(409, 'idempotency_conflict', 'That key was used for a different pack.');
    const full = (await deps.db.query<{ response: unknown }>(`SELECT response FROM purchases WHERE id = $1`, [pending.id])).rows[0];
    sendJson(ctx, 200, full?.response);
    return;
  }

  const payment = await deps.killbill.purchase(playerId, playerRow.email, pack.price_usd);
  if (!payment) {
    await deps.db.query(`DELETE FROM purchases WHERE player_id = $1 AND idempotency_key = $2 AND status = 'pending'`, [playerId, key]);
    throw errors.paymentsUnavailable();
  }

  const receipt = await deps.mail.send({
    playerId,
    to: playerRow.email,
    subject: 'Your Long Rail receipt',
    body: `Thanks for buying the ${pack.name}.\n\nCash added: ${pack.cash} Cash\nPrice: $${pack.price_usd}\nPayment id: ${payment.paymentId}\n\nLong Rail Headstring`,
    kind: 'receipt',
  });

  let body: Record<string, unknown> = {};
  await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    await writePair(client, {
      kind: 'cash_purchase',
      refId: packId,
      currency: 'cash',
      lines: [
        { playerId: null, currency: 'cash', account: 'system', amount: -Number(pack.cash) },
        { playerId, currency: 'cash', account: 'wallet', amount: Number(pack.cash) },
      ],
    });
    const cash = await walletOf(client, playerId, 'cash');
    const purchaseId = (await client.query(`UPDATE purchases SET status = 'confirmed', payment_id = $2, receipt = $3 WHERE player_id = $1 AND idempotency_key = $4 RETURNING id`,
      [playerId, payment.paymentId, receipt === 'sent' ? 'sent' : 'delayed', key])).rows[0]?.id ?? '';
    body = {
      purchaseId,
      status: 'confirmed',
      cash,
      paymentId: payment.paymentId,
      receipt: receipt === 'sent' ? 'sent' : 'delayed',
    };
    await client.query(`UPDATE purchases SET response = $2::jsonb WHERE id = $1`, [purchaseId, JSON.stringify(body)]);
  });
  await refreshCachedBalances(deps.db, playerId);
  deps.onMeChange(playerId);
  sendJson(ctx, 201, body);
}
