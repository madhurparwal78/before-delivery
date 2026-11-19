import { randomUUID } from 'node:crypto';
import { guideAccess, requireUser } from './access';
import { limits } from './config';
import { loadSnapshot, type GuideRecord } from './content';
import { decodeTimeCursor, encodeCursor } from './cursor';
import { one, pool, transaction, type Db } from './db';
import { conflict, forbidden, invalid, notFound, unconfirmed } from './errors';
import { isUuid } from './content';
import { requiredText, type Ctx } from './http';
import { emitGuide, emitUser } from './live';
import { enforceWindow, lockWindow, recordEvent } from './rate-limit';
import type { DashboardQuestion, Question } from '../shared/types';

interface QuestionRow {
  id: string; guide_id: string; step: number; text: string; asked_by: string; asked_at: Date; guide_title: string;
  answer_text: string | null; answered_by: string | null; answered_at: Date | null;
}

const questionSelect = `SELECT q.id, q.guide_id, q.step, q.text, a.name AS asked_by, q.asked_at, g.title AS guide_title,
  q.answer_text, r.name AS answered_by, q.answered_at
  FROM questions q JOIN users a ON a.id = q.asked_by JOIN guides g ON g.id = q.guide_id LEFT JOIN users r ON r.id = q.answered_by`;

function toQuestion(row: QuestionRow): DashboardQuestion {
  return {
    id: row.id, guide_id: row.guide_id, step: row.step, text: row.text, asked_by: row.asked_by, asked_at: row.asked_at.toISOString(),
    guide_title: row.guide_title,
    answer: row.answer_text === null ? null : { text: row.answer_text, answered_by: row.answered_by ?? '', answered_at: row.answered_at!.toISOString() },
  };
}

function plain(question: DashboardQuestion): Question {
  const { guide_title: _title, ...rest } = question;
  return rest;
}

export async function questionPage(db: Db, where: string, params: unknown[], cursor: string | null, size: number): Promise<{ items: DashboardQuestion[]; next: string | null }> {
  const after = decodeTimeCursor(cursor);
  const rows = await db.query<QuestionRow>(
    `${questionSelect} WHERE ${where} AND ($${params.length + 1}::timestamptz IS NULL OR (q.asked_at, q.id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::uuid))
      ORDER BY q.asked_at DESC, q.id DESC LIMIT $${params.length + 3}`,
    [...params, after?.t ?? null, after?.id ?? null, size + 1],
  );
  const page = rows.rows.slice(0, size).map(toQuestion);
  const last = rows.rows[size - 1];
  return { items: page, next: rows.rows.length > size && last ? encodeCursor({ t: last.asked_at.toISOString(), id: last.id }) : null };
}

export function pageSize(ctx: Ctx): number {
  const asked = Number(ctx.url.searchParams.get('limit'));
  return Math.min(limits.page_size_max, Number.isInteger(asked) && asked > 0 ? asked : limits.page_size_default);
}

export async function listQuestions(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!);
  const { items, next } = await questionPage(pool, 'q.guide_id = $1', [guide.id], ctx.url.searchParams.get('cursor'), pageSize(ctx));
  return { items: items.map(plain), next_cursor: next };
}

async function teamIds(db: Db, guide: GuideRecord): Promise<string[]> {
  const rows = await db.query<{ user_id: string }>('SELECT user_id FROM coauthors WHERE guide_id = $1', [guide.id]);
  return [guide.ownerId, ...rows.rows.map((r) => r.user_id)];
}

export async function askQuestion(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, confirmed: true });
  const user = ctx.user!;
  const body = await ctx.json();
  const published = guide.publishedVersion === null ? null : await loadSnapshot(pool, guide.id, guide.publishedVersion);
  if (!published) throw notFound();
  const step = body.step;
  if (!Number.isInteger(step) || (step as number) < 1 || (step as number) > published.content.steps.length) throw invalid('step');
  const text = requiredText(body, 'text', limits.question_text_max);
  const question = await transaction(async (db) => {
    await lockWindow(db, 'question', user.id);
    await enforceWindow(db, 'question', user.id, limits.question_limit, limits.question_window_seconds);
    const id = randomUUID();
    await db.query('INSERT INTO questions (id, guide_id, step, text, asked_by) VALUES ($1, $2, $3, $4, $5)', [id, guide.id, step, text, user.id]);
    await recordEvent(db, 'question', user.id);
    return toQuestion((await one<QuestionRow>(db, `${questionSelect} WHERE q.id = $1`, [id]))!);
  });
  emitGuide(guide.id, { type: 'question', question: plain(question) });
  for (const id of await teamIds(pool, guide)) emitUser(id, { type: 'alert_question', guide_title: guide.title, step: question.step });
  return plain(question);
}

export async function answerQuestion(ctx: Ctx): Promise<unknown> {
  const user = requireUser(ctx);
  const id = ctx.params.id!;
  const found = isUuid(id) ? await one<{ guide_id: string }>(pool, 'SELECT guide_id FROM questions WHERE id = $1', [id]) : undefined;
  if (!found) throw notFound();
  const { guide, role } = await guideAccess(ctx, found.guide_id, { session: true });
  if (role === 'none') throw forbidden();
  if (!user.confirmed) throw unconfirmed();
  const text = requiredText(await ctx.json(), 'text', limits.answer_text_max);
  const answered = await one<{ asked_by: string }>(
    pool,
    'UPDATE questions SET answer_text = $1, answered_by = $2, answered_at = now() WHERE id = $3 AND answer_text IS NULL RETURNING asked_by',
    [text, user.id, id],
  );
  if (!answered) throw conflict('already_answered');
  const question = toQuestion((await one<QuestionRow>(pool, `${questionSelect} WHERE q.id = $1`, [id]))!);
  emitGuide(guide.id, { type: 'answer', question: plain(question) });
  emitUser(answered.asked_by, { type: 'alert_answer', author_name: user.name, step: question.step });
  return plain(question);
}
