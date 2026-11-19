import { now } from '../clock.js';
import { copy } from '../copy.js';
import { ApiError, invalid, notFound } from '../errors.js';
import { withAudit } from '../audit.js';
import { sendTo } from '../events.js';
import { readBody, text } from '../fields.js';
import { quarterLabel } from '../officeTime.js';
import {
  loadReview,
  loadReviewLines,
  loadReviews,
  reviewProgress,
  type ReviewLineRow,
  type ReviewRow,
} from '../domain/reviews.js';
import { applyScopeLoss, announceReviewChange } from '../domain/scopeChanges.js';
import { loadPerson, scopeIds } from '../domain/people.js';
import { allVaults } from '../domain/visibility.js';
import { query } from '../db.js';
import type { Route } from '../http.js';

const DESK_STAFF = ['office_manager', 'managing_partner'] as const;

function reviewHead(review: ReviewRow): Record<string, unknown> {
  return {
    id: review.id,
    quarter: `Q${review.quarter} ${review.year}`,
    opened_on: review.opened_on,
    overdue_from: review.overdue_from,
    status: review.status,
    signed_off_by: review.signed_off_by,
  };
}

async function lineJson(line: ReviewLineRow): Promise<Record<string, unknown>> {
  const vendors = await query<{ name: string; formerly: string | null }>(
    `select distinct v.name, v.formerly from credentials c join vendors v on v.id = c.vendor_id
      where c.vault_id = $1 order by v.name asc`,
    [line.vault_id],
  );
  return {
    id: line.id,
    person_id: line.person_id,
    person_name: line.person_name,
    vault_id: line.vault_id,
    vault_name: line.vault_name,
    vault_formerly: line.vault_formerly,
    vendors,
    decision: line.decision,
    decided_by: line.decided_by,
    decided_via: line.decided_via,
  };
}

async function reviewBody(review: ReviewRow): Promise<Record<string, unknown>> {
  const lines = await loadReviewLines(review.id);
  const progress = reviewProgress(lines);
  return {
    ...reviewHead(review),
    decided: progress.decided,
    total: progress.total,
    lines: await Promise.all(lines.map(lineJson)),
  };
}

export const reviewRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/reviews',
    roles: DESK_STAFF,
    handler: async () => ({ status: 200, body: { reviews: (await loadReviews()).map(reviewHead) } }),
  },
  {
    method: 'GET',
    path: '/api/reviews/:id',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const review = await loadReview(ctx.params.id as string);
      if (review === null) throw notFound();
      return { status: 200, body: await reviewBody(review) };
    },
  },
  {
    method: 'POST',
    path: '/api/reviews/:id/lines/:lineId',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const review = await loadReview(ctx.params.id as string);
      if (review === null) throw notFound();
      const lines = await loadReviewLines(review.id);
      const line = lines.find((entry) => entry.id === ctx.params.lineId);
      if (line === undefined) throw notFound();
      if (review.status === 'signed_off') throw new ApiError(409, 'review_signed_off', copy.reviewSignedOff);
      if (line.decision !== 'undecided') throw new ApiError(409, 'line_decided', copy.lineDecided);
      const body = readBody(ctx.body, { decision: { kind: 'string' } });
      const decision = text(body, 'decision');
      if (decision !== 'keep' && decision !== 'remove') {
        throw invalid({ decision: 'Choose keep or remove.' });
      }

      const at = now();
      const person = await loadPerson(line.person_id);
      if (person === null) throw notFound();
      const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
      const decided = await withAudit(async (client, write) => {
        const updated = await client.query(
          `update review_lines set decision = $2, decided_by = $3, decided_via = 'review'
            where id = $1 and decision = 'undecided'`,
          [line.id, decision === 'keep' ? 'kept' : 'removed', ctx.caller.person.id],
        );
        if ((updated.rowCount ?? 0) === 0) return false;
        await write({
          actor,
          action: 'review_decision',
          subject: { kind: 'review_line', id: line.id, name: `${line.person_name} on ${line.vault_name}` },
          details: { decided_via: 'review', decision: decision === 'keep' ? 'kept' : 'removed' },
        });
        if (decision === 'remove') {
          await client.query('delete from person_vaults where person_id = $1 and vault_id = $2', [
            person.id,
            line.vault_id,
          ]);
          const vault = (await allVaults()).find((entry) => entry.id === line.vault_id);
          if (vault !== undefined) {
            await applyScopeLoss(client, write, {
              person,
              vaults: [vault],
              actor,
              confirmedBy: ctx.caller.person.full_name,
              at,
            });
          }
        }
        return true;
      });
      if (!decided) throw new ApiError(409, 'line_decided', copy.lineDecided);

      if (decision === 'remove') {
        sendTo([person.id], {
          name: 'access-changed',
          data: {
            vault_ids: await scopeIds(person.id),
            ended: [{ vault_id: line.vault_id, name: line.vault_name }],
            cause: 'change',
          },
        });
      }
      await announceReviewChange(review.id);
      const after = (await loadReviewLines(review.id)).find((entry) => entry.id === line.id);
      if (after === undefined) throw notFound();
      return { status: 200, body: await lineJson(after) };
    },
  },
  {
    method: 'POST',
    path: '/api/reviews/:id/sign-off',
    roles: ['managing_partner'],
    handler: async (ctx) => {
      const review = await loadReview(ctx.params.id as string);
      if (review === null) throw notFound();
      readBody(ctx.body, {});
      if (review.status === 'signed_off') throw new ApiError(409, 'review_signed_off', copy.reviewSignedOff);
      const lines = await loadReviewLines(review.id);
      if (lines.some((line) => line.decision === 'undecided')) {
        throw new ApiError(409, 'lines_undecided', copy.linesUndecided);
      }
      const at = now();
      await withAudit(async (client, write) => {
        await client.query(
          "update reviews set status = 'signed_off', signed_off_by = $2, signed_off_at = $3 where id = $1",
          [review.id, ctx.caller.person.id, at],
        );
        await write({
          actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
          action: 'review_sign_off',
          subject: { kind: 'review', id: review.id, name: quarterLabel(review.opened_on) },
          details: {},
        });
      });
      await announceReviewChange(review.id);
      const after = await loadReview(review.id);
      if (after === null) throw notFound();
      return { status: 200, body: await reviewBody(after) };
    },
  },
];
