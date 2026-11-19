import type { Queryable } from '../../../db/pool.js';
import { bodyMarkerIds } from '../../../domain/bodytext.js';
import {
  SCORE_PATTERN,
  isValidClaimId,
  isValidStatedDelta,
  type Claim,
} from '../../../domain/claims.js';
import { findComparator } from '../../../domain/comparators.js';
import { NEWS_SUBJECTS, type ContentKind, type ContentRow } from '../../../domain/content.js';
import { isRealDateString } from '../../../domain/london.js';
import { errors } from '../../errors.js';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CONTENT_FIELD_MESSAGES = {
  kind: 'Choose model or news.',
  slug: 'Use lowercase letters, numbers and single hyphens, up to 80 characters.',
  slugTaken: 'That slug is already in use.',
  title: 'Enter a title.',
  summary: 'Enter a summary.',
  bodyEmpty: 'Enter a body.',
  bodyMarkers: 'Claim markers belong on model routes.',
  claims:
    'Each claim needs an id, text, benchmark, evaluation date, comparator and stated difference.',
  linked: 'No news post has that slug.',
  subject: 'Choose research, safety, policy or company.',
  tags: 'Give each tag as lowercase letters, numbers and single hyphens.',
} as const;

export type CommentRow = {
  id: string;
  content_id: string;
  author: string;
  body: string;
  created_at: Date;
};

export function contentObject(
  row: ContentRow,
  comments: readonly CommentRow[],
): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    subject: row.kind === 'news' ? row.subject : null,
    tags: row.kind === 'news' ? (row.tags ?? []) : null,
    claims: row.kind === 'model' ? (row.claims ?? []) : null,
    linked_news_slug: row.kind === 'model' ? row.linked_news_slug : null,
    status: row.status,
    version: row.version,
    author: row.author,
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.author,
      body: comment.body,
      created_at: comment.created_at.toISOString(),
    })),
    release_at: row.release_at === null ? null : row.release_at.toISOString(),
    release_at_local: row.release_at_local,
    published_at: row.published_at === null ? null : row.published_at.toISOString(),
    read_time_minutes: row.read_time_minutes,
  };
}

export async function loadComments(
  tx: Queryable,
  contentIds: readonly string[],
): Promise<Map<string, CommentRow[]>> {
  if (contentIds.length === 0) return new Map();
  const result = await tx.query<CommentRow>(
    `SELECT id, content_id, author, body, created_at FROM content_comments
      WHERE content_id = ANY($1::text[]) ORDER BY created_at, id`,
    [contentIds],
  );
  const grouped = new Map<string, CommentRow[]>();
  for (const comment of result.rows) {
    const list = grouped.get(comment.content_id) ?? [];
    list.push(comment);
    grouped.set(comment.content_id, list);
  }
  return grouped;
}

export type ContentFields = {
  readonly slug?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly body?: string;
  readonly subject?: string;
  readonly tags?: string[];
  readonly claims?: Claim[];
  readonly linked_news_slug?: string | null;
};

function readClaims(value: unknown): Claim[] {
  if (!Array.isArray(value)) throw errors.validationFailed({ claims: CONTENT_FIELD_MESSAGES.claims });
  const claims: Claim[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw errors.validationFailed({ claims: CONTENT_FIELD_MESSAGES.claims });
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    const benchmark = typeof candidate.benchmark === 'string' ? candidate.benchmark.trim() : '';
    const evalDate = typeof candidate.eval_date === 'string' ? candidate.eval_date.trim() : '';
    const comparator = typeof candidate.comparator === 'string' ? candidate.comparator.trim() : '';
    const statedDelta =
      typeof candidate.stated_delta === 'string' ? candidate.stated_delta.trim() : '';
    const extra = Object.keys(candidate).filter(
      (key) =>
        !['id', 'text', 'benchmark', 'eval_date', 'comparator', 'stated_delta'].includes(key),
    );
    if (
      extra.length > 0 ||
      !isValidClaimId(id) ||
      text === '' ||
      benchmark === '' ||
      !isRealDateString(evalDate) ||
      comparator === '' ||
      !isValidStatedDelta(statedDelta)
    ) {
      throw errors.validationFailed({ claims: CONTENT_FIELD_MESSAGES.claims });
    }
    claims.push({
      id,
      text,
      benchmark,
      eval_date: evalDate,
      comparator,
      stated_delta: statedDelta,
    });
  }
  const ids = new Set(claims.map((claim) => claim.id));
  if (ids.size !== claims.length) {
    throw errors.validationFailed({ claims: CONTENT_FIELD_MESSAGES.claims });
  }
  return claims;
}

