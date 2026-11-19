import { limits, config } from './config';
import { contentCost, loadSnapshot, type Content } from './content';
import { decodeTimeCursor, encodeCursor } from './cursor';
import { one, pool, transaction, type Db } from './db';
import { tooLong, unavailable, unprocessable } from './errors';
import type { Ctx } from './http';
import { formatCost } from '../shared/cost';
import { codePointLength } from '../shared/text';
import type { Currency, SearchItem } from '../shared/types';

/** Lower-cased words of a guide as it was published, each preceded by a space, so a prefix match is `LIKE '% word%'`. */
function searchTextOf(title: string, tags: string[], content: Content): string {
  const pieces = [title, ...tags, ...content.steps.flatMap((s) => [s.title, s.text]), ...content.parts.map((p) => p.name)];
  return ` ${pieces.join(' ').toLowerCase().split(/\s+/).filter(Boolean).join(' ')}`;
}

export async function refreshSearchText(db: Db, guideId: string): Promise<void> {
  const row = await one<{ title: string; tags: string[]; published_version: number | null; state: string }>(
    db, 'SELECT title, tags, published_version, state FROM guides WHERE id = $1', [guideId]);
  if (!row || row.state !== 'published' || row.published_version === null) return;
  const snapshot = await loadSnapshot(db, guideId, row.published_version);
  if (snapshot) await db.query('UPDATE guides SET search_text = $1 WHERE id = $2', [searchTextOf(row.title, row.tags, snapshot.content), guideId]);
}

export async function setSearchText(db: Db, guideId: string, title: string, tags: string[], content: Content): Promise<void> {
  await db.query('UPDATE guides SET search_text = $1 WHERE id = $2', [searchTextOf(title, tags, content), guideId]);
}

const escapeLike = (word: string) => word.replace(/[\\%_]/g, (c) => `\\${c}`);

interface Row { id: string; slug: string; title: string; author_name: string; tags: string[]; currency: Currency; published_at: Date; snapshot: Content; likes: string }

export async function search(ctx: Ctx): Promise<unknown> {
  const q = ctx.url.searchParams.get('q') ?? '';
  const tags = ctx.url.searchParams.getAll('tag').map((t) => t.toLowerCase());
  if (codePointLength(q) > limits.search_query_max) throw unprocessable('query_too_long', { limit: limits.search_query_max });
  if (tags.length > limits.search_tag_max) throw unprocessable('too_many_tags', { limit: limits.search_tag_max });
  const requested = Number(ctx.url.searchParams.get('limit'));
  const size = Math.min(limits.page_size_max, Math.max(1, Number.isInteger(requested) && requested > 0 ? requested : limits.page_size_default));
  const cursor = decodeTimeCursor(ctx.url.searchParams.get('cursor'));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => `% ${escapeLike(w)}%`);
  const filters = `g.state = 'published' AND g.visibility = 'public' AND g.search_text LIKE ALL ($1::text[])
    AND ($2::text[] = '{}' OR (SELECT array_agg(lower(t)) FROM jsonb_array_elements_text(g.tags) t) @> $2::text[])`;
  try {
    return await transaction(async (db) => {
      await db.query(`SET LOCAL statement_timeout = ${Math.floor(config.searchDbTimeoutMs)}`);
      const total = await one<{ n: string }>(db, `SELECT count(*) AS n FROM guides g WHERE ${filters}`, [words, tags]);
      const rows = await db.query<Row>(
        `SELECT g.id, g.slug, g.title, u.name AS author_name, g.tags, g.currency, g.published_at, v.snapshot,
                (SELECT count(*) FROM likes l WHERE l.guide_id = g.id) AS likes
           FROM guides g JOIN users u ON u.id = g.owner_id JOIN versions v ON v.guide_id = g.id AND v.number = g.published_version
          WHERE ${filters} AND ($3::timestamptz IS NULL OR (g.published_at, g.id) < ($3::timestamptz, $4::uuid))
          ORDER BY g.published_at DESC, g.id DESC LIMIT $5`,
        [words, tags, cursor?.t ?? null, cursor?.id ?? null, size + 1],
      );
      const page = rows.rows.slice(0, size);
      const last = page[page.length - 1];
      const items: SearchItem[] = page.map((row) => ({
        id: row.id, slug: row.slug, title: row.title, author_name: row.author_name, tags: row.tags, like_count: Number(row.likes),
        step_count: row.snapshot.steps.length, parts_cost_text: formatCost(contentCost(row.snapshot), row.currency),
      }));
      return {
        items,
        total: Number(total?.n ?? 0),
        next_cursor: rows.rows.length > size && last ? encodeCursor({ t: last.published_at.toISOString(), id: last.id }) : null,
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '57014') throw unavailable('search_timeout');
    throw error;
  }
}

export async function tags(ctx: Ctx): Promise<unknown> {
  const prefix = (ctx.url.searchParams.get('prefix') ?? '').toLowerCase();
  if (codePointLength(prefix) > limits.tag_text_max) throw tooLong('prefix', limits.tag_text_max);
  const rows = await pool.query<{ tag: string }>(
    `SELECT lower(t) AS tag FROM guides g, jsonb_array_elements_text(g.tags) t
      WHERE g.state = 'published' AND g.visibility = 'public' AND lower(t) LIKE $1 ESCAPE '\\'
      GROUP BY lower(t) ORDER BY count(*) DESC, lower(t) LIMIT 20`,
    [`${escapeLike(prefix)}%`],
  );
  return { items: rows.rows.map((r) => r.tag) };
}
