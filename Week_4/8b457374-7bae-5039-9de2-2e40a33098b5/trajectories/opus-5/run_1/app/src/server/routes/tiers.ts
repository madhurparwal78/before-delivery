import { pool } from '../data/db.js';
import {
  claimedCount,
  countTiers,
  deleteTier,
  findTier,
  insertTier,
  updateTier,
} from '../data/tiers.js';
import { newId } from '../domain/ids.js';
import { rejectUnlessDraft } from '../domain/transitions.js';
import { validateTier } from '../domain/validation.js';
import { conflict, invalid, notFound } from '../http/errors.js';
import { empty, json, requirePerson, type Router } from '../http/router.js';
import { tierDto } from '../views.js';
import { loadOwnCampaign } from './helpers.js';

const MAX_TIERS = 8;

export function registerTierRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/campaigns/{id}/tiers',
    auth: 'required',
    body: 'json',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const rejection = rejectUnlessDraft(campaign.status);
      if (rejection !== null) throw conflict(rejection);
      if ((await countTiers(pool, campaign.id)) >= MAX_TIERS) {
        throw invalid({ tiers: 'A campaign holds up to 8 reward tiers.' });
      }
      const fields = validateTier(ctx.body, null);
      const tier = await insertTier(pool, newId('tier'), campaign.id, fields);
      return json(201, tierDto(tier, 0));
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/tiers/{id}',
    auth: 'required',
    body: 'json',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const tier = await findTier(pool, ctx.params['id'] as string);
      if (tier === null) throw notFound();
      const campaign = await loadOwnCampaign(tier.campaign_id, person);
      const rejection = rejectUnlessDraft(campaign.status);
      if (rejection !== null) throw conflict(rejection);
      const fields = validateTier(ctx.body, {
        title: tier.title,
        description: tier.description,
        price: tier.price,
        quantity: tier.quantity,
        shipping: {
          domestic: tier.ship_domestic,
          europe: tier.ship_europe,
          rest_of_world: tier.ship_rest_of_world,
        },
      });
      const updated = await updateTier(pool, tier.id, fields);
      return json(200, tierDto(updated, await claimedCount(pool, updated.id)));
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/tiers/{id}',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const tier = await findTier(pool, ctx.params['id'] as string);
      if (tier === null) throw notFound();
      const campaign = await loadOwnCampaign(tier.campaign_id, person);
      const rejection = rejectUnlessDraft(campaign.status);
      if (rejection !== null) throw conflict(rejection);
      await deleteTier(pool, tier.id);
      return empty(204);
    },
  });
}
