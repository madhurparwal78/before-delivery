import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { fail } from '../http/app-error.js';
import { FIELD_COPY } from '../../shared/errors.js';
import { reviewExpiryLine } from '../../shared/format.js';
import {
  MILESTONE_LABEL,
  type ReviewMilestone,
  type ReviewView,
} from '../../shared/domain.js';
import {
  countRevisionRounds,
  createReviewLink,
  findEngagement,
  findReviewLinkByHash,
  insertRevisionRound,
  listQuoteLines,
  listStills,
  lockEngagement,
  revokeReviewLinks,
  setEngagementPhase,
  type EngagementRow,
  type ReviewLinkRow,
} from '../db/engagements.js';
import { hashToken } from '../db/brands.js';
import { enqueue } from '../db/outbox.js';
import { transaction } from '../db/pool.js';
import {
  activeMilestone,
  regenerateAllowed,
  reviewerAcceptTransition,
  reviewerRevisionTransition,
  reviewerActionsOpen,
  sendForReviewMilestone,
  sendForReviewTransition,
} from '../domain/states.js';
import { findInvoiceByMilestone } from '../db/engagements.js';
import { draftMilestoneInvoice } from './billing.js';
import { servicesForRead } from './content.js';
import { reviewView } from '../serialise.js';

export const reviewLinkExpiry = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + config.reviewLinkTtlSeconds * 1000);

export type ResolvedLink = { link: ReviewLinkRow; engagement: EngagementRow; token: string };

/** Token validity is judged before idempotency, so a dead link always answers not-found. */
export const resolveReviewToken = async (token: string): Promise<ResolvedLink> => {
  const link = await findReviewLinkByHash(hashToken(token));
  if (link === null || link.revoked_at !== null) fail('not_found');
  const row = link as ReviewLinkRow;
  if (row.age_seconds > config.reviewLinkTtlSeconds) fail('not_found');
  const engagement = await findEngagement(row.engagement_id);
  if (engagement === null) fail('not_found');
  return { link: row, engagement: engagement as EngagementRow, token };
};

export const buildReviewView = async (resolved: ResolvedLink): Promise<ReviewView> => {
  const [stills, quoteLines, rounds, services] = await Promise.all([
    listStills(resolved.engagement.id),
    listQuoteLines(resolved.engagement.id),
    countRevisionRounds(resolved.engagement.id),
    servicesForRead(),
  ]);
  const phase = {
    state: resolved.engagement.state,
    finalsOut: resolved.engagement.finals_out,
    revisionMilestone: resolved.engagement.revision_milestone,
  };
  const milestone = resolved.link.milestone;
  return reviewView({
    engagement: resolved.engagement,
    milestone,
    roundsUsed: rounds[milestone],
    actionsOpen: reviewerActionsOpen(phase) && activeMilestone(phase) === milestone,
    stills,
    quoteLines,
    services,
    token: resolved.token,
  });
};

const newToken = (): string => randomBytes(32).toString('base64url');

export const publicOrigin = (fallbackOrigin: string): string =>
  config.publicUrl ?? fallbackOrigin;

export type ReviewLinkIssue = { reviewUrl: string; expiresAt: Date; milestone: ReviewMilestone };

const issueLink = async (
  engagement: EngagementRow,
  milestone: ReviewMilestone,
  origin: string,
): Promise<ReviewLinkIssue> => {
  const token = newToken();
  const createdAt = await createReviewLink(engagement.id, milestone, hashToken(token));
  const expiresAt = reviewLinkExpiry(createdAt);
  const reviewUrl = `${publicOrigin(origin)}/review/${token}`;
  await transaction(async (client) => {
    await enqueue(
      client,
      'review_link_email',
      {
        engagement_id: engagement.id,
        milestone,
        review_url: reviewUrl,
        expiry_line: reviewExpiryLine(expiresAt.toISOString()),
      },
      `review_link:${engagement.id}:${createdAt.toISOString()}`,
    );
  });
  return { reviewUrl, expiresAt, milestone };
};

