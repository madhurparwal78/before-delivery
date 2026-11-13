// Reviews: two steps in order, each due PLOT_REVIEW_TTL_MS after it opens on the server clock. The state machine is in shared/rules.
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { decideStep, expireReview, MINIMUM_ROLE, pendingStep, REVIEW_STEP_ROLES, startReview, stepMinimumRole, type Review, type ReviewedVersion } from '../shared/rules.ts';
import type { ReviewStep, ReviewStepRole } from '../shared/types.ts';
import { accessTo, drawingOf } from './access.ts';
import { requireUser } from './auth.ts';
import { objectBody, stringField } from './body.ts';
import { clock } from './clock.ts';
import { config } from './config.ts';
import { db, type Queryable } from './db.ts';
import { hub } from './live.ts';
import { registerStartStep } from './registry.ts';
import { requireRole } from './roles.ts';
import { route } from './router.ts';
import { scheduler } from './scheduler.ts';
import { summaryOf, type VersionRow } from './versions.ts';

/** The time a review step opened now falls due, on the server clock. */
export const reviewDueAt = (): string => new Date(clock.now() + config.reviewTtlMs).toISOString();

async function lockVersion(q: Queryable, versionId: string): Promise<VersionRow> {
  return (await q.query<VersionRow>('SELECT * FROM versions WHERE id = $1 FOR UPDATE', [versionId]))[0];
}

/** A voided version knows the number of the version that replaced it (publishing always records it). */
async function reviewedVersion(q: Queryable, row: VersionRow): Promise<ReviewedVersion> {
  if (row.state !== 'voided') return { state: row.state };
  const [replacing] = await q.query<{ number: number }>('SELECT number FROM versions WHERE id = $1', [row.replaced_by]);
  return { state: 'voided', replacedByNumber: replacing.number };
}

async function saveReview(q: Queryable, row: VersionRow, review: Review, stamp?: { text: string; comment: string }): Promise<VersionRow> {
  const stamps = stamp === undefined ? row.stamps : [...row.stamps, stamp];
  await q.query('UPDATE versions SET state = $2, steps = $3, stamps = $4 WHERE id = $1', [row.id, review.state, JSON.stringify(review.steps), JSON.stringify(stamps)]);
  return { ...row, state: review.state, steps: review.steps, stamps };
}

/** Tells everyone viewing the drawing how the version's review stands, with the sentence that explains a change if there is one. */
async function announceReview(row: VersionRow, message: string | null): Promise<void> {
  hub.broadcast(await drawingOf('version', row.id), {
    type: 'review',
    data: { version_id: row.id, sheet_id: row.sheet_id, state: row.state, steps: row.steps, stamps: summaryOf(row).stamps, message },
  });
}

async function expire(versionId: string, role: ReviewStepRole, due: string): Promise<void> {
  const expired = await db.tx(async (q) => {
    const row = await lockVersion(q, versionId);
    const pending = pendingStep(row.steps);
    if (row.state !== 'in_review' || pending?.role !== role || pending.due_at !== due) return null;
    return saveReview(q, row, expireReview(row.steps));
  });
  if (expired) await announceReview(expired, copy.REVIEW_EXPIRED);
}

/** Makes the server clock end the pending step when it passes its due time. */
export function watchPendingStep(versionId: string, steps: readonly ReviewStep[]): void {
  const pending = pendingStep(steps);
  if (!pending || pending.due_at === null) return;
  const { role } = pending;
  const due = pending.due_at;
  scheduler.schedule(Date.parse(due), () => expire(versionId, role, due));
}

registerStartStep(async () => {
  for (const row of await db.query<Pick<VersionRow, 'id' | 'steps'>>("SELECT id, steps FROM versions WHERE state = 'in_review'")) watchPendingStep(row.id, row.steps);
});

route('POST', '/api/versions/:id/review', async (ctx) => {
  await accessTo(ctx, 'version', ctx.params.id, MINIMUM_ROLE.startReview);
  const started = await db.tx(async (q) => {
    const row = await lockVersion(q, ctx.params.id);
    return saveReview(q, row, startReview(row.state, reviewDueAt()));
  });
  watchPendingStep(started.id, started.steps);
  await announceReview(started, null);
  return ctx.reply(201, { ...summaryOf(started), sheet_id: started.sheet_id });
});

for (const verdict of ['approve', 'reject'] as const) {
  route('POST', `/api/versions/:id/review/:step/${verdict}`, async (ctx) => {
    const { role } = await accessTo(ctx, 'version', ctx.params.id);
    const target = REVIEW_STEP_ROLES.find((candidate) => candidate === ctx.params.step);
    if (!target) throw new ApiError('not_found', copy.NOT_FOUND);
    requireRole(role, stepMinimumRole(target));
    const comment = stringField(objectBody(ctx.json()), 'comment');
    const username = requireUser(ctx).username;
    const approved = verdict === 'approve';
    const decided = await db.tx(async (q) => {
      const row = await lockVersion(q, ctx.params.id);
      const review = decideStep(await reviewedVersion(q, row), row.steps, target, approved ? 'approved' : 'rejected', reviewDueAt());
      const text = copy.stamp(approved ? 'Approved' : 'Rejected', username, copy.utcMinute(clock.now()));
      return saveReview(q, row, review, { text, comment });
    });
    watchPendingStep(decided.id, decided.steps);
    await announceReview(decided, null);
    return ctx.reply(200, { ...summaryOf(decided), sheet_id: decided.sheet_id });
  });
}
