import type {
  CampaignDto,
  CampaignRowDto,
  DocumentStatus,
  MediaDto,
  NoticeDto,
  PledgeDto,
  PledgeWithBackerDto,
  PledgeWithCampaignDto,
  TierDto,
} from '../shared/types.js';
import { campaignTotals, totalsForCampaigns } from './data/campaigns.js';
import type { CampaignRow, CampaignTotals } from './data/campaigns.js';
import type { Db } from './data/db.js';
import { statementStatuses } from './data/documents.js';
import { coverIdsForCampaigns, listMedia } from './data/media.js';
import type { MediaRow } from './data/media.js';
import { historyFor } from './data/pledges.js';
import type { PledgeRow } from './data/pledges.js';
import type { NoticeRow } from './data/notices.js';
import { claimedCounts, listTiers } from './data/tiers.js';
import type { TierRow } from './data/tiers.js';
import type { PersonRow } from './data/people.js';
import { percentOf } from './domain/pledgeAmount.js';

export function pledgingOpen(campaign: CampaignRow, now: Date): boolean {
  return campaign.status === 'live' && now.getTime() < campaign.deadline_utc.getTime();
}

/** Pledging closes from the deadline instant, with the instant itself included. */
export function pastDeadline(campaign: CampaignRow, now: Date): boolean {
  return now.getTime() >= campaign.deadline_utc.getTime();
}

function secondsLeft(campaign: CampaignRow, now: Date): number | null {
  if (campaign.status === 'draft') return null;
  if (!pledgingOpen(campaign, now)) return 0;
  return Math.ceil((campaign.deadline_utc.getTime() - now.getTime()) / 1000);
}

export function tierDto(tier: TierRow, claimed: number): TierDto {
  return {
    id: tier.id,
    title: tier.title,
    description: tier.description,
    price: tier.price,
    quantity: tier.quantity,
    claimed,
    remaining: tier.quantity === null ? null : tier.quantity - claimed,
    shipping: {
      domestic: tier.ship_domestic,
      europe: tier.ship_europe,
      rest_of_world: tier.ship_rest_of_world,
    },
  };
}

function mediaDto(media: MediaRow): MediaDto {
  return {
    id: media.id,
    kind: media.kind,
    status: media.status,
    content_type: media.content_type,
    bytes: media.bytes,
  };
}

export async function campaignDto(
  db: Db,
  campaign: CampaignRow,
  creator: PersonRow,
  now: Date,
): Promise<CampaignDto> {
  const [totals, tiers, claimed, media] = await Promise.all([
    campaignTotals(db, campaign.id),
    listTiers(db, campaign.id),
    claimedCounts(db, campaign.id),
    listMedia(db, campaign.id),
  ]);
  return {
    id: campaign.id,
    title: campaign.title,
    story: campaign.story,
    status: campaign.status,
    pledging_open: pledgingOpen(campaign, now),
    creator: { id: creator.id, name: creator.name },
    goal: campaign.goal,
    min_run_copies: campaign.min_run_copies,
    stretch: campaign.stretch.map((point) => ({
      copies: point.copies,
      amount: point.amount,
      reached: totals.total >= point.amount,
    })),
    ships_from: campaign.ships_from,
    time_zone: campaign.time_zone,
    deadline_local: campaign.deadline_local,
    deadline_utc: campaign.deadline_utc.toISOString(),
    seconds_left: secondsLeft(campaign, now),
    total: totals.total,
    captured_total: totals.captured_total,
    backer_count: totals.backer_count,
    percent: percentOf(totals.total, campaign.goal),
    media: media.map(mediaDto),
    tiers: tiers.map((tier) => tierDto(tier, claimed.get(tier.id) ?? 0)),
  };
}

function campaignRowDto(
  campaign: CampaignRow,
  totals: CampaignTotals,
  coverId: string | null,
  now: Date,
): CampaignRowDto {
  return {
    id: campaign.id,
    title: campaign.title,
    status: campaign.status,
    total: totals.total,
    goal: campaign.goal,
    percent: percentOf(totals.total, campaign.goal),
    pledging_open: pledgingOpen(campaign, now),
    cover_media_id: coverId,
  };
}

