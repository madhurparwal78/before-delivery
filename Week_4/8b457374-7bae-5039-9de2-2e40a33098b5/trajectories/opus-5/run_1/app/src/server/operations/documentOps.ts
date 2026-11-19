import { findCampaign, type CampaignRow } from '../data/campaigns.js';
import { pool } from '../data/db.js';
import {
  listPendingSettlements,
  listPendingStatements,
  markSettlementReady,
  markStatementReady,
} from '../data/documents.js';
import { findCover } from '../data/media.js';
import { findPersonById, type PersonRow } from '../data/people.js';
import { findPledge } from '../data/pledges.js';
import { findTier } from '../data/tiers.js';
import { statementHtml, settlementHtml } from '../render/documentHtml.js';
import { renderPdf } from '../services/gotenberg.js';
import { getObject, putObjectConfirmed } from '../services/storage.js';
import { queueSettlementReady } from './notices.js';
import { computeSettlement } from './settlement.js';

async function coverDataUri(campaignId: string): Promise<string | null> {
  const cover = await findCover(pool, campaignId);
  if (cover === null || cover.status !== 'stored') return null;
  const bytes = await getObject(cover.object_key);
  if (bytes === null) return null;
  return `data:${cover.content_type};base64,${bytes.toString('base64')}`;
}

/** A statement shows as ready only after the render and the store both succeed. */
export async function renderPendingStatements(): Promise<void> {
  for (const row of await listPendingStatements(pool)) {
    const pledge = await findPledge(pool, row.pledge_id);
    if (pledge === null || pledge.state !== 'captured') continue;
    const campaign = (await findCampaign(pool, pledge.campaign_id)) as CampaignRow;
    const backer = (await findPersonById(pool, pledge.backer_id)) as PersonRow;
    const tier = await findTier(pool, pledge.tier_id);
    try {
      const pdf = await renderPdf(
        statementHtml({
          pledgeId: pledge.id,
          campaignTitle: campaign.title,
          backerName: backer.name,
          tierTitle: tier?.title ?? '',
          zone: pledge.zone,
          reward: pledge.reward,
          shipping: pledge.shipping,
          addOn: pledge.add_on,
          amount: pledge.amount,
          platformFee: pledge.platform_fee ?? 0,
          processingFee: pledge.processing_fee ?? 0,
          toCreator: pledge.to_creator ?? 0,
          coverDataUri: await coverDataUri(campaign.id),
        }),
      );
      if (await putObjectConfirmed(row.object_key, pdf, 'application/pdf')) {
        await markStatementReady(pool, pledge.id);
      }
    } catch {
      // Gotenberg or MinIO is unreachable; the statement stays pending for the retry.
    }
  }
}

export async function renderPendingSettlements(): Promise<void> {
  for (const row of await listPendingSettlements(pool)) {
    const campaign = await findCampaign(pool, row.campaign_id);
    if (campaign === null) continue;
    const settlement = await computeSettlement(pool, campaign);
    try {
      const pdf = await renderPdf(settlementHtml(campaign.title, settlement));
      if (!(await putObjectConfirmed(row.object_key, pdf, 'application/pdf'))) continue;
      await markSettlementReady(pool, campaign.id);
      const creator = (await findPersonById(pool, campaign.creator_id)) as PersonRow;
      await queueSettlementReady(pool, campaign, creator, settlement.net);
    } catch {
      // The sheet stays pending until the renderer and the bucket are both back.
    }
  }
}
