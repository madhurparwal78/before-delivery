import { ApiError } from '../http/errors.js';
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { formatCost } from '../../shared/cost.js';
import type { Currency } from '../../shared/types.js';

export interface SearchResult {
  id: string;
  slug: string;
  title: string;
  author_name: string;
  tags: string[];
  like_count: number;
  step_count: number;
  parts_cost_text: string;
}

export interface SearchPage {
  items: SearchResult[];
  total: number;
  next_cursor: string | null;
}

interface Cursor {
  publishedAt: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.publishedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string | null): Cursor | null {
  if (raw === null) return null;
  const [publishedAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!publishedAt || !id) return null;
  return { publishedAt, id };
}

/** Characters with special meaning in patterns are matched literally. */
function escapeRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function queryWords(q: string): string[] {
  return q.split(/\s+/).filter((word) => word.length > 0);
}

export interface SearchInput {
  q: string;
  tags: string[];
  cursor: string | null;
  limit: number;
}

/**
 * Only public published guides appear, newest published first. Over-limit
 * input answers before any database work.
 */
export async function searchGuides(input: SearchInput): Promise<SearchPage> {
  if (input.q.length > config.limits.search_query_max) {
    throw new ApiError(422, { error: 'query_too_long', limit: config.limits.search_query_max });
  }
  if (input.tags.length > config.limits.search_tag_max) {
    throw new ApiError(422, { error: 'too_many_tags', limit: config.limits.search_tag_max });
  }

  const conditions = ["g.visibility = 'public'", "g.state = 'published'"];
  const filterParams: unknown[] = [];
  for (const word of queryWords(input.q)) {
    filterParams.push(`\\m${escapeRegex(word)}`);
    conditions.push(`g.search_text ~* $${filterParams.length}`);
  }
  if (input.tags.length > 0) {
    filterParams.push(input.tags.map((tag) => tag.toLowerCase()));
    conditions.push(
      `(SELECT array_agg(lower(t)) FROM unnest(g.tags) t) @> $${filterParams.length}`,
    );
  }
  const cursor = decodeCursor(input.cursor);
  const where = conditions.join(' AND ');
  const params = [...filterParams];
  let keyset = '';
  if (cursor !== null) {
    params.push(cursor.publishedAt, cursor.id);
    keyset = ` AND (g.published_at, g.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(input.limit + 1);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${config.limits.search_db_timeout_ms}`);
    const countRows = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM guides g WHERE ${where}`,
      filterParams,
    );
    const rows = await client.query<{
      id: string;
      slug: string;
      title: string;
      author_name: string;
      tags: string[];
      currency: Currency;
      like_count: string;
      step_count: string;
      parts_cost: string;
      published_at: Date;
    }>(
      `SELECT g.id, g.slug, g.title, u.name AS author_name, g.tags, g.currency, g.published_at,
              (SELECT count(*)::text FROM likes l WHERE l.guide_id = g.id) AS like_count,
              coalesce(jsonb_array_length(v.snapshot->'steps'), 0)::text AS step_count,
              coalesce((
                SELECT sum((p->>'quantity')::bigint * (p->>'unit_price')::bigint)
                FROM jsonb_array_elements(v.snapshot->'parts') p
                WHERE p->>'fitted_at' IS NOT NULL
              ), 0)::text AS parts_cost
       FROM guides g
       JOIN users u ON u.id = g.owner_id
       LEFT JOIN versions v ON v.guide_id = g.id AND v.number = g.published_version
       WHERE ${where}${keyset}
       ORDER BY g.published_at DESC, g.id DESC
       LIMIT $${params.length}`,
      params,
    );
    await client.query('COMMIT');
    const page = rows.rows.slice(0, input.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        author_name: row.author_name,
        tags: row.tags,
        like_count: Number(row.like_count),
        step_count: Number(row.step_count),
        parts_cost_text: formatCost(Number(row.parts_cost), row.currency),
      })),
      total: Number(countRows.rows[0]?.total ?? '0'),
      next_cursor:
        rows.rows.length > input.limit && last
          ? encodeCursor({ publishedAt: last.published_at.toISOString(), id: last.id })
          : null,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : '';
    if (message.includes('statement timeout') || message.includes('canceling statement')) {
      throw new ApiError(503, { error: 'search_timeout' });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function tagSuggestions(prefix: string): Promise<string[]> {
  const rows = await pool.query<{ tag: string }>(
    `SELECT DISTINCT lower(t) AS tag
     FROM guides g, unnest(g.tags) t
     WHERE g.visibility = 'public' AND g.state = 'published' AND lower(t) LIKE $1
     ORDER BY tag LIMIT 20`,
    [`${prefix.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`],
  );
  return rows.rows.map((row) => row.tag);
}
