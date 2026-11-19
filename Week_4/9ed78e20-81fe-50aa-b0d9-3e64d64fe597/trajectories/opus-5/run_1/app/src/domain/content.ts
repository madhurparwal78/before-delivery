import type { Queryable } from '../db/pool.js';
import { parseBody, plainBody, readTimeMinutes } from './bodytext.js';
import type { Claim } from './claims.js';
import { recordedDelta } from './claims.js';
import { ALDERMOOR, findComparator } from './comparators.js';
import type { ContentStatus } from './lifecycle.js';

export type ContentKind = 'model' | 'news';

export type NewsSubject = 'research' | 'safety' | 'policy' | 'company';

export const NEWS_SUBJECTS: readonly { value: NewsSubject; label: string }[] = [
  { value: 'research', label: 'Research' },
  { value: 'safety', label: 'Safety' },
  { value: 'policy', label: 'Policy' },
  { value: 'company', label: 'Company' },
];

export const NEWS_PAGE_SIZE = 10;

export type ContentRow = {
  id: string;
  kind: ContentKind;
  slug: string;
  title: string;
  summary: string;
  body: string;
  subject: NewsSubject | null;
  tags: string[] | null;
  claims: Claim[] | null;
  linked_news_slug: string | null;
  status: ContentStatus;
  author: string;
  release_at: Date | null;
  release_at_local: string | null;
  scheduled_by: string | null;
  published_at: Date | null;
  read_time_minutes: number | null;
  version: number;
};

export type BenchmarkRowRecord = {
  id: string;
  subject: string;
  benchmark: string;
  eval_date: string;
  score_text: string;
  source_note: string;
};

export const CONTENT_COLUMNS = `id, kind, slug, title, summary, body, subject, tags, claims,
  linked_news_slug, status, author, release_at, release_at_local, scheduled_by, published_at,
  read_time_minutes, version`;

export async function loadContentById(
  tx: Queryable,
  id: string,
): Promise<ContentRow | undefined> {
  const result = await tx.query<ContentRow>(
    `SELECT ${CONTENT_COLUMNS} FROM content_items WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

export async function loadContentBySlug(
  tx: Queryable,
  kind: ContentKind,
  slug: string,
): Promise<ContentRow | undefined> {
  const result = await tx.query<ContentRow>(
    `SELECT ${CONTENT_COLUMNS} FROM content_items WHERE kind = $1 AND slug = $2`,
    [kind, slug],
  );
  return result.rows[0];
}

export function claimTextMap(row: ContentRow): Map<string, string> {
  return new Map((row.claims ?? []).map((claim) => [claim.id, claim.text]));
}

export function contentReadTime(row: ContentRow): number {
  return readTimeMinutes(row.body, claimTextMap(row));
}

export function searchableBody(row: ContentRow): string {
  return plainBody(row.body, claimTextMap(row));
}

export function contentSections(row: ContentRow): readonly { id: string; heading: string }[] {
  return parseBody(row.body).sections.map((section) => ({
    id: section.id,
    heading: section.heading,
  }));
}

export async function upsertSearchEntry(
  tx: Queryable,
  entry: {
    readonly kind: 'model' | 'news' | 'role';
    readonly slug: string;
    readonly refId: string;
    readonly title: string;
    readonly summary: string;
    readonly body: string;
    readonly publishedAt: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO search_index (kind, slug, ref_id, title, summary, body, published_at, tsv)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       setweight(to_tsvector('english', $4), 'A') ||
       setweight(to_tsvector('english', $5), 'B') ||
       setweight(to_tsvector('english', $6), 'C'))
     ON CONFLICT (kind, slug) DO UPDATE SET
       ref_id = EXCLUDED.ref_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
       body = EXCLUDED.body, published_at = EXCLUDED.published_at, tsv = EXCLUDED.tsv`,
    [
      entry.kind,
      entry.slug,
      entry.refId,
      entry.title,
      entry.summary,
      entry.body,
      entry.publishedAt,
    ],
  );
}

export async function removeSearchEntry(
  tx: Queryable,
  kind: 'model' | 'news' | 'role',
  slug: string,
): Promise<void> {
  await tx.query('DELETE FROM search_index WHERE kind = $1 AND slug = $2', [kind, slug]);
}

/** Publishes a content item and every surface built from it, in one transaction. */
export async function publishContentRow(
  tx: Queryable,
  row: ContentRow,
  publishedAt: Date,
): Promise<void> {
  const readTime = contentReadTime(row);
  await tx.query(
    `UPDATE content_items SET status='published', published_at=$2, read_time_minutes=$3
      WHERE id=$1`,
    [row.id, publishedAt, readTime],
  );
  await tx.query(
    `INSERT INTO publication_events (content_id, published_at) VALUES ($1,$2)
     ON CONFLICT (content_id) DO UPDATE SET published_at = EXCLUDED.published_at,
       withdrawn_at = NULL`,
    [row.id, publishedAt],
  );
  await upsertSearchEntry(tx, {
    kind: row.kind,
    slug: row.slug,
    refId: row.id,
    title: row.title,
    summary: row.summary,
    body: searchableBody(row),
    publishedAt,
  });
}

