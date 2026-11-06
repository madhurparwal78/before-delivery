import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../db/pool.js';
import { packBalances, packLedger, writeMovement } from '../domain/pack.js';
import { ownRenter, renterInScope } from '../domain/records.js';
import { json, type Ctx, type Reply } from '../http/context.js';
import { billingUnavailable, validation } from '../http/errors.js';
import { runIdempotent } from '../http/idempotency.js';
import type { Route } from '../http/router.js';
import { BillingUnavailableError, recordPurchase } from '../services/killbill.js';

const PACK_PRODUCT = '20h';
const PACK_MINUTES = 1200;
const PACK_PRICE_CENTS = 56000;

async function buyPack(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireRole('renter');
  const renter = await ownRenter(actor);
  return runIdempotent(ctx, actor, async () => {
    const body = ctx.body();
    if (body.product !== PACK_PRODUCT) {
      throw validation({ product: 'The only hour pack is 20h.' });
    }
    const packId = `pack-${randomUUID()}`;
    try {
      await recordPurchase(
        { renterId: renter.id, name: renter.name, email: renter.email },
        `hs-pack-${packId}`,
        PACK_PRICE_CENTS,
      );
    } catch (error) {
      if (error instanceof BillingUnavailableError) throw billingUnavailable();
      throw error;
    }
    const available = await transaction(async (client) => {
      await client.query(
        `INSERT INTO packs (id, renter_id, product, minutes, price_cents) VALUES ($1, $2, $3, $4, $5)`,
        [packId, renter.id, PACK_PRODUCT, PACK_MINUTES, PACK_PRICE_CENTS],
      );
      await writeMovement(client, {
        renterId: renter.id,
        reason: 'purchase',
        minutes: PACK_MINUTES,
        packId,
      });
      return (await packBalances(client, renter.id)).availableMinutes;
    });
    return json(201, {
      pack: { id: packId, minutes: PACK_MINUTES, price_cents: PACK_PRICE_CENTS },
      available_minutes: available,
    });
  });
}

export const packRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/me/pack',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireRole('renter');
      const renter = await ownRenter(actor);
      return json(200, await packLedger(pool, renter.id));
    },
  },
  {
    method: 'GET',
    pattern: '/api/renters/:id/pack',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const renter = await renterInScope(actor, ctx.params.id as string);
      ctx.requireRole('front_desk', 'manager');
      return json(200, await packLedger(pool, renter.id));
    },
  },
  { method: 'POST', pattern: '/api/packs', handle: buyPack },
];
