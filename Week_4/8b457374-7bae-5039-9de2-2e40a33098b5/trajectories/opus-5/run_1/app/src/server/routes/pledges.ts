import { zoneFor } from '../../shared/countries.js';
import { campaignTotals, findCampaign, type CampaignRow } from '../data/campaigns.js';
import { coverIdsForCampaigns } from '../data/media.js';
import { pool } from '../data/db.js';
import { findPledge, listPledgesByBacker } from '../data/pledges.js';
import { findAuthorisedPledge } from '../data/pledges.js';
import { breakdownFor, percentOf } from '../domain/pledgeAmount.js';
import { rejectUnlessPledgingOpen } from '../domain/transitions.js';
import { FieldErrors, validateAddOn, validateCountry } from '../domain/validation.js';
import { conflict, notFound } from '../http/errors.js';
import { json, requirePerson, type Router } from '../http/router.js';
import {
  cancelPledge,
  changePledge,
  createPledge,
  loadTierOfCampaign,
  loadVisibleCampaign,
  readGuestDetails,
} from '../operations/pledgeOps.js';
import {
  pastDeadline,
  pledgesWithCampaigns,
  singlePledgeDto,
} from '../views.js';
import { readIdempotencyKey, serviceError, withIdempotency } from './helpers.js';

export function registerPledgeRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/campaigns/{id}/quote',
    auth: 'optional',
    body: 'json',
    handle: async (ctx) => {
      const now = new Date();
      const campaign = await loadVisibleCampaign(ctx.params['id'] as string, ctx.person);
      const tier = await loadTierOfCampaign(campaign, ctx.body['tier_id']);
      const closed = rejectUnlessPledgingOpen(campaign.status, pastDeadline(campaign, now));
      if (closed !== null) throw conflict(closed);

      const errors = new FieldErrors();
      const country = validateCountry(ctx.body, errors);
      const addOn = validateAddOn(ctx.body, errors);
      errors.throwIfAny();

      const zone = zoneFor(campaign.ships_from, country);
      const breakdown = breakdownFor(
        {
          price: tier.price,
          shipping: {
            domestic: tier.ship_domestic,
            europe: tier.ship_europe,
            rest_of_world: tier.ship_rest_of_world,
          },
        },
        zone,
        addOn,
      );

      const { total } = await campaignTotals(pool, campaign.id);
      const held =
        ctx.person === null ? null : await findAuthorisedPledge(pool, campaign.id, ctx.person.id);
      const projectedTotal = total - (held?.amount ?? 0) + breakdown.amount;
      return json(200, {
        tier_id: tier.id,
        zone,
        reward: breakdown.reward,
        shipping: breakdown.shipping,
        add_on: breakdown.add_on,
        amount: breakdown.amount,
        projected_total: projectedTotal,
        projected_percent: percentOf(projectedTotal, campaign.goal),
      });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/campaigns/{id}/pledges',
    auth: 'optional',
    body: 'json',
    handle: async (ctx) => {
      const campaignId = ctx.params['id'] as string;
      const key = readIdempotencyKey(ctx);
      let scope: string;
      if (ctx.person !== null) {
        scope = `person:${ctx.person.id}`;
      } else {
        const guest = readGuestDetails(ctx.body);
        if (guest.error !== null) throw guest.error;
        scope = `email:${guest.email.toLowerCase()}`;
      }

      return withIdempotency(scope, 'create_pledge', key, ctx.body, async () => {
        const now = new Date();
        const outcome = await createPledge({
          campaignId,
          viewer: ctx.person,
          body: ctx.body,
        }).catch((error: unknown) => {
          throw serviceError(error);
        });
        const dto = await singlePledgeDto(pool, outcome.pledge, now);
        const { total } = await campaignTotals(pool, outcome.campaign.id);
        const body: Record<string, unknown> = {
          ...dto,
          campaign_total: total,
          campaign_percent: percentOf(total, outcome.campaign.goal),
        };
        if (outcome.createdKey !== null) body['key'] = outcome.createdKey;
        return json(201, body);
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/me/pledges',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const pledges = await listPledgesByBacker(pool, person.id);
      const campaigns = new Map<string, CampaignRow>();
      for (const pledge of pledges) {
        if (campaigns.has(pledge.campaign_id)) continue;
        const campaign = await findCampaign(pool, pledge.campaign_id);
        if (campaign !== null) campaigns.set(campaign.id, campaign);
      }
      const covers = await coverIdsForCampaigns(pool, [...campaigns.keys()]);
      return json(
        200,
        await pledgesWithCampaigns(pool, pledges, campaigns, covers, new Date()),
      );
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/pledges/{id}',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const pledge = await findPledge(pool, ctx.params['id'] as string);
      if (pledge === null || pledge.backer_id !== person.id) throw notFound();
      return json(200, await singlePledgeDto(pool, pledge, new Date()));
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/pledges/{id}',
    auth: 'required',
    body: 'json',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const pledgeId = ctx.params['id'] as string;
      const key = readIdempotencyKey(ctx);
      return withIdempotency(
        `person:${person.id}`,
        `change_pledge:${pledgeId}`,
        key,
        ctx.body,
        async () => {
          const outcome = await changePledge({
            pledgeId,
            viewer: person,
            body: ctx.body,
          }).catch((error: unknown) => {
            throw serviceError(error);
          });
          const dto = await singlePledgeDto(pool, outcome.pledge, new Date());
          const { total } = await campaignTotals(pool, outcome.campaign.id);
          return json(201, {
            ...dto,
            campaign_total: total,
            campaign_percent: percentOf(total, outcome.campaign.goal),
          });
        },
      );
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/pledges/{id}/cancel',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const outcome = await cancelPledge(ctx.params['id'] as string, person).catch(
        (error: unknown) => {
          throw serviceError(error);
        },
      );
      return json(200, await singlePledgeDto(pool, outcome.pledge, new Date()));
    },
  });
}
