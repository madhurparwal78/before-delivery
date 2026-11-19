import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { execute, query, queryOne } from '../db/index.js';
import { conflict, invalid, notFound, tooLong } from '../http/errors.js';
import { codePointLength } from '../../shared/limits.js';
import type { Question, Visibility } from '../../shared/types.js';
import { uniqueSlug } from './guides.js';

interface QuestionRow extends Record<string, unknown> {
  id: string;
  guide_id: string;
  step: number;
  text: string;
  asked_by: string;
  asked_by_id: string;
  asked_at: Date;
  answer_text: string | null;
  answered_by: string | null;
  answered_at: Date | null;
}

const QUESTION_SELECT = `SELECT q.id, q.guide_id, q.step, q.text, a.name AS asked_by,
    q.asked_by AS asked_by_id, q.asked_at, q.answer_text, b.name AS answered_by, q.answered_at
  FROM questions q
  JOIN users a ON a.id = q.asked_by
  LEFT JOIN users b ON b.id = q.answered_by`;

export const questionFromRow = (row: QuestionRow): Question => ({
  id: row.id,
  guide_id: row.guide_id,
  step: row.step,
  text: row.text,
  asked_by: row.asked_by,
  asked_at: row.asked_at.toISOString(),
  answer:
    row.answer_text === null
      ? null
      : {
          text: row.answer_text,
          answered_by: row.answered_by ?? '',
          answered_at: (row.answered_at ?? row.asked_at).toISOString(),
        },
});

export interface QuestionPage {
  items: Question[];
  next_cursor: string | null;
}

interface QuestionCursor {
  askedAt: string;
  id: string;
}