export const sendForReview = async (
  engagementId: string,
  origin: string,
): Promise<ReviewLinkIssue> => {
  const prepared = await transaction(async (client) => {
    const locked = await lockEngagement(client, engagementId);
    if (locked === null) fail('not_found');
    const engagement = locked as EngagementRow;
    const phase = {
      state: engagement.state,
      finalsOut: engagement.finals_out,
      revisionMilestone: engagement.revision_milestone,
    };
    const transition = sendForReviewTransition(phase);
    if ('error' in transition) fail(transition.error);
    const milestone = sendForReviewMilestone(phase);
    if (milestone === null) fail('invalid_state');

    if (milestone === 'final_delivery') {
      const lookDev = await findInvoiceByMilestone(engagement.id, 'look_dev');
      if (lookDev === null || lookDev.status !== 'paid') fail('look_dev_unpaid');
    }

    const quoteLines = await listQuoteLines(engagement.id, client);
    const stills = await listStills(engagement.id);
    const covered = new Set(
      stills.filter((still) => still.milestone === milestone).map((still) => still.shot_code),
    );
    if (quoteLines.length === 0 || quoteLines.some((line) => !covered.has(line.shot_code)))
      fail('stills_missing');

    await setEngagementPhase(client, engagement.id, {
      state: (transition as { to: { state: EngagementRow['state'] } }).to.state,
      finalsOut: (transition as { to: { finalsOut: boolean } }).to.finalsOut,
      revisionMilestone: null,
    });
    return { engagement, milestone: milestone as ReviewMilestone };
  });
  return issueLink(prepared.engagement, prepared.milestone, origin);
};

export const regenerateReviewLink = async (
  engagementId: string,
  origin: string,
): Promise<ReviewLinkIssue> => {
  const engagement = await findEngagement(engagementId);
  if (engagement === null) fail('not_found');
  const row = engagement as EngagementRow;
  const phase = {
    state: row.state,
    finalsOut: row.finals_out,
    revisionMilestone: row.revision_milestone,
  };
  const allowed = regenerateAllowed(phase);
  if ('error' in allowed) fail(allowed.error);
  const milestone = activeMilestone(phase);
  if (milestone === null) fail('invalid_state');
  return issueLink(row, milestone, origin);
};

export const revokeReviewLink = async (engagementId: string): Promise<void> => {
  await revokeReviewLinks(engagementId);
};

export const reviewerAccept = async (resolved: ResolvedLink): Promise<ReviewView> => {
  const services = await servicesForRead();
  await transaction(async (client) => {
    const locked = await lockEngagement(client, resolved.engagement.id);
    if (locked === null) fail('not_found');
    const engagement = locked as EngagementRow;
    const phase = {
      state: engagement.state,
      finalsOut: engagement.finals_out,
      revisionMilestone: engagement.revision_milestone,
    };
    const transition = reviewerAcceptTransition(phase);
    if ('error' in transition) fail(transition.error);
    const next = (transition as { to: { state: EngagementRow['state']; finalsOut: boolean } }).to;
    const milestone: ReviewMilestone = phase.state === 'look_dev_review' ? 'look_dev' : 'final_delivery';
    const rounds = (await countRevisionRounds(engagement.id))[milestone];
    await draftMilestoneInvoice(client, engagement, milestone, services, rounds);
    await setEngagementPhase(client, engagement.id, {
      state: next.state,
      finalsOut: next.finalsOut,
      revisionMilestone: null,
    });
  });
  const engagement = await findEngagement(resolved.engagement.id);
  return buildReviewView({ ...resolved, engagement: engagement as EngagementRow });
};

export type RevisionOutcome = { review: ReviewView; round: number; change_order: boolean };

export const reviewerRevision = async (
  resolved: ResolvedLink,
  noteRaw: unknown,
): Promise<RevisionOutcome> => {
  const note = typeof noteRaw === 'string' ? noteRaw : '';
  const outcome = await transaction(async (client) => {
    const locked = await lockEngagement(client, resolved.engagement.id);
    if (locked === null) fail('not_found');
    const engagement = locked as EngagementRow;
    const phase = {
      state: engagement.state,
      finalsOut: engagement.finals_out,
      revisionMilestone: engagement.revision_milestone,
    };
    const transition = reviewerRevisionTransition(phase);
    if ('error' in transition) fail(transition.error);
    if (note.length < 1 || note.length > 2000) fail('validation_failed', { fields: { note: FIELD_COPY.note } });

    const next = (transition as {
      to: { state: EngagementRow['state']; finalsOut: boolean; revisionMilestone: ReviewMilestone | null };
    }).to;
    const milestone = next.revisionMilestone as ReviewMilestone;
    const round = await insertRevisionRound(client, engagement.id, milestone, note);
    await setEngagementPhase(client, engagement.id, {
      state: next.state,
      finalsOut: next.finalsOut,
      revisionMilestone: milestone,
    });
    await enqueue(
      client,
      'push',
      {
        title: 'Revision requested',
        message: `${engagement.reference} \u00b7 ${MILESTONE_LABEL[milestone]} round ${round}`,
      },
      `push:revision:${engagement.id}:${milestone}:${round}`,
    );
    return { round, changeOrder: round >= 3 };
  });

  const engagement = await findEngagement(resolved.engagement.id);
  return {
    review: await buildReviewView({ ...resolved, engagement: engagement as EngagementRow }),
    round: outcome.round,
    change_order: outcome.changeOrder,
  };
};
