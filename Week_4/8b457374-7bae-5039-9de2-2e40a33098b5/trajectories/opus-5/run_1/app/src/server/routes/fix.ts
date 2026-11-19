import type { FixDto } from '../../shared/types.js';
import type { CampaignRow } from '../data/campaigns.js';
import type { PledgeRow } from '../data/pledges.js';
import { json, type Router } from '../http/router.js';
import { applyFix, loadFixTarget } from '../operations/fixOps.js';
import { serviceError } from './helpers.js';

function fixDto(pledge: PledgeRow, campaign: CampaignRow, now: Date): FixDto {
  const deadline = pledge.fix_deadline_utc as Date;
  return {
    pledge_id: pledge.id,
    campaign_title: campaign.title,
    amount: pledge.amount,
    state: pledge.state,
    fix_deadline_utc: deadline.toISOString(),
    fix_seconds_left: Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000)),
    card_fixed: pledge.card_fixed ?? false,
  };
}

export function registerFixRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/fix/{code}',
    auth: 'none',
    body: 'none',
    handle: async (ctx) => {
      const { pledge, campaign } = await loadFixTarget(ctx.params['code'] as string);
      return json(200, fixDto(pledge, campaign, new Date()));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/fix/{code}',
    auth: 'none',
    body: 'json',
    handle: async (ctx) => {
      const { pledge, campaign } = await applyFix(ctx.params['code'] as string, ctx.body).catch(
        (error: unknown) => {
          throw serviceError(error);
        },
      );
      return json(200, fixDto(pledge, campaign, new Date()));
    },
  });
}
