import type { Outcome, PostKind } from '../../shared/reference';
import { config } from '../config';
import { db, transaction, type Db } from '../db/pool';
import { assertNoContactDetails, postedMonth } from '../domain/anonymity';
import { findPost, postLabel, type PostRow } from '../domain/posts';
import { COPY, FieldErrors, integerBetween, refs, textBetween } from '../domain/validate';
import { ApiError } from '../errors';
import type { Context } from '../http/context';
import type { Router } from '../http/router';
import { sendJson, sendNoContent } from '../http/respond';
import { HANDLED } from '../http/router';
import { uuid } from '../ids';
import { publish } from '../services/live';
import { flushSyncQuietly, queueSync } from '../services/sync';

interface ReviewFields {
  overall: number;
  work_life: number;
  pay: number;
  management: number;
  title: string;
  pros: string;
  cons: string;
}

interface PayFields {
  role_family: string;
  city: string;
  annual_pay: number;
  years_experience: number;
}

interface NoteFields {
  role_family: string;
  difficulty: number;
  outcome: Outcome;
  text: string;
}

function readReviewFields(body: Record<string, unknown>): ReviewFields {
  const errors = new FieldErrors();
  const overall = integerBetween(body['overall'], 1, 5);
  const workLife = integerBetween(body['work_life'], 1, 5);
  const pay = integerBetween(body['pay'], 1, 5);
  const management = integerBetween(body['management'], 1, 5);
  const title = textBetween(body['title'], 5, 120);
  const pros = textBetween(body['pros'], 20, 3000);
  const cons = textBetween(body['cons'], 20, 3000);
  if (overall === null) errors.add('overall', COPY.rating);
  if (workLife === null) errors.add('work_life', COPY.rating);
  if (pay === null) errors.add('pay', COPY.rating);
  if (management === null) errors.add('management', COPY.rating);
  if (title === null) errors.add('title', COPY.review_title);
  if (pros === null) errors.add('pros', COPY.long_text);
  if (cons === null) errors.add('cons', COPY.long_text);
  errors.throwIfAny();
  assertNoContactDetails([
    ['title', title as string],
    ['pros', pros as string],
    ['cons', cons as string],
  ]);
  return {
    overall: overall as number,
    work_life: workLife as number,
    pay: pay as number,
    management: management as number,
    title: title as string,
    pros: pros as string,
    cons: cons as string,
  };
}

function readPayFields(body: Record<string, unknown>): PayFields {
  const errors = new FieldErrors();
  const roleFamily = refs.isRoleFamilyId(body['role_family']) ? (body['role_family'] as string) : null;
  const city = refs.isCityId(body['city']) ? (body['city'] as string) : null;
  const annualPay = integerBetween(body['annual_pay'], 100000, 5000000);
  const years = integerBetween(body['years_experience'], 0, 40);
  if (!roleFamily) errors.add('role_family', COPY.role_family);
  if (!city) errors.add('city', COPY.city);
  if (annualPay === null) errors.add('annual_pay', COPY.pay);
  if (years === null) errors.add('years_experience', COPY.years_experience);
  errors.throwIfAny();
  return {
    role_family: roleFamily as string,
    city: city as string,
    annual_pay: annualPay as number,
    years_experience: years as number,
  };
}

function readNoteFields(body: Record<string, unknown>): NoteFields {
  const errors = new FieldErrors();
  const roleFamily = refs.isRoleFamilyId(body['role_family']) ? (body['role_family'] as string) : null;
  const difficulty = integerBetween(body['difficulty'], 1, 5);
  const outcome =
    body['outcome'] === 'offer' || body['outcome'] === 'no_offer' || body['outcome'] === 'no_reply'
      ? (body['outcome'] as Outcome)
      : null;
  const text = textBetween(body['text'], 20, 3000);
  if (!roleFamily) errors.add('role_family', COPY.role_family);
  if (difficulty === null) errors.add('difficulty', COPY.rating);
  if (!outcome) errors.add('outcome', COPY.outcome);
  if (text === null) errors.add('text', COPY.long_text);
  errors.throwIfAny();
  assertNoContactDetails([['text', text as string]]);
  return {
    role_family: roleFamily as string,
    difficulty: difficulty as number,
    outcome: outcome as Outcome,
    text: text as string,
  };
}

