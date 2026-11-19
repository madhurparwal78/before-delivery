import { config, MAX_CAMPAIGN_SECONDS } from '../config.js';
import {
  insertCampaign,
  listCampaignsByCreator,
  listPublicCampaigns,
  setCampaignStatus,
  updateCampaignFields,
  type CampaignRow,
} from '../data/campaigns.js';
import { pool } from '../data/db.js';
import { findCover, listMedia } from '../data/media.js';
import { findPersonById, type PersonRow } from '../data/people.js';
import { listNoticesByCampaign } from '../data/notices.js';
import { listPledgesByCampaign } from '../data/pledges.js';
import { countTiers } from '../data/tiers.js';
import { newId } from '../domain/ids.js';
import { rejectCreatorCancel, rejectUnlessDraft } from '../domain/transitions.js';
import { validateCampaign } from '../domain/validation.js';
import { conflict, invalid, paymentUnavailable } from '../http/errors.js';
import { json, requirePerson, type Router } from '../http/router.js';
import { releaseHolds } from '../operations/collection.js';
import { withCampaignLock } from '../operations/locks.js';
import { loadVisibleCampaign } from '../operations/pledgeOps.js';
import {
  campaignDto,
  campaignRowDtos,
  noticeDto,
  pastDeadline,
  pledgesWithBackers,
} from '../views.js';
import { loadOwnCampaign } from './helpers.js';

async function dtoFor(campaign: CampaignRow, now: Date): Promise<unknown> {
  const creator = (await findPersonById(pool, campaign.creator_id)) as PersonRow;
  return campaignDto(pool, campaign, creator, now);
}

export function registerCampaignRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/campaigns',
    auth: 'optional',
    body: 'none',
    handle: async () =>
      json(200, await campaignRowDtos(pool, await listPublicCampaigns(pool), new Date())),
  });

  router.add({
    method: 'GET',
    pattern: '/api/me/campaigns',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const rows = await listCampaignsByCreator(pool, person.id);
      return json(200, await campaignRowDtos(pool, rows, new Date()));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/campaigns',
    auth: 'required',
    body: 'json',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const fields = validateCampaign(ctx.body, null);
      const campaign = await insertCampaign(pool, newId('cmp'), person.id, fields);
      return json(201, await dtoFor(campaign, new Date()));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/campaigns/{id}',
    auth: 'optional',
    body: 'none',
    handle: async (ctx) => {
      const campaign = await loadVisibleCampaign(ctx.params['id'] as string, ctx.person);
      return json(200, await dtoFor(campaign, new Date()));
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/campaigns/{id}',
    auth: 'required',
    body: 'json',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const rejection = rejectUnlessDraft(campaign.status);
      if (rejection !== null) throw conflict(rejection);
      const fields = validateCampaign(ctx.body, campaign);
      const updated = await updateCampaignFields(pool, campaign.id, fields);
      return json(200, await dtoFor(updated, new Date()));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/campaigns/{id}/launch',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const rejection = rejectUnlessDraft(campaign.status);
      if (rejection !== null) throw conflict(rejection);

      const media = await listMedia(pool, campaign.id);
      if (media.some((row) => row.status !== 'stored')) throw conflict('media_not_stored');
      if ((await findCover(pool, campaign.id)) === null) {
        throw invalid({ cover: 'Upload a cover before launching.' });
      }
      if ((await countTiers(pool, campaign.id)) === 0) {
        throw invalid({ tiers: 'Add at least one reward tier before launching.' });
      }

      const now = new Date();
      const secondsAway = (campaign.deadline_utc.getTime() - now.getTime()) / 1000;
      if (secondsAway < config.minCampaignSeconds || secondsAway > MAX_CAMPAIGN_SECONDS) {
        throw invalid({
          deadline_local: 'Set a deadline between one day and 60 days from launch.',
        });
      }

      await setCampaignStatus(pool, campaign.id, 'live', 'launched_at');
      return json(200, await dtoFor({ ...campaign, status: 'live' }, now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/campaigns/{id}/cancel',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const now = new Date();
      const rejection = rejectCreatorCancel(campaign.status, pastDeadline(campaign, now));
      if (rejection !== null) throw conflict(rejection);

      const cancelled: CampaignRow = { ...campaign, status: 'cancelled' };
      await withCampaignLock(campaign.id, async () => {
        const { failed } = await releaseHolds(cancelled, 'campaign_cancelled');
        if (failed > 0) throw paymentUnavailable();
        await setCampaignStatus(pool, campaign.id, 'cancelled', 'closed_at');
      });
      return json(200, await dtoFor(cancelled, now));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/campaigns/{id}/pledges',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const pledges = await listPledgesByCampaign(pool, campaign.id);
      const backers = new Map<string, PersonRow>();
      for (const pledge of pledges) {
        if (backers.has(pledge.backer_id)) continue;
        const backer = await findPersonById(pool, pledge.backer_id);
        if (backer !== null) backers.set(backer.id, backer);
      }
      return json(200, await pledgesWithBackers(pool, pledges, backers, new Date()));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/campaigns/{id}/notices',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const notices = await listNoticesByCampaign(pool, campaign.id);
      return json(200, notices.map(noticeDto));
    },
  });
}
