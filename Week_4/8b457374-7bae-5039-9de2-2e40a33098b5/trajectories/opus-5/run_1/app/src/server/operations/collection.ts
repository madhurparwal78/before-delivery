import { config } from '../config.js';
import {
  campaignTotals,
  findCampaign,
  listCampaignsInStatus,
  listCampaignsPastDeadline,
  setCampaignStatus,
  type CampaignRow,
} from '../data/campaigns.js';
import { pool, transaction } from '../data/db.js';
import { recordPendingSettlement, recordPendingStatement } from '../data/documents.js';
import { findPersonById, type PersonRow } from '../data/people.js';
import {
  bumpFixNotices,
  listErroredPledges,
  listPledgesByCampaign,
  movePledge,
  type PledgeRow,
} from '../data/pledges.js';
import { feesFor } from '../domain/fees.js';
import { newFixCode } from '../domain/ids.js';
import { closeOutStatus } from '../domain/transitions.js';
import * as killbill from '../services/killbill.js';
import {
  queueCampaignCancelled,
  queueDropped,
  queueFixPayment,
  queueFundedAndCharged,
  queueNotFunded,
} from './notices.js';
import { withCampaignLock } from './locks.js';

export const STATEMENT_KEY = (pledgeId: string): string => `statements/${pledgeId}.pdf`;
export const SETTLEMENT_KEY = (campaignId: string): string => `settlements/${campaignId}.pdf`;

type ReleaseReason = 'not_funded' | 'campaign_cancelled';

async function backerOf(pledge: PledgeRow): Promise<PersonRow> {
  return (await findPersonById(pool, pledge.backer_id)) as PersonRow;
}

/**
 * Releases every authorised hold. A pledge becomes voided only after Kill Bill
 * confirms the VOID, so an unreachable Kill Bill leaves it authorised for the retry.
 */
export async function releaseHolds(
  campaign: CampaignRow,
  reason: ReleaseReason,
): Promise<{ failed: number }> {
  const pledges = await listPledgesByCampaign(pool, campaign.id, ['authorised']);
  let failed = 0;
  for (const pledge of pledges) {
    try {
      await killbill.voidHold(pledge.killbill_payment_id as string, `${pledge.id}-void`);
    } catch {
      failed += 1;
      continue;
    }
    const backer = await backerOf(pledge);
    await transaction(async (client) => {
      const moved = await movePledge(client, pledge.id, 'voided');
      if (reason === 'not_funded') await queueNotFunded(client, campaign, moved, backer);
      else await queueCampaignCancelled(client, campaign, moved, backer);
    });
  }
  return { failed };
}

/** Captures one held pledge, or marks it errored and opens its fix window. */
async function collect(campaign: CampaignRow, pledge: PledgeRow): Promise<void> {
  const backer = await backerOf(pledge);
  if (!pledge.card_captures) {
    await transaction(async (client) => {
      const errored = await movePledge(client, pledge.id, 'errored', {
        fix_code: newFixCode(),
        fix_deadline_utc: new Date(
          campaign.deadline_utc.getTime() + config.fixWindowSeconds * 1000,
        ),
        card_fixed: false,
      });
      await queueFixPayment(client, campaign, errored, backer, 0);
      await bumpFixNotices(client, errored.id, 1);
    });
    return;
  }
  await killbill.capture(
    pledge.killbill_payment_id as string,
    `${pledge.id}-capture`,
    pledge.amount,
  );
  await recordCapture(campaign, pledge, backer);
}

/** A pledge is never captured without its notice and statement records. */
async function recordCapture(
  campaign: CampaignRow,
  pledge: PledgeRow,
  backer: PersonRow,
): Promise<void> {
  const fees = feesFor(pledge.amount);
  await transaction(async (client) => {
    const captured = await movePledge(client, pledge.id, 'captured', {
      platform_fee: fees.platform_fee,
      processing_fee: fees.processing_fee,
      to_creator: fees.to_creator,
    });
    await queueFundedAndCharged(client, campaign, captured, backer);
    await recordPendingStatement(client, captured.id, STATEMENT_KEY(captured.id));
  });
}

/** Moves a funded campaign through collecting to settled as capture results land. */
async function advanceFunded(campaign: CampaignRow): Promise<void> {
  const held = await listPledgesByCampaign(pool, campaign.id, ['authorised']);
  for (const pledge of held) {
    try {
      await collect(campaign, pledge);
    } catch {
      // Kill Bill is unreachable, so the pledge stays authorised for the next retry.
      return;
    }
  }

  const remaining = await listPledgesByCampaign(pool, campaign.id);
  if (remaining.some((pledge) => pledge.state === 'authorised')) return;
  if (campaign.status === 'funded') {
    await setCampaignStatus(pool, campaign.id, 'collecting', null);
  }
  if (!remaining.some((pledge) => pledge.state === 'errored')) {
    await setCampaignStatus(pool, campaign.id, 'settled', 'settled_at');
    await recordPendingSettlement(pool, campaign.id, SETTLEMENT_KEY(campaign.id));
  }
}

