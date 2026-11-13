import type { Queryable } from '../db/pool.js';
import { escapeHtml } from '../http/html.js';

const MARK_START = '\u0001';
const MARK_STOP = '\u0002';
const HEADLINE_OPTIONS = `MaxWords=30, MinWords=10, MaxFragments=1, StartSel=${MARK_START}, StopSel=${MARK_STOP}`;
const RANK_WEIGHTS = '{0.1,0.2,0.4,1.0}';

export const SEARCH_KINDS = ['model', 'news', 'role'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_PAGE_SIZE = 3;
export const SEARCH_DEFAULT_LIMIT = 10;

export type SearchItem = {
  readonly kind: SearchKind;
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly published_at: string;
  readonly rank: number;
  readonly highlight: string;
};

export type SearchPage = {
  readonly items: readonly SearchItem[];
  readonly next_cursor: string | null;
};

type Cursor = {
  readonly q: string;
  readonly k: string;
  readonly r: number;
  readonly p: string;
  readonly s: string;
};

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.q !== 'string' ||
      typeof candidate.k !== 'string' ||
      typeof candidate.r !== 'number' ||
      typeof candidate.p !== 'string' ||
      typeof candidate.s !== 'string'
    ) {
      return null;
    }
    return { q: candidate.q, k: candidate.k, r: candidate.r, p: candidate.p, s: candidate.s };
  } catch {
    return null;
  }
}

export function isSearchKind(value: string): value is SearchKind {
  return (SEARCH_KINDS as readonly string[]).includes(value);
}

export function urlForKind(kind: SearchKind, slug: string): string {
  if (kind === 'model') return `/models/${slug}`;
  if (kind === 'news') return `/news/${slug}`;
  return `/careers/${slug}`;
}

function firstWords(text: string, count: number): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  return words.slice(0, count).join(' ');
}

function markup(headline: string): string {
  return escapeHtml(headline)
    .split(MARK_START)
    .join('<mark>')
    .split(MARK_STOP)
    .join('</mark>');
}

type Matched = {
  kind: SearchKind;
  slug: string;
  title: string;
  summary: string;
  published_at: Date;
  rank: number;
  summary_rank: number;
  body_rank: number;
  summary_headline: string;
  body_headline: string;
};

export async function searchRecord(
  tx: Queryable,
  params: {
    readonly q: string;
    readonly kind: SearchKind | null;
    readonly cursor: Cursor | null;
    readonly limit: number;
  },
): Promise<SearchPage> {
  const cursor = params.cursor;
  const result = await tx.query<Matched>(
    `WITH q AS (SELECT websearch_to_tsquery('english', $1) AS query),
     matched AS (
       SELECT s.kind, s.slug, s.title, s.summary, s.body, s.published_at,
              ts_rank($2::float4[], s.tsv, q.query)::float8 AS rank
         FROM search_index s, q
        WHERE s.tsv @@ q.query
          AND ($3::text IS NULL OR s.kind = $3::text)
     )
     SELECT m.kind, m.slug, m.title, m.summary, m.published_at, m.rank,
            ts_rank(to_tsvector('english', m.summary), q.query)::float8 AS summary_rank,
            ts_rank(to_tsvector('english', m.body), q.query)::float8 AS body_rank,
            ts_headline('english', m.summary, q.query, $7) AS summary_headline,
            ts_headline('english', m.body, q.query, $7) AS body_headline
       FROM matched m, q
      WHERE $4::float8 IS NULL
         OR m.rank < $4::float8
         OR (m.rank = $4::float8
             AND (m.published_at < $5::timestamptz
                  OR (m.published_at = $5::timestamptz AND m.slug > $6::text)))
      ORDER BY m.rank DESC, m.published_at DESC, m.slug
      LIMIT $8`,
    [
      params.q,
      RANK_WEIGHTS,
      params.kind,
      cursor === null ? null : cursor.r,
      cursor === null ? null : cursor.p,
      cursor === null ? null : cursor.s,
      HEADLINE_OPTIONS,
      params.limit + 1,
    ],
  );

  const rows = result.rows.slice(0, params.limit);
  const items: SearchItem[] = rows.map((row) => {
    let highlight: string;
    if (row.body_rank <= 0 && row.summary_rank <= 0) {
      highlight = escapeHtml(firstWords(row.summary, 30));
    } else if (row.body_rank > row.summary_rank) {
      highlight = markup(row.body_headline);
    } else {
      highlight = markup(row.summary_headline);
    }
    return {
      kind: row.kind,
      slug: row.slug,
      title: row.title,
      url: urlForKind(row.kind, row.slug),
      published_at: row.published_at.toISOString(),
      rank: row.rank,
      highlight,
    };
  });

  const last = rows[rows.length - 1];
  const hasMore = result.rows.length > params.limit && last !== undefined;
  return {
    items,
    next_cursor: hasMore
      ? encodeCursor({
          q: params.q,
          k: params.kind ?? '',
          r: last.rank,
          p: last.published_at.toISOString(),
          s: last.slug,
        })
      : null,
  };
}
