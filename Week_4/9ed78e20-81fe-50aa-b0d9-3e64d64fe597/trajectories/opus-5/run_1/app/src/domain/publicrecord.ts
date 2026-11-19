import type { Queryable } from '../db/pool.js';
import { NEWS_PAGE_SIZE, NEWS_SUBJECTS, type NewsSubject } from './content.js';
import { officeLabel, regionLabel, regionOfOffice } from './careers.js';

export const FEED_EPOCH = '2026-01-01T00:00:00Z';

const VISIBLE = `JOIN publication_events pe ON pe.content_id = c.id
  AND pe.withdrawn_at IS NULL
  AND ($1::timestamptz IS NULL OR pe.published_at <= $1::timestamptz)`;

export type ModelListItem = {
  slug: string;
  title: string;
  summary: string;
  published_at: Date;
};

export async function publishedModels(
  tx: Queryable,
  asOf: Date | null,
): Promise<ModelListItem[]> {
  const result = await tx.query<ModelListItem>(
    `SELECT c.slug, c.title, c.summary, pe.published_at
       FROM content_items c ${VISIBLE}
      WHERE c.kind = 'model'
      ORDER BY pe.published_at DESC, c.slug`,
    [asOf],
  );
  return result.rows;
}

export type NewsListItem = {
  slug: string;
  title: string;
  summary: string;
  subject: NewsSubject;
  tags: string[];
  published_at: Date;
  read_time_minutes: number;
};

export type NewsroomQuery = {
  readonly subject: string | null;
  readonly tag: string | null;
  readonly page: number;
  readonly asOf: Date | null;
};

export type Newsroom = {
  readonly items: readonly NewsListItem[];
  readonly facets: {
    readonly subjects: readonly { value: string; label: string; count: number }[];
    readonly tags: readonly { value: string; count: number }[];
  };
  readonly page: number;
  readonly pages: number;
  readonly total: number;
};

export async function newsroom(tx: Queryable, params: NewsroomQuery): Promise<Newsroom> {
  const subject = params.subject;
  const tag = params.tag;
  const matching = `SELECT c.slug, c.title, c.summary, c.subject, c.tags, pe.published_at,
      c.read_time_minutes
      FROM content_items c ${VISIBLE}
     WHERE c.kind = 'news'
       AND ($2::text IS NULL OR c.subject = $2::text)
       AND ($3::text IS NULL OR c.tags @> ARRAY[$3::text])`;

  const totals = await tx.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM (${matching}) matched`,
    [params.asOf, subject, tag],
  );
  const total = totals.rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
  const page = params.page;

  const items = await tx.query<NewsListItem>(
    `${matching} ORDER BY pe.published_at DESC, c.slug LIMIT $4 OFFSET $5`,
    [params.asOf, subject, tag, NEWS_PAGE_SIZE, (page - 1) * NEWS_PAGE_SIZE],
  );

  const subjectCounts = await tx.query<{ subject: NewsSubject; count: number }>(
    `SELECT c.subject, count(*)::int AS count
       FROM content_items c ${VISIBLE}
      WHERE c.kind = 'news' AND ($2::text IS NULL OR c.tags @> ARRAY[$2::text])
      GROUP BY c.subject`,
    [params.asOf, tag],
  );
  const subjectMap = new Map(subjectCounts.rows.map((row) => [row.subject, row.count]));

  const tagRows = await tx.query<{ tag: string; count: number }>(
    `WITH published AS (
        SELECT c.subject, c.tags FROM content_items c ${VISIBLE} WHERE c.kind = 'news'
      ),
      known AS (SELECT DISTINCT unnest(tags) AS tag FROM published)
      SELECT known.tag,
             (SELECT count(*)::int FROM published p
               WHERE p.tags @> ARRAY[known.tag]
                 AND ($2::text IS NULL OR p.subject = $2::text)) AS count
        FROM known
       ORDER BY known.tag`,
    [params.asOf, subject],
  );

  return {
    items: items.rows,
    facets: {
      subjects: NEWS_SUBJECTS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        count: subjectMap.get(entry.value) ?? 0,
      })),
      tags: tagRows.rows.map((row) => ({ value: row.tag, count: row.count })),
    },
    page,
    pages,
    total,
  };
}

export type RailItem = {
  kind: 'model' | 'news';
  slug: string;
  title: string;
  published_at: Date;
};

export async function homeRail(tx: Queryable): Promise<RailItem[]> {
  const result = await tx.query<RailItem>(
    `SELECT c.kind, c.slug, c.title, pe.published_at
       FROM content_items c ${VISIBLE}
      ORDER BY pe.published_at DESC,
               CASE WHEN c.kind = 'model' THEN 0 ELSE 1 END,
               c.title
      LIMIT 5`,
    [null],
  );
  return result.rows;
}

export async function publishedNewsForFeed(tx: Queryable): Promise<NewsListItem[]> {
  const result = await tx.query<NewsListItem>(
    `SELECT c.slug, c.title, c.summary, c.subject, c.tags, pe.published_at, c.read_time_minutes
       FROM content_items c ${VISIBLE}
      WHERE c.kind = 'news'
      ORDER BY pe.published_at DESC, c.slug`,
    [null],
  );
  return result.rows;
}

export type RoleListItem = {
  slug: string;
  title: string;
  discipline: string;
  office: string;
  opened_at: Date;
};

export type PublicRole = RoleListItem & {
  office_label: string;
  region: string;
  region_label: string;
};

export function describeRole(role: RoleListItem): PublicRole {
  const region = regionOfOffice(role.office) ?? '';
  return {
    ...role,
    office_label: officeLabel(role.office),
    region,
    region_label: regionLabel(region),
  };
}

export async function openRoles(
  tx: Queryable,
  filters: {
    readonly discipline: string | null;
    readonly office: string | null;
    readonly region: string | null;
  },
): Promise<PublicRole[]> {
  const result = await tx.query<RoleListItem>(
    `SELECT slug, title, discipline, office, opened_at
       FROM requisitions
      WHERE status = 'open'
        AND ($1::text IS NULL OR discipline = $1::text)
        AND ($2::text IS NULL OR office = $2::text)
      ORDER BY opened_at DESC, title`,
    [filters.discipline, filters.office],
  );
  const described = result.rows.map(describeRole);
  if (filters.region === null) return described;
  return described.filter((role) => role.region === filters.region);
}

export async function linkedNewsFor(
  tx: Queryable,
  linkedSlug: string | null,
  asOf: Date | null,
): Promise<{ slug: string; title: string } | null> {
  if (linkedSlug === null) return null;
  const result = await tx.query<{ slug: string; title: string }>(
    `SELECT c.slug, c.title FROM content_items c ${VISIBLE}
      WHERE c.kind = 'news' AND c.slug = $2`,
    [asOf, linkedSlug],
  );
  return result.rows[0] ?? null;
}

export async function linkedModelFor(
  tx: Queryable,
  newsSlug: string,
  asOf: Date | null,
): Promise<{ slug: string; title: string } | null> {
  const result = await tx.query<{ slug: string; title: string }>(
    `SELECT c.slug, c.title FROM content_items c ${VISIBLE}
      WHERE c.kind = 'model' AND c.linked_news_slug = $2`,
    [asOf, newsSlug],
  );
  return result.rows[0] ?? null;
}