/** Close-out: the deadline has passed, so the server decides funded or unfunded. */
async function closeOut(campaign: CampaignRow): Promise<void> {
  const { total } = await campaignTotals(pool, campaign.id);
  const next = closeOutStatus(total, campaign.goal);
  await setCampaignStatus(pool, campaign.id, next, 'closed_at');
  const closed = (await findCampaign(pool, campaign.id)) as CampaignRow;
  if (next === 'unfunded') await releaseHolds(closed, 'not_funded');
  else await advanceFunded(closed);
}

export async function runCloseOuts(): Promise<void> {
  const due = await listCampaignsPastDeadline(pool);
  for (const campaign of due) {
    await withCampaignLock(campaign.id, async () => {
      const fresh = await findCampaign(pool, campaign.id);
      if (fresh === null || fresh.status !== 'live') return;
      await closeOut(fresh);
    });
  }
}

/** Retries the voids and captures that an unreachable Kill Bill left outstanding. */
export async function runCollectionRetries(): Promise<void> {
  for (const campaign of await listCampaignsInStatus(pool, ['unfunded', 'cancelled'])) {
    await withCampaignLock(campaign.id, () =>
      releaseHolds(campaign, campaign.status === 'cancelled' ? 'campaign_cancelled' : 'not_funded'),
    );
  }
  for (const campaign of await listCampaignsInStatus(pool, ['funded', 'collecting'])) {
    await withCampaignLock(campaign.id, () => advanceFunded(campaign));
  }
}

/** A fix notice goes out when the pledge errors and at every interval until the window ends. */
export async function runFixNotices(): Promise<void> {
  const now = Date.now();
  for (const pledge of await listErroredPledges(pool)) {
    if (pledge.errored_at === null || pledge.fix_deadline_utc === null) continue;
    const campaign = (await findCampaign(pool, pledge.campaign_id)) as CampaignRow;
    const backer = await backerOf(pledge);
    let sequence = pledge.fix_notices_sent;
    for (;;) {
      const due = pledge.errored_at.getTime() + sequence * config.fixNoticeSeconds * 1000;
      if (due > now || due >= pledge.fix_deadline_utc.getTime()) break;
      await transaction(async (client) => {
        await queueFixPayment(client, campaign, pledge, backer, sequence);
        await bumpFixNotices(client, pledge.id, sequence + 1);
      });
      sequence += 1;
    }
  }
}

/** When the fix window ends the server makes one final collection attempt. */
export async function runFinalAttempts(): Promise<void> {
  const now = Date.now();
  for (const pledge of await listErroredPledges(pool)) {
    if (pledge.fix_deadline_utc === null || pledge.fix_deadline_utc.getTime() > now) continue;
    const campaign = (await findCampaign(pool, pledge.campaign_id)) as CampaignRow;
    await withCampaignLock(campaign.id, () => finalAttempt(campaign, pledge));
  }
}

async function finalAttempt(campaign: CampaignRow, pledge: PledgeRow): Promise<void> {
  const backer = await backerOf(pledge);
  const holdPaymentId = pledge.fix_payment_id ?? (pledge.killbill_payment_id as string);
  const holdKey =
    pledge.fix_payment_id === null ? pledge.id : `${pledge.id}-fix-${pledge.fix_attempt}`;

  if (pledge.card_captures) {
    try {
      await killbill.capture(holdPaymentId, `${holdKey}-capture`, pledge.amount);
    } catch {
      return;
    }
    await recordCapture(campaign, pledge, backer);
  } else {
    try {
      if (pledge.fix_payment_id !== null) {
        await killbill.voidHold(pledge.fix_payment_id, `${holdKey}-void`);
      }
      await killbill.voidHold(pledge.killbill_payment_id as string, `${pledge.id}-void`);
    } catch {
      return;
    }
    await transaction(async (client) => {
      const dropped = await movePledge(client, pledge.id, 'dropped');
      await queueDropped(client, campaign, dropped, backer);
    });
  }
  await withSettledCheck(campaign);
}

async function withSettledCheck(campaign: CampaignRow): Promise<void> {
  const remaining = await listPledgesByCampaign(pool, campaign.id);
  if (remaining.some((pledge) => pledge.state === 'errored' || pledge.state === 'authorised')) {
    return;
  }
  const fresh = (await findCampaign(pool, campaign.id)) as CampaignRow;
  if (fresh.status === 'settled') return;
  await setCampaignStatus(pool, campaign.id, 'settled', 'settled_at');
  await recordPendingSettlement(pool, campaign.id, SETTLEMENT_KEY(campaign.id));
}
