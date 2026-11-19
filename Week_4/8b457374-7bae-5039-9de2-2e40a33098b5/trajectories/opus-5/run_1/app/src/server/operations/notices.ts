import { formatMoney } from '../../shared/money.js';
import { config } from '../config.js';
import type { CampaignRow } from '../data/campaigns.js';
import type { Db } from '../data/db.js';
import { recordNotice, type NoticeKind } from '../data/notices.js';
import type { PersonRow } from '../data/people.js';
import type { PledgeRow } from '../data/pledges.js';

interface NoticeTemplate {
  readonly kind: NoticeKind;
  readonly subject: string;
  readonly body: string;
  readonly dedupe_key: string;
}

function pledgeLines(campaign: CampaignRow, pledge: PledgeRow, person: PersonRow): string[] {
  return [
    `Hello ${person.name},`,
    '',
    `Campaign: ${campaign.title}`,
    `Pledge: ${pledge.id}`,
    `Amount: ${formatMoney(pledge.amount)}`,
  ];
}

function receipt(campaign: CampaignRow, pledge: PledgeRow, person: PersonRow): NoticeTemplate {
  return {
    kind: 'pledge_receipt',
    subject: `Pledge held: ${campaign.title}`,
    body: [
      ...pledgeLines(campaign, pledge, person),
      '',
      'Your card is held, not charged.',
      `You are charged ${formatMoney(pledge.amount)} only if the print run is funded by the deadline.`,
      '',
      `${config.publicUrl}/campaigns/${campaign.id}`,
    ].join('\n'),
    dedupe_key: `pledge_receipt:${pledge.id}`,
  };
}

function cancelled(campaign: CampaignRow, pledge: PledgeRow, person: PersonRow): NoticeTemplate {
  return {
    kind: 'pledge_cancelled',
    subject: `Pledge cancelled: ${campaign.title}`,
    body: [
      ...pledgeLines(campaign, pledge, person),
      '',
      `The hold of ${formatMoney(pledge.amount)} on your card was released.`,
    ].join('\n'),
    dedupe_key: `pledge_cancelled:${pledge.id}`,
  };
}

function fundedAndCharged(
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): NoticeTemplate {
  return {
    kind: 'funded_and_charged',
    subject: `Funded and charged: ${campaign.title}`,
    body: [
      ...pledgeLines(campaign, pledge, person),
      '',
      `The run is funded, so ${formatMoney(pledge.amount)} was charged to your card.`,
      'Your statement will be ready to download from My pledges shortly.',
      '',
      `${config.publicUrl}/pledges`,
    ].join('\n'),
    dedupe_key: `funded_and_charged:${pledge.id}`,
  };
}

function notFunded(campaign: CampaignRow, pledge: PledgeRow, person: PersonRow): NoticeTemplate {
  return {
    kind: 'not_funded',
    subject: `Not funded, card released: ${campaign.title}`,
    body: [
      ...pledgeLines(campaign, pledge, person),
      '',
      `The run did not reach its minimum, so no card was charged.`,
      `The hold of ${formatMoney(pledge.amount)} on your card was released.`,
    ].join('\n'),
    dedupe_key: `not_funded:${pledge.id}`,
  };
}

function campaignCancelled(
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): NoticeTemplate {
  return {
    kind: 'campaign_cancelled',
    subject: `Campaign cancelled: ${campaign.title}`,
    body: [
      ...pledgeLines(campaign, pledge, person),
      '',
      'The creator cancelled this campaign, so no card was charged.',
      `The hold of ${formatMoney(pledge.amount)} on your card was released.`,
    ].join('\n'),
    dedupe_key: `campaign_cancelled:${pledge.id}`,
  };
}

function fixPayment(
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
  sequence: number,
): NoticeTemplate {
  return {
    kind: 'fix_payment',
    subject: `Fix your payment: ${campaign.title}`,
    body: [
      ...pledgeLines(campaign, pledge, person),
      '',
      `We could not collect ${formatMoney(pledge.amount)} from your card.`,
      'Enter a working card before the fix window closes and we will collect it then.',
      '',
      `${config.publicUrl}/fix/${pledge.fix_code ?? ''}`,
    ].join('\n'),
    dedupe_key: `fix_payment:${pledge.id}:${sequence}`,
  };
}

function dropped(campaign: CampaignRow, pledge: PledgeRow, person: PersonRow): NoticeTemplate {
  return {
    kind: 'dropped',
    subject: `Pledge dropped: ${campaign.title}`,
    body: [
      ...pledgeLines(campaign, pledge, person),
      '',
      `We could not collect ${formatMoney(pledge.amount)} before the fix window closed,`,
      'so your pledge was dropped and any remaining hold was released.',
    ].join('\n'),
    dedupe_key: `dropped:${pledge.id}`,
  };
}

function settlementReady(
  campaign: CampaignRow,
  creator: PersonRow,
  net: number,
): NoticeTemplate {
  return {
    kind: 'settlement_ready',
    subject: `Settlement ready: ${campaign.title}`,
    body: [
      `Hello ${creator.name},`,
      '',
      `Campaign: ${campaign.title}`,
      `Net to you: ${formatMoney(net)}`,
      '',
      'Your settlement sheet is ready to download in the Studio.',
      '',
      `${config.publicUrl}/studio/campaigns/${campaign.id}`,
    ].join('\n'),
    dedupe_key: `settlement_ready:${campaign.id}`,
  };
}

async function queue(
  db: Db,
  campaign: CampaignRow,
  person: PersonRow,
  template: NoticeTemplate,
): Promise<void> {
  await recordNotice(db, {
    campaign_id: campaign.id,
    person_id: person.id,
    kind: template.kind,
    to_email: person.email,
    subject: template.subject,
    body: template.body,
    dedupe_key: template.dedupe_key,
  });
}

export const queuePledgeReceipt = (
  db: Db,
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): Promise<void> => queue(db, campaign, person, receipt(campaign, pledge, person));

export const queuePledgeCancelled = (
  db: Db,
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): Promise<void> => queue(db, campaign, person, cancelled(campaign, pledge, person));

export const queueFundedAndCharged = (
  db: Db,
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): Promise<void> => queue(db, campaign, person, fundedAndCharged(campaign, pledge, person));

export const queueNotFunded = (
  db: Db,
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): Promise<void> => queue(db, campaign, person, notFunded(campaign, pledge, person));

export const queueCampaignCancelled = (
  db: Db,
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): Promise<void> => queue(db, campaign, person, campaignCancelled(campaign, pledge, person));

export const queueFixPayment = (
  db: Db,
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
  sequence: number,
): Promise<void> => queue(db, campaign, person, fixPayment(campaign, pledge, person, sequence));

export const queueDropped = (
  db: Db,
  campaign: CampaignRow,
  pledge: PledgeRow,
  person: PersonRow,
): Promise<void> => queue(db, campaign, person, dropped(campaign, pledge, person));

export const queueSettlementReady = (
  db: Db,
  campaign: CampaignRow,
  creator: PersonRow,
  net: number,
): Promise<void> => queue(db, campaign, creator, settlementReady(campaign, creator, net));