function encodeQuestionCursor(cursor: QuestionCursor): string {
  return Buffer.from(`${cursor.askedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

function decodeQuestionCursor(raw: string | null): QuestionCursor | null {
  if (raw === null) return null;
  const [askedAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!askedAt || !id) return null;
  return { askedAt, id };
}

async function pageQuestions(
  where: string,
  params: readonly unknown[],
  cursor: string | null,
  limit: number,
): Promise<QuestionPage> {
  const decoded = decodeQuestionCursor(cursor);
  const all = [...params];
  let keyset = '';
  if (decoded !== null) {
    all.push(decoded.askedAt, decoded.id);
    keyset = ` AND (q.asked_at, q.id) < ($${all.length - 1}::timestamptz, $${all.length}::uuid)`;
  }
  all.push(limit + 1);
  const rows = await query<QuestionRow>(
    `${QUESTION_SELECT} WHERE ${where}${keyset} ORDER BY q.asked_at DESC, q.id DESC LIMIT $${all.length}`,
    all,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(questionFromRow),
    next_cursor:
      rows.length > limit && last
        ? encodeQuestionCursor({ askedAt: last.asked_at.toISOString(), id: last.id })
        : null,
  };
}

export async function questionsForGuide(
  guideId: string,
  cursor: string | null,
  limit: number,
): Promise<QuestionPage> {
  return await pageQuestions('q.guide_id = $1', [guideId], cursor, limit);
}

/** Questions waiting on the guides the signed-in person authors. */
export async function questionsForAuthor(
  userId: string,
  cursor: string | null,
  limit: number,
): Promise<QuestionPage> {
  return await pageQuestions(
    `q.guide_id IN (
       SELECT id FROM guides WHERE owner_id = $1
       UNION SELECT guide_id FROM guide_coauthors WHERE user_id = $1)`,
    [userId],
    cursor,
    limit,
  );
}

export async function askQuestion(
  guideId: string,
  step: number,
  text: string,
  askedBy: string,
  stepCount: number,
): Promise<Question> {
  if (!Number.isInteger(step) || step < 1 || step > stepCount) throw invalid('step');
  if (text.trim().length === 0) throw invalid('text');
  if (codePointLength(text) > config.limits.question_text_max) {
    throw tooLong('text', config.limits.question_text_max);
  }
  const id = randomUUID();
  await execute(
    'INSERT INTO questions (id, guide_id, step, text, asked_by) VALUES ($1, $2, $3, $4, $5)',
    [id, guideId, step, text, askedBy],
  );
  const row = await queryOne<QuestionRow>(`${QUESTION_SELECT} WHERE q.id = $1`, [id]);
  if (!row) throw notFound();
  return questionFromRow(row);
}

export async function loadQuestion(id: string): Promise<Question & { guide_id: string } | null> {
  const row = await queryOne<QuestionRow>(`${QUESTION_SELECT} WHERE q.id = $1`, [id]);
  return row ? questionFromRow(row) : null;
}

export async function answerQuestion(
  id: string,
  text: string,
  answeredBy: string,
): Promise<Question> {
  if (text.trim().length === 0) throw invalid('text');
  if (codePointLength(text) > config.limits.answer_text_max) {
    throw tooLong('text', config.limits.answer_text_max);
  }
  const updated = await execute(
    `UPDATE questions SET answer_text = $2, answered_by = $3, answered_at = now()
     WHERE id = $1 AND answer_text IS NULL`,
    [id, text, answeredBy],
  );
  if (updated === 0) throw conflict({ error: 'already_answered' });
  const row = await queryOne<QuestionRow>(`${QUESTION_SELECT} WHERE q.id = $1`, [id]);
  if (!row) throw notFound();
  return questionFromRow(row);
}

export async function askerOf(questionId: string): Promise<string | null> {
  const row = await queryOne<{ asked_by: string }>(
    'SELECT asked_by FROM questions WHERE id = $1',
    [questionId],
  );
  return row?.asked_by ?? null;
}

export interface CollectionRecord {
  id: string;
  slug: string;
  title: string;
  visibility: Visibility;
  owner_id: string;
  owner_name: string;
  items: { guide_id: string; title: string; slug: string; position: number }[];
}

export async function createCollection(
  ownerId: string,
  title: string,
  visibility: Visibility,
): Promise<{ id: string; slug: string; title: string }> {
  if (codePointLength(title) > config.limits.guide_title_max) {
    throw tooLong('title', config.limits.guide_title_max);
  }
  const id = randomUUID();
  const slug = await uniqueCollectionSlug(title);
  await execute(
    'INSERT INTO collections (id, slug, owner_id, title, visibility) VALUES ($1, $2, $3, $4, $5)',
    [id, slug, ownerId, title, visibility],
  );
  return { id, slug, title };
}

async function uniqueCollectionSlug(title: string): Promise<string> {
  const base = await uniqueSlug(title);
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await queryOne<{ id: string }>('SELECT id FROM collections WHERE slug = $1', [
      candidate,
    ]);
    if (taken === null) return candidate;
  }
}

/**
 * A guide that stops being visible to the viewer is left out of the list
 * without disturbing the order.
 */
export async function loadCollection(
  idOrSlug: string,
  viewerId: string | null,
): Promise<CollectionRecord | null> {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const head = await queryOne<{
    id: string;
    slug: string;
    title: string;
    visibility: Visibility;
    owner_id: string;
    owner_name: string;
  }>(
    `SELECT c.id, c.slug, c.title, c.visibility, c.owner_id, u.name AS owner_name
     FROM collections c JOIN users u ON u.id = c.owner_id
     WHERE ${byId ? 'c.id = $1' : 'c.slug = $1'}`,
    [idOrSlug],
  );
  if (!head) return null;
  if (head.visibility === 'private' && head.owner_id !== viewerId) return null;
  const items = await query<{ guide_id: string; title: string; slug: string; position: number }>(
    `SELECT i.guide_id, g.title, g.slug, i.position
     FROM collection_items i JOIN guides g ON g.id = i.guide_id
     WHERE i.collection_id = $1
       AND (g.owner_id = $2 OR (g.visibility = 'public' AND g.state <> 'draft'))
     ORDER BY i.position`,
    [head.id, viewerId],
  );
  return { ...head, items };
}

export async function addToCollection(collectionId: string, guideId: string): Promise<number> {
  const existing = await queryOne<{ position: number }>(
    'SELECT position FROM collection_items WHERE collection_id = $1 AND guide_id = $2',
    [collectionId, guideId],
  );
  if (existing !== null) throw conflict({ error: 'already_in_collection' });
  const row = await queryOne<{ next: string }>(
    'SELECT (coalesce(max(position), 0) + 1)::text AS next FROM collection_items WHERE collection_id = $1',
    [collectionId],
  );
  const position = Number(row?.next ?? '1');
  await execute(
    'INSERT INTO collection_items (collection_id, guide_id, position) VALUES ($1, $2, $3)',
    [collectionId, guideId, position],
  );
  return position;
}

export async function moveInCollection(
  collectionId: string,
  guideId: string,
  position: number,
): Promise<string[]> {
  const rows = await query<{ guide_id: string }>(
    'SELECT guide_id FROM collection_items WHERE collection_id = $1 ORDER BY position',
    [collectionId],
  );
  const order = rows.map((row) => row.guide_id);
  const index = order.indexOf(guideId);
  if (index < 0) throw notFound();
  if (!Number.isInteger(position) || position < 1 || position > order.length) {
    throw invalid('position');
  }
  const [moved] = order.splice(index, 1);
  if (moved === undefined) throw notFound();
  order.splice(position - 1, 0, moved);
  for (let i = 0; i < order.length; i += 1) {
    await execute(
      'UPDATE collection_items SET position = $3 WHERE collection_id = $1 AND guide_id = $2',
      [collectionId, order[i], i + 1],
    );
  }
  return order;
}

export interface GuideListRow extends Record<string, unknown> {
  id: string;
  slug: string;
  title: string;
  state: string;
}

export interface Dashboard {
  drafts: GuideListRow[];
  published: GuideListRow[];
  forks: GuideListRow[];
  collections: { id: string; slug: string; title: string; state: string }[];
  questions: Question[];
  questions_next_cursor: string | null;
}

export async function loadDashboard(userId: string): Promise<Dashboard> {
  const [drafts, published, forks, collections, questions] = await Promise.all([
    query<GuideListRow>(
      `SELECT id, slug, title, state FROM guides
       WHERE owner_id = $1 AND state = 'draft' AND forked_from_guide_id IS NULL
       ORDER BY created_at DESC LIMIT $2`,
      [userId, config.limits.page_size_default],
    ),
    query<GuideListRow>(
      `SELECT id, slug, title, state FROM guides
       WHERE owner_id = $1 AND state IN ('published', 'withdrawn')
       ORDER BY created_at DESC LIMIT $2`,
      [userId, config.limits.page_size_default],
    ),
    query<GuideListRow>(
      `SELECT id, slug, title, state FROM guides
       WHERE owner_id = $1 AND forked_from_guide_id IS NOT NULL
       ORDER BY created_at DESC LIMIT $2`,
      [userId, config.limits.page_size_default],
    ),
    query<{ id: string; slug: string; title: string; state: string }>(
      `SELECT id, slug, title, visibility AS state FROM collections
       WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, config.limits.page_size_default],
    ),
    questionsForAuthor(userId, null, config.limits.page_size_default),
  ]);
  return {
    drafts,
    published,
    forks,
    collections,
    questions: questions.items,
    questions_next_cursor: questions.next_cursor,
  };
}
