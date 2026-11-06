import { alreadyClaimedCopy, alreadyDecidedCopy, FIELD_COPY } from '../../shared/copy';
import { dateTimeLabel, toInstant } from '../../shared/businesstime';
import { config } from '../config';
import { query, queryOne } from '../db/pool';
import { ApiError, failure } from '../http/errors';
import { define, Registered, Role } from '../http/runtime';
import { codePoints, FieldCheck, readText } from '../http/validate';
import {
  CaseRow,
  ClaimRow,
  findClaim,
  findDecision,
  presentCase,
  remainingSeconds,
} from '../store/cases';
import { continueAfterReview, rejectInReview } from '../store/caseengine';
import { findCounterparty } from '../store/counterparties';

const REVIEW_READERS: readonly Role[] = ['compliance_officer', 'compliance_analyst', 'support_agent'];
const ANALYST: readonly Role[] = ['compliance_analyst'];

function claimBody(claim: ClaimRow, now: Date): Record<string, unknown> {
  return {
    memberId: claim.member_id,
    memberName: claim.member_name,
    claimedAt: toInstant(claim.claimed_at),
    endsAt: toInstant(claim.ends_at),
    remainingSeconds: remainingSeconds(claim.ends_at, now),
  };
}

/** A review case stays a review case after its decision moves it onto its path. */
async function loadReviewCase(workspaceSlug: string, caseId: string): Promise<CaseRow> {
  const row = await queryOne<CaseRow>(
    `SELECT * FROM cases WHERE workspace_slug = $1 AND id = $2
       AND (path = 'review' OR EXISTS (SELECT 1 FROM review_decisions d WHERE d.case_id = cases.id))`,
    [workspaceSlug, caseId],
  );
  if (row === null) throw failure('not_found');
  return row;
}

async function refuseIfDecided(row: CaseRow, timeZone: string, city: string): Promise<void> {
  const decision = await findDecision(row.id);
  if (decision === null) return;
  throw new ApiError(
    409,
    'already_decided',
    alreadyDecidedCopy(decision.decided_by_name, dateTimeLabel(decision.decided_at, timeZone, city)),
  );
}

export const reviewRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/review',
    roles: REVIEW_READERS,
    handler: async (context) => {
      const rows = await query<CaseRow>(
        `SELECT * FROM cases WHERE workspace_slug = $1 AND path = 'review' AND status = 'in_review'
         ORDER BY created_at, reference`,
        [context.workspace.slug],
      );
      const cases = await Promise.all(
        rows.map(async (row) => {
          const counterparty =
            row.counterparty_id === null
              ? null
              : await findCounterparty(context.workspace.slug, row.counterparty_id);
          const claim = await findClaim(row.id);
          return {
            id: row.id,
            reference: row.reference,
            counterparty:
              counterparty === null
                ? null
                : { id: counterparty.id, name: counterparty.legal_name },
            fiatValueCents: BigInt(row.fiat_value_cents),
            currency: row.currency,
            createdAt: toInstant(row.created_at),
            claim:
              claim === null || claim.ends_at.getTime() <= context.now.getTime()
                ? null
                : claimBody(claim, context.now),
          };
        }),
      );
      return { status: 200, json: { cases, now: toInstant(context.now) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/review/:caseId/claim',
    roles: ANALYST,
    content: 'json',
    load: (context) => loadReviewCase(context.workspace.slug, context.params.caseId),
    handler: async (context) => {
      const row = context.loaded;
      await refuseIfDecided(row, context.workspace.timeZone, context.workspace.city);
      const held = await findClaim(row.id);
      if (
        held !== null &&
        held.member_id === context.member.id &&
        held.ends_at.getTime() > context.now.getTime()
      ) {
        return { status: 200, json: { claim: claimBody(held, context.now) } };
      }
      const endsAt = new Date(context.now.getTime() + config().timers.reviewClaimSeconds * 1000);
      const won = await queryOne<ClaimRow>(
        `INSERT INTO review_claims (case_id, member_id, member_name, claimed_at, ends_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (case_id) DO UPDATE SET member_id = EXCLUDED.member_id,
           member_name = EXCLUDED.member_name, claimed_at = EXCLUDED.claimed_at,
           ends_at = EXCLUDED.ends_at
         WHERE review_claims.ends_at <= $4
         RETURNING *`,
        [row.id, context.member.id, context.member.name, context.now, endsAt],
      );
      if (won === null) {
        const holder = await findClaim(row.id);
        const name = holder === null ? '' : holder.member_name;
        const at =
          holder === null
            ? ''
            : dateTimeLabel(holder.claimed_at, context.workspace.timeZone, context.workspace.city);
        throw new ApiError(409, 'already_claimed', alreadyClaimedCopy(name, at));
      }
      return { status: 200, json: { claim: claimBody(won, context.now) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/review/:caseId/decision',
    roles: ANALYST,
    content: 'json',
    load: (context) => loadReviewCase(context.workspace.slug, context.params.caseId),
    handler: async (context) => {
      const row = context.loaded;
      await refuseIfDecided(row, context.workspace.timeZone, context.workspace.city);
      const claim = await findClaim(row.id);
      if (
        claim === null ||
        claim.member_id !== context.member.id ||
        claim.ends_at.getTime() <= context.now.getTime()
      ) {
        throw failure('claim_not_held');
      }
      const decision = readText(context.body, 'decision');
      const reason = readText(context.body, 'reason');
      const check = new FieldCheck();
      if (decision !== 'accept' && decision !== 'reject') {
        check.add('decision', 'Choose Accept or Reject.');
      }
      if (reason === null || codePoints(reason) < 1 || codePoints(reason) > 1000) {
        check.add('reason', FIELD_COPY.reason);
      }
      check.settle();
      await query(
        `INSERT INTO review_decisions (case_id, decision, reason, decided_by_id, decided_by_name, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.id, decision, reason, context.member.id, context.member.name, context.now],
      );
      const counterparty =
        row.counterparty_id === null
          ? null
          : await findCounterparty(context.workspace.slug, row.counterparty_id);
      const updated =
        decision === 'accept' && counterparty !== null
          ? await continueAfterReview(context.workspace, row, counterparty, context.now)
          : await rejectInReview(row, context.now);
      return {
        status: 200,
        json: { case: await presentCase(updated, context.member.role, context.now) },
      };
    },
  }),
];