export async function withdrawContentRow(
  tx: Queryable,
  row: ContentRow,
  at: Date,
): Promise<void> {
  await tx.query(`UPDATE content_items SET status='withdrawn' WHERE id=$1`, [row.id]);
  await tx.query(
    `UPDATE publication_events SET withdrawn_at=$2 WHERE content_id=$1 AND withdrawn_at IS NULL`,
    [row.id, at],
  );
  await removeSearchEntry(tx, row.kind, row.slug);
}

export type PublicVisibility =
  | { readonly kind: 'visible'; readonly row: ContentRow; readonly publishedAt: Date }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'gone' };

export async function publicVisibility(
  tx: Queryable,
  kind: ContentKind,
  slug: string,
  asOf: Date | null,
): Promise<PublicVisibility> {
  const row = await loadContentBySlug(tx, kind, slug);
  if (row === undefined) return { kind: 'hidden' };
  const events = await tx.query<{ published_at: Date; withdrawn_at: Date | null }>(
    'SELECT published_at, withdrawn_at FROM publication_events WHERE content_id = $1',
    [row.id],
  );
  const event = events.rows[0];
  if (event === undefined) return { kind: 'hidden' };
  if (event.withdrawn_at !== null) return { kind: 'gone' };
  if (asOf !== null && event.published_at.getTime() > asOf.getTime()) return { kind: 'hidden' };
  return { kind: 'visible', row, publishedAt: event.published_at };
}

export type ChartRow = {
  readonly id: string;
  readonly subject: string;
  readonly subject_name: string;
  readonly organisation: string;
  readonly benchmark: string;
  readonly eval_date: string;
  readonly score: string;
};

/** One group per benchmark and evaluation date on which the route's model has a row. */
export function groupedRows(
  modelSlug: string,
  modelName: string,
  rows: readonly BenchmarkRowRecord[],
): readonly ChartRow[] {
  const describe = (row: BenchmarkRowRecord): ChartRow => {
    const comparator = findComparator(row.subject);
    return {
      id: row.id,
      subject: row.subject,
      subject_name: comparator === undefined ? modelName : comparator.name,
      organisation: comparator === undefined ? ALDERMOOR : comparator.organisation,
      benchmark: row.benchmark,
      eval_date: row.eval_date,
      score: row.score_text,
    };
  };

  const ownRows = rows
    .filter((row) => row.subject === modelSlug)
    .sort((left, right) =>
      left.benchmark === right.benchmark
        ? left.eval_date.localeCompare(right.eval_date)
        : left.benchmark.localeCompare(right.benchmark),
    );

  const grouped: ChartRow[] = [];
  for (const own of ownRows) {
    grouped.push(describe(own));
    const comparators = rows
      .filter(
        (row) =>
          row.subject !== modelSlug &&
          row.benchmark === own.benchmark &&
          row.eval_date === own.eval_date &&
          findComparator(row.subject) !== undefined,
      )
      .map(describe)
      .sort((left, right) => left.subject_name.localeCompare(right.subject_name));
    grouped.push(...comparators);
  }
  return grouped;
}

export type PublicClaim = {
  readonly id: string;
  readonly number: number;
  readonly text: string;
  readonly benchmark: string;
  readonly eval_date: string;
  readonly model_row_id: string;
  readonly comparator_row_id: string;
  readonly delta: string;
};

export function publicClaims(
  row: ContentRow,
  rows: readonly BenchmarkRowRecord[],
): readonly PublicClaim[] {
  const markers = parseBody(row.body).markerIds;
  const claims = row.claims ?? [];
  const ordered = [...claims].sort((left, right) => {
    const leftIndex = markers.indexOf(left.id);
    const rightIndex = markers.indexOf(right.id);
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  const result: PublicClaim[] = [];
  for (const [index, claim] of ordered.entries()) {
    const modelRow = rows.find(
      (candidate) =>
        candidate.subject === row.slug &&
        candidate.benchmark === claim.benchmark &&
        candidate.eval_date === claim.eval_date,
    );
    const comparatorRow = rows.find(
      (candidate) =>
        candidate.subject === claim.comparator &&
        candidate.benchmark === claim.benchmark &&
        candidate.eval_date === claim.eval_date,
    );
    if (modelRow === undefined || comparatorRow === undefined) continue;
    result.push({
      id: claim.id,
      number: index + 1,
      text: claim.text,
      benchmark: claim.benchmark,
      eval_date: claim.eval_date,
      model_row_id: modelRow.id,
      comparator_row_id: comparatorRow.id,
      delta: recordedDelta(modelRow.score_text, comparatorRow.score_text),
    });
  }
  return result;
}

export async function allBenchmarkRows(tx: Queryable): Promise<BenchmarkRowRecord[]> {
  const result = await tx.query<BenchmarkRowRecord>(
    `SELECT id, subject, benchmark, eval_date::text AS eval_date, score_text, source_note
       FROM benchmark_rows
      ORDER BY benchmark, eval_date, subject`,
  );
  return result.rows;
}