function createdBody(post: PostRow): unknown {
  return {
    id: post.id,
    kind: post.kind,
    state: post.state,
    label: postLabel(post),
    company_name: post.company_name,
    posted_month: postedMonth(post.created_at),
  };
}

function readKind(body: Record<string, unknown>): PostKind {
  const kind = body['kind'];
  if (kind === 'review' || kind === 'pay_report' || kind === 'interview_note') return kind;
  throw new ApiError('validation_failed', { fields: { kind: 'Choose a kind of post.' } });
}

async function requireOwnPost(id: string, authorId: string): Promise<PostRow> {
  const post = await findPost(id);
  if (!post || post.deleted_at || post.author_id !== authorId) throw new ApiError('not_found');
  return post;
}

function assertEditable(post: PostRow, now: Date): void {
  const elapsedMinutes = (now.getTime() - post.created_at.getTime()) / 60000;
  if (elapsedMinutes >= config.editWindowMinutes) throw new ApiError('edit_window_closed');
  if (post.state === 'claimed') throw new ApiError('in_review');
}

async function afterPublicChange(tx: Db, now: Date, post: PostRow): Promise<void> {
  await queueSync(tx, now, 'company', post.company_id, 'upsert');
  await publish(tx, now, 'company.changed', { slug: post.company_slug }, { all: true });
}