export async function campaignRowDtos(
  db: Db,
  campaigns: readonly CampaignRow[],
  now: Date,
): Promise<CampaignRowDto[]> {
  const ids = campaigns.map((c) => c.id);
  const [totals, covers] = await Promise.all([
    totalsForCampaigns(db, ids),
    coverIdsForCampaigns(db, ids),
  ]);
  return campaigns.map((campaign) =>
    campaignRowDto(
      campaign,
      totals.get(campaign.id) ?? { total: 0, captured_total: 0, backer_count: 0 },
      covers.get(campaign.id) ?? null,
      now,
    ),
  );
}

function fixSecondsLeft(pledge: PledgeRow, now: Date): number | null {
  if (pledge.fix_deadline_utc === null) return null;
  return Math.max(0, Math.ceil((pledge.fix_deadline_utc.getTime() - now.getTime()) / 1000));
}

export function pledgeDto(
  pledge: PledgeRow,
  history: { state: PledgeDto['state']; at: Date }[],
  statement: DocumentStatus,
  now: Date,
): PledgeDto {
  const fees =
    pledge.platform_fee === null || pledge.processing_fee === null || pledge.to_creator === null
      ? null
      : {
          platform_fee: pledge.platform_fee,
          processing_fee: pledge.processing_fee,
          to_creator: pledge.to_creator,
        };
  return {
    id: pledge.id,
    campaign_id: pledge.campaign_id,
    tier_id: pledge.tier_id,
    country: pledge.country,
    zone: pledge.zone,
    reward: pledge.reward,
    shipping: pledge.shipping,
    add_on: pledge.add_on,
    amount: pledge.amount,
    state: pledge.state,
    card_last4: pledge.card_last4,
    replaces: pledge.replaces,
    created_at: pledge.created_at.toISOString(),
    history: history.map((entry) => ({ state: entry.state, at: entry.at.toISOString() })),
    statement,
    fees,
    fix_deadline_utc: pledge.fix_deadline_utc === null ? null : pledge.fix_deadline_utc.toISOString(),
    fix_seconds_left: fixSecondsLeft(pledge, now),
    card_fixed: pledge.card_fixed,
    fix_code: pledge.fix_code,
  };
}

export async function pledgeDtos(
  db: Db,
  pledges: readonly PledgeRow[],
  now: Date,
): Promise<PledgeDto[]> {
  const ids = pledges.map((p) => p.id);
  const [history, statements] = await Promise.all([
    historyFor(db, ids),
    statementStatuses(db, ids),
  ]);
  return pledges.map((pledge) =>
    pledgeDto(pledge, history.get(pledge.id) ?? [], statements.get(pledge.id) ?? 'none', now),
  );
}

export async function singlePledgeDto(db: Db, pledge: PledgeRow, now: Date): Promise<PledgeDto> {
  const dtos = await pledgeDtos(db, [pledge], now);
  return dtos[0] as PledgeDto;
}

export async function pledgesWithBackers(
  db: Db,
  pledges: readonly PledgeRow[],
  backers: ReadonlyMap<string, PersonRow>,
  now: Date,
): Promise<PledgeWithBackerDto[]> {
  const dtos = await pledgeDtos(db, pledges, now);
  return dtos.map((dto, index) => {
    const row = pledges[index] as PledgeRow;
    const backer = backers.get(row.backer_id);
    return {
      ...dto,
      fix_code: null,
      backer: {
        id: row.backer_id,
        name: backer?.name ?? '',
        email: backer?.email ?? '',
      },
    };
  });
}

export async function pledgesWithCampaigns(
  db: Db,
  pledges: readonly PledgeRow[],
  campaigns: ReadonlyMap<string, CampaignRow>,
  covers: ReadonlyMap<string, string>,
  now: Date,
): Promise<PledgeWithCampaignDto[]> {
  const dtos = await pledgeDtos(db, pledges, now);
  return dtos.map((dto, index) => {
    const row = pledges[index] as PledgeRow;
    const campaign = campaigns.get(row.campaign_id) as CampaignRow;
    return {
      ...dto,
      campaign: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        cover_media_id: covers.get(campaign.id) ?? null,
      },
    };
  });
}

export function noticeDto(notice: NoticeRow): NoticeDto {
  return {
    kind: notice.kind,
    to: notice.to_email,
    subject: notice.subject,
    status: notice.status,
    created_at: notice.created_at.toISOString(),
    sent_at: notice.sent_at === null ? null : notice.sent_at.toISOString(),
  };
}