/** Reads and checks the editable content fields present in a request body. */
export async function readContentFields(
  tx: Queryable,
  kind: ContentKind,
  payload: Record<string, unknown>,
  context: { readonly id: string | null },
): Promise<ContentFields> {
  const fields: Record<string, string> = {};
  const parsed: Record<string, unknown> = {};

  if ('slug' in payload) {
    const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
    if (!SLUG_PATTERN.test(slug) || [...slug].length > 80) {
      fields.slug = CONTENT_FIELD_MESSAGES.slug;
    } else {
      const clash = await tx.query(
        `SELECT 1 FROM content_items WHERE kind = $1 AND slug = $2
          AND ($3::text IS NULL OR id <> $3::text)`,
        [kind, slug, context.id],
      );
      if ((clash.rowCount ?? 0) > 0) fields.slug = CONTENT_FIELD_MESSAGES.slugTaken;
      else parsed.slug = slug;
    }
  }

  if ('title' in payload) {
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (title === '' || [...title].length > 200) fields.title = CONTENT_FIELD_MESSAGES.title;
    else parsed.title = title;
  }

  if ('summary' in payload) {
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    if (summary === '' || [...summary].length > 500) {
      fields.summary = CONTENT_FIELD_MESSAGES.summary;
    } else {
      parsed.summary = summary;
    }
  }

  if ('body' in payload) {
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (body === '') fields.body = CONTENT_FIELD_MESSAGES.bodyEmpty;
    else if (kind === 'news' && bodyMarkerIds(body).length > 0) {
      fields.body = CONTENT_FIELD_MESSAGES.bodyMarkers;
    } else {
      parsed.body = body;
    }
  }

  if ('subject' in payload) {
    const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
    if (!NEWS_SUBJECTS.some((entry) => entry.value === subject)) {
      fields.subject = CONTENT_FIELD_MESSAGES.subject;
    } else {
      parsed.subject = subject;
    }
  }

  if ('tags' in payload) {
    const raw = payload.tags;
    if (
      !Array.isArray(raw) ||
      raw.some((tag) => typeof tag !== 'string' || !SLUG_PATTERN.test(tag.trim()))
    ) {
      fields.tags = CONTENT_FIELD_MESSAGES.tags;
    } else {
      parsed.tags = raw.map((tag) => (tag as string).trim());
    }
  }

  if ('claims' in payload) {
    parsed.claims = readClaims(payload.claims);
  }

  if ('linked_news_slug' in payload) {
    const raw = payload.linked_news_slug;
    if (raw === null) {
      parsed.linked_news_slug = null;
    } else {
      const slug = typeof raw === 'string' ? raw.trim() : '';
      const post = await tx.query('SELECT 1 FROM content_items WHERE kind = $1 AND slug = $2', [
        'news',
        slug,
      ]);
      if ((post.rowCount ?? 0) === 0) fields.linked_news_slug = CONTENT_FIELD_MESSAGES.linked;
      else parsed.linked_news_slug = slug;
    }
  }

  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
  return parsed as ContentFields;
}

export function checkBenchmarkRowInput(payload: Record<string, unknown>): {
  readonly subject: string;
  readonly benchmark: string;
  readonly eval_date: string;
  readonly score: string;
  readonly source_note: string;
} {
  const fields: Record<string, string> = {};
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const benchmark = typeof payload.benchmark === 'string' ? payload.benchmark.trim() : '';
  const evalDate = typeof payload.eval_date === 'string' ? payload.eval_date.trim() : '';
  const score = typeof payload.score === 'string' ? payload.score.trim() : '';
  const sourceNote = typeof payload.source_note === 'string' ? payload.source_note.trim() : '';

  if (subject === '') fields.subject = 'Choose a model route or a recorded comparator.';
  if (benchmark === '' || [...benchmark].length > 120) {
    fields.benchmark = 'Enter a benchmark name of at most 120 characters.';
  }
  if (!isRealDateString(evalDate)) {
    fields.eval_date = 'Use a real date in the form YYYY-MM-DD.';
  }
  if (!SCORE_PATTERN.test(score)) {
    fields.score = 'Enter a score from 0 to 100 with at most two decimals.';
  }
  if (sourceNote === '' || [...sourceNote].length > 2000) {
    fields.source_note = 'Enter a source note of at most 2,000 characters.';
  }
  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
  return {
    subject,
    benchmark,
    eval_date: evalDate,
    score,
    source_note: sourceNote,
  };
}

export async function knownRowSubject(tx: Queryable, subject: string): Promise<boolean> {
  if (findComparator(subject) !== undefined) return true;
  const result = await tx.query('SELECT 1 FROM content_items WHERE kind = $1 AND slug = $2', [
    'model',
    subject,
  ]);
  return (result.rowCount ?? 0) > 0;
}
