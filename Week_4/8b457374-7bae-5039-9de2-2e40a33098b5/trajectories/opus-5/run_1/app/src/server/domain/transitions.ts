import type { CampaignStatus, PledgeState } from '../../shared/types.js';

/**
 * The one place every campaign and pledge state transition, and its rejection,
 * is decided.
 */

export type CampaignRejection = 'campaign_not_draft' | 'not_live' | 'campaign_closed';
export type PledgeRejection = 'pledge_not_active';

/** Editing a draft's fields, tiers and media, and launching it, need a draft. */
export function rejectUnlessDraft(status: CampaignStatus): CampaignRejection | null {
  return status === 'draft' ? null : 'campaign_not_draft';
}

/**
 * Creator cancellation: `not_live` for any status other than live, then
 * `campaign_closed` for a campaign still live from the deadline instant.
 */
export function rejectCreatorCancel(
  status: CampaignStatus,
  pastDeadline: boolean,
): CampaignRejection | null {
  if (status !== 'live') return 'not_live';
  if (pastDeadline) return 'campaign_closed';
  return null;
}

/** Pledging, quoting, changing and cancelling need a live campaign before its deadline. */
export function rejectUnlessPledgingOpen(
  status: CampaignStatus,
  pastDeadline: boolean,
): CampaignRejection | null {
  return status === 'live' && !pastDeadline ? null : 'campaign_closed';
}

/** Close-out decides funded or unfunded from the total against the goal. */
export function closeOutStatus(total: number, goal: number): 'funded' | 'unfunded' {
  return total >= goal ? 'funded' : 'unfunded';
}

/** A change or cancellation needs an authorised pledge. */
export function rejectUnlessPledgeActive(state: PledgeState): PledgeRejection | null {
  return state === 'authorised' ? null : 'pledge_not_active';
}

/** The states whose amount counts toward a campaign total and backer count. */
const COUNTING_STATES: readonly PledgeState[] = ['authorised', 'captured', 'errored'];

/** The states that hold a copy of a limited tier and block a second pledge. */
const CLAIMING_STATES: readonly PledgeState[] = [
  'authorising',
  'authorised',
  'captured',
  'errored',
];

const list = (states: readonly PledgeState[]): string =>
  states.map((state) => `'${state}'`).join(', ');

/** The same two sets, as SQL literal lists, so the rule lives in one place. */
export const COUNTING_STATES_SQL = list(COUNTING_STATES);
export const CLAIMING_STATES_SQL = list(CLAIMING_STATES);