export function registerPostRoutes(router: Router): void {
  router.post('/api/posts', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const body = ctx.json();
    const now = await ctx.now();

    const companyIdRaw = typeof body['company_id'] === 'string' ? body['company_id'].trim() : '';
    if (companyIdRaw !== '') {
      const exists = await db.one<{ id: string }>('SELECT id FROM companies WHERE id = $1', [companyIdRaw]);
      if (!exists) throw new ApiError('not_found');
    }

    const kind = readKind(body);
    if (kind === 'review' && companyIdRaw !== '') {
      const since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const previous = await db.one<{ count: string }>(
        `SELECT count(*) AS count FROM posts
          WHERE kind = 'review' AND author_id = $1 AND company_id = $2 AND created_at > $3`,
        [member.id, companyIdRaw, since],
      );
      if (Number(previous?.count ?? 0) >= config.reviewsPerCompanyPerYear) throw new ApiError('duplicate_review');
    }

    if (companyIdRaw === '') throw new ApiError('validation_failed', { fields: { company_id: COPY.company_id } });

    const id = uuid();
    const created = await transaction(async (tx) => {
      if (kind === 'review') {
        const fields = readReviewFields(body);
        await tx.query(
          `INSERT INTO posts (id, kind, company_id, author_id, state, created_at, updated_at,
                              overall, work_life, pay, management, title, pros, cons)
           VALUES ($1, 'review', $2, $3, 'pending', $4, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            companyIdRaw,
            member.id,
            now,
            fields.overall,
            fields.work_life,
            fields.pay,
            fields.management,
            fields.title,
            fields.pros,
            fields.cons,
          ],
        );
      } else if (kind === 'pay_report') {
        const fields = readPayFields(body);
        await tx.query(
          `INSERT INTO posts (id, kind, company_id, author_id, state, created_at, updated_at,
                              role_family, city, annual_pay, years_experience)
           VALUES ($1, 'pay_report', $2, $3, 'pending', $4, $4, $5, $6, $7, $8)`,
          [
            id,
            companyIdRaw,
            member.id,
            now,
            fields.role_family,
            fields.city,
            fields.annual_pay,
            fields.years_experience,
          ],
        );
      } else {
        const fields = readNoteFields(body);
        await tx.query(
          `INSERT INTO posts (id, kind, company_id, author_id, state, created_at, updated_at,
                              role_family, difficulty, outcome, body_text)
           VALUES ($1, 'interview_note', $2, $3, 'pending', $4, $4, $5, $6, $7, $8)`,
          [id, companyIdRaw, member.id, now, fields.role_family, fields.difficulty, fields.outcome, fields.text],
        );
      }
      const stored = await findPost(id, tx);
      await publish(
        tx,
        now,
        'queue.changed',
        { post_id: id, state: 'pending', by_name: null },
        {
          roles: ['moderator', 'founder'],
        },
      );
      return stored as PostRow;
    });
    sendJson(ctx.res, 201, createdBody(created));
    return HANDLED;
  });

  router.get('/api/me/posts', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const now = await ctx.now();
    const rows = await db.query<PostRow>(
      `SELECT p.id, p.kind, p.company_id, c.name AS company_name, c.slug AS company_slug, p.author_id, p.state,
              p.created_at, p.deleted_at, p.claimed_by, p.claimed_at, p.lease_started_at, p.last_lapsed_by,
              p.decided_by, p.reason, p.overall, p.work_life, p.pay, p.management, p.title, p.pros, p.cons,
              p.role_family, p.city, p.annual_pay, p.years_experience, p.difficulty, p.outcome, p.body_text
         FROM posts p JOIN companies c ON c.id = p.company_id
        WHERE p.author_id = $1 AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC, p.id`,
      [member.id],
    );
    return {
      posts: rows.map((post) => ({
        id: post.id,
        kind: post.kind,
        label: postLabel(post),
        company_name: post.company_name,
        state: post.state,
        reason: post.reason,
        posted_month: postedMonth(post.created_at),
        editable:
          (post.state === 'pending' || post.state === 'approved') &&
          (now.getTime() - post.created_at.getTime()) / 60000 < config.editWindowMinutes,
      })),
    };
  });

  router.patch('/api/posts/:id', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const post = await requireOwnPost(ctx.param('id'), member.id);
    const now = await ctx.now();
    assertEditable(post, now);
    const body = ctx.json();

    const updated = await transaction(async (tx) => {
      if (post.kind === 'review') {
        const fields = readReviewFields(body);
        await tx.query(
          `UPDATE posts SET state = 'pending', updated_at = $2, decided_by = NULL, decided_at = NULL, reason = NULL,
                  overall = $3, work_life = $4, pay = $5, management = $6, title = $7, pros = $8, cons = $9
             WHERE id = $1`,
          [
            post.id,
            now,
            fields.overall,
            fields.work_life,
            fields.pay,
            fields.management,
            fields.title,
            fields.pros,
            fields.cons,
          ],
        );
      } else if (post.kind === 'pay_report') {
        const fields = readPayFields(body);
        await tx.query(
          `UPDATE posts SET state = 'pending', updated_at = $2, decided_by = NULL, decided_at = NULL, reason = NULL,
                  role_family = $3, city = $4, annual_pay = $5, years_experience = $6
             WHERE id = $1`,
          [post.id, now, fields.role_family, fields.city, fields.annual_pay, fields.years_experience],
        );
      } else {
        const fields = readNoteFields(body);
        await tx.query(
          `UPDATE posts SET state = 'pending', updated_at = $2, decided_by = NULL, decided_at = NULL, reason = NULL,
                  role_family = $3, difficulty = $4, outcome = $5, body_text = $6
             WHERE id = $1`,
          [post.id, now, fields.role_family, fields.difficulty, fields.outcome, fields.text],
        );
      }
      await publish(
        tx,
        now,
        'queue.changed',
        { post_id: post.id, state: 'pending', by_name: null },
        {
          roles: ['moderator', 'founder'],
        },
      );
      if (post.state === 'approved') await afterPublicChange(tx, now, post);
      return (await findPost(post.id, tx)) as PostRow;
    });
    if (post.state === 'approved') await flushSyncQuietly('company', post.company_id);
    return createdBody(updated);
  });

  router.delete('/api/posts/:id', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const post = await requireOwnPost(ctx.param('id'), member.id);
    if (post.state === 'claimed') throw new ApiError('in_review');
    const now = await ctx.now();
    await transaction(async (tx) => {
      await tx.query(`UPDATE posts SET deleted_at = $2, updated_at = $2 WHERE id = $1`, [post.id, now]);
      await publish(
        tx,
        now,
        'queue.changed',
        { post_id: post.id, state: 'deleted', by_name: null },
        {
          roles: ['moderator', 'founder'],
        },
      );
      await afterPublicChange(tx, now, post);
    });
    await flushSyncQuietly('company', post.company_id);
    sendNoContent(ctx.res);
    return HANDLED;
  });
}
