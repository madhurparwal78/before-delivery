import { randomUUID } from 'node:crypto';
import { CASH_PACKS, SHOP_ITEMS, itemOf } from '../../shared/catalog.js';
import { SHOP_COPY } from '../../shared/copy.js';
import { query, queryOne, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import type { Ctx, Reply, Router } from '../http.js';
import { credit, spend } from '../ledger.js';
import { loadPlayer } from '../players.js';
import { requireSession } from '../session.js';
import { chargePack } from '../services/killbill.js';
import { sendReceipt } from '../services/mail.js';
import { publishPlayer } from '../tables.js';

const inFlight = new Map<string, Promise<Reply>>();

export function registerShopRoutes(router: Router): void {
  router.get('/api/shop', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const owned = await query<{ item_id: string }>(`SELECT item_id FROM player_items WHERE player_id = $1`, [player.id]);
    const ownedIds = new Set(owned.map((row) => row.item_id));
    return {
      status: 200,
      body: {
        items: SHOP_ITEMS.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          currency: item.currency,
          price: item.price,
          minLevel: item.minLevel,
          aim: item.aim,
          power: item.power,
          spin: item.spin,
          time: item.time,
          owned: ownedIds.has(item.id),
          equipped: player.equipped_cue_id === item.id || player.equipped_cloth_id === item.id,
        })),
        packs: CASH_PACKS.map((pack) => ({ id: pack.id, name: pack.name, cash: pack.cash, priceUsd: pack.priceUsd })),
      },
    };
  });

  router.post('/api/shop/items/:id/buy', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const item = itemOf(ctx.params.id as string);
    if (!item) throw ApiError.notFound('No such item.');
    if (player.level < item.minLevel) throw new ApiError(403, 'level_locked', SHOP_COPY.levelLocked(item.minLevel));
    const balances = await transaction(async (client) => {
      const owned = await client.query(`SELECT 1 FROM player_items WHERE player_id = $1 AND item_id = $2 FOR UPDATE`, [player.id, item.id]);
      if (owned.rows.length > 0) return 'already_owned' as const;
      const wallet = await client.query<{ coins: string; cash: string }>(`SELECT coins, cash FROM players WHERE id = $1 FOR UPDATE`, [player.id]);
      const row = wallet.rows[0];
      if (!row) return 'already_owned' as const;
      const held = item.currency === 'coins' ? Number(row.coins) : Number(row.cash);
      if (held < item.price) return 'insufficient_funds' as const;
      await client.query(`INSERT INTO player_items (player_id, item_id) VALUES ($1,$2)`, [player.id, item.id]);
      if (item.price > 0) {
        await spend(client, player.id, item.currency, item.price, item.currency === 'coins' ? 'cue_purchase' : 'item_purchase', item.id);
      }
      const after = await client.query<{ coins: string; cash: string }>(`SELECT coins, cash FROM players WHERE id = $1`, [player.id]);
      return { coins: Number(after.rows[0]?.coins ?? 0), cash: Number(after.rows[0]?.cash ?? 0) };
    });
    if (balances === 'already_owned') throw new ApiError(409, 'already_owned', 'You already own this.');
    if (balances === 'insufficient_funds') {
      const held = item.currency === 'coins' ? Number(player.coins) : Number(player.cash);
      throw new ApiError(409, 'insufficient_funds', SHOP_COPY.shortFunds(item.price - held, item.currency === 'coins' ? 'Coins' : 'Cash'));
    }
    publishPlayer(player.id);
    return { status: 201, body: balances };
  });

  router.post('/api/shop/items/:id/equip', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const item = itemOf(ctx.params.id as string);
    if (!item) throw ApiError.notFound('No such item.');
    const owned = await queryOne(`SELECT 1 FROM player_items WHERE player_id = $1 AND item_id = $2`, [player.id, item.id]);
    if (!owned) throw new ApiError(409, 'not_owned', 'Buy this first.');
    const column = item.kind === 'cue' ? 'equipped_cue_id' : 'equipped_cloth_id';
    await query(`UPDATE players SET ${column} = $1 WHERE id = $2`, [item.id, player.id]);
    const fresh = await loadPlayer(player.id);
    publishPlayer(player.id);
    return { status: 200, body: { equippedCueId: fresh?.equipped_cue_id ?? null, equippedClothId: fresh?.equipped_cloth_id ?? null } };
  });

  router.post('/api/shop/cash-packs/:id/purchase', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const pack = CASH_PACKS.find((entry) => entry.id === ctx.params.id);
    if (!pack) throw ApiError.notFound('No such pack.');
    const key = ctx.req.headers['idempotency-key'];
    const idempotencyKey = typeof key === 'string' ? key.trim() : '';
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw ApiError.validation({ idempotencyKey: 'Send an Idempotency-Key of 1 to 64 characters.' });
    }

    const stored = await queryOne<{ id: string; pack_id: string; status: string; response: Record<string, unknown> | null }>(
      `SELECT id, pack_id, status, response FROM purchases WHERE player_id = $1 AND idempotency_key = $2`,
      [player.id, idempotencyKey],
    );
    if (stored) {
      if (stored.pack_id !== pack.id) throw new ApiError(409, 'idempotency_conflict', 'That key was used for another pack.');
      return { status: 200, body: stored.response ?? {} };
    }

    const lockKey = `${player.id}:${idempotencyKey}`;
    const running = inFlight.get(lockKey);
    if (running) {
      const first = await running;
      return { status: 200, body: first.body };
    }

    const work = (async (): Promise<Reply> => {
      if (player.minor) throw new ApiError(403, 'age_restricted', SHOP_COPY.underEighteen);
      if (!player.email_verified) throw new ApiError(403, 'email_unverified', SHOP_COPY.unverified);
      const paymentId = await chargePack({
        playerId: player.id,
        email: player.email ?? '',
        displayName: player.display_name,
        priceUsd: pack.priceUsd,
        idempotencyKey,
      });
      const purchaseId = randomUUID();
      const cash = await transaction(async (client) => {
        await credit(client, player.id, 'cash', pack.cash, 'cash_purchase', purchaseId);
        const after = await client.query<{ cash: string }>(`SELECT cash FROM players WHERE id = $1`, [player.id]);
        return Number(after.rows[0]?.cash ?? 0);
      });
      const receipt = await sendReceipt({
        playerId: player.id,
        email: player.email ?? '',
        packName: pack.name,
        cash: pack.cash,
        priceUsd: pack.priceUsd,
        paymentId,
      });
      const body = { purchaseId, status: 'confirmed', cash, paymentId, receipt };
      await query(
        `INSERT INTO purchases (id, player_id, pack_id, idempotency_key, status, payment_id, receipt, response)
         VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7)`,
        [purchaseId, player.id, pack.id, idempotencyKey, paymentId, receipt, JSON.stringify(body)],
      );
      publishPlayer(player.id);
      return { status: 201, body };
    })();

    inFlight.set(lockKey, work);
    try {
      return await work;
    } finally {
      inFlight.delete(lockKey);
    }
  });
}
