import { config } from '../../config.js';
import { pool, query } from '../../db/pool.js';
import { REGIONS, benefitsInForce, type BenefitsEntry } from '../../domain/careers.js';
import {
  allBenchmarkRows,
  contentSections,
  groupedRows,
  publicClaims,
  publicVisibility,
  type ChartRow,
  type PublicClaim,
} from '../../domain/content.js';
import { ALDERMOOR } from '../../domain/comparators.js';
import {
  FEED_EPOCH,
  describeRole,
  homeRail,
  linkedModelFor,
  linkedNewsFor,
  newsroom,
  openRoles,
  publishedModels,
  publishedNewsForFeed,
  type Newsroom,
} from '../../domain/publicrecord.js';
import {
  SEARCH_DEFAULT_LIMIT,
  decodeCursor,
  isSearchKind,
  searchRecord,
  type SearchKind,
  type SearchPage,
} from '../../domain/search.js';
import { THESES } from '../../domain/theses.js';
import { storageIsUp } from '../../services/probes.js';
import { errors } from '../errors.js';
import { escapeHtml } from '../html.js';

const AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function parseAsOf(url: URL): Date | null {
  const raw = url.searchParams.get('as_of');
  if (raw === null || raw === '') return null;
  const message = 'Choose a past instant in the form YYYY-MM-DDTHH:mm:ssZ.';
  if (!AS_OF_PATTERN.test(raw)) throw errors.validationFailed({ as_of: message });
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) throw errors.validationFailed({ as_of: message });
  if (instant.getTime() > Date.now()) throw errors.validationFailed({ as_of: message });
  return instant;
}

export type HomeData = {
  readonly theses: readonly { number: number; heading: string; body: string }[];
  readonly rail: readonly {
    kind: 'model' | 'news';
    slug: string;
    title: string;
    published_at: string;
    url: string;
  }[];
};

export async function homeData(): Promise<HomeData> {
  const rail = await homeRail(pool);
  return {
    theses: THESES.map((thesis) => ({
      number: thesis.number,
      heading: thesis.heading,
      body: thesis.body,
    })),
    rail: rail.map((item) => ({
      kind: item.kind,
      slug: item.slug,
      title: item.title,
      published_at: item.published_at.toISOString(),
      url: item.kind === 'model' ? `/models/${item.slug}` : `/news/${item.slug}`,
    })),
  };
}

export type ModelListData = {
  readonly items: readonly {
    slug: string;
    title: string;
    summary: string;
    published_at: string;
  }[];
  readonly as_of?: string;
};

export async function modelsData(asOf: Date | null): Promise<ModelListData> {
  const items = await publishedModels(pool, asOf);
  const payload: ModelListData = {
    items: items.map((item) => ({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      published_at: item.published_at.toISOString(),
    })),
  };
  return asOf === null ? payload : { ...payload, as_of: asOf.toISOString() };
}

export type SampleView = {
  readonly id: string;
  readonly kind: 'audio' | 'image_sequence';
  readonly title: string;
  readonly urls: readonly string[];
};

export type ModelRouteData = {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly published_at: string;
  readonly read_time_minutes: number;
  readonly organisation: string;
  readonly sections: readonly { id: string; heading: string }[];
  readonly body: string;
  readonly claims: readonly PublicClaim[];
  readonly rows: readonly ChartRow[];
  readonly samples: readonly SampleView[];
  readonly linked_news: { slug: string; title: string } | null;
  readonly samples_available?: boolean;
  readonly as_of?: string;
};

export async function modelRouteData(slug: string, asOf: Date | null): Promise<ModelRouteData> {
  const visibility = await publicVisibility(pool, 'model', slug, asOf);
  if (visibility.kind === 'hidden') throw errors.publicNotFound();
  if (visibility.kind === 'gone') throw errors.gone();
  const row = visibility.row;
  const rows = await allBenchmarkRows(pool);
  const grouped = groupedRows(row.slug, row.title, rows);
  const samplesAvailable = storageIsUp();
  const sampleRows = await query<{
    id: string;
    kind: 'audio' | 'image_sequence';
    title: string;
    frames: number;
  }>(
    'SELECT id, kind, title, frames FROM model_samples WHERE model_slug = $1 ORDER BY position',
    [row.slug],
  );
  const samples: SampleView[] = samplesAvailable
    ? sampleRows.rows.map((sample) => ({
        id: sample.id,
        kind: sample.kind,
        title: sample.title,
        urls:
          sample.kind === 'audio'
            ? [`/media/samples/${row.slug}/${sample.id}/clip.wav`]
            : Array.from(
                { length: sample.frames },
                (_value, index) =>
                  `/media/samples/${row.slug}/${sample.id}/frame-${String(index + 1).padStart(2, '0')}.png`,
              ),
      }))
    : [];

  const base: ModelRouteData = {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    published_at: visibility.publishedAt.toISOString(),
    read_time_minutes: row.read_time_minutes ?? 1,
    organisation: ALDERMOOR,
    sections: contentSections(row),
    body: row.body,
    claims: publicClaims(row, rows),
    rows: grouped,
    samples,
    linked_news: await linkedNewsFor(pool, row.linked_news_slug, asOf),
  };
  const withStorage = samplesAvailable ? base : { ...base, samples_available: false };
  return asOf === null ? withStorage : { ...withStorage, as_of: asOf.toISOString() };
}

export type NewsroomData = Omit<Newsroom, 'items'> & {
  readonly items: readonly {
    slug: string;
    title: string;
    summary: string;
    subject: string;
    tags: string[];
    published_at: string;
    read_time_minutes: number;
  }[];
  readonly as_of?: string;
};

export function parseNewsPage(url: URL): number {
  const raw = url.searchParams.get('page');
  if (raw === null) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function newsData(params: {
  readonly subject: string | null;
  readonly tag: string | null;
  readonly page: number;
  readonly asOf: Date | null;
}): Promise<NewsroomData> {
  const room = await newsroom(pool, params);
  const payload: NewsroomData = {
    items: room.items.map((item) => ({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      subject: item.subject,
      tags: item.tags,
      published_at: item.published_at.toISOString(),
      read_time_minutes: item.read_time_minutes,
    })),
    facets: room.facets,
    page: room.page,
    pages: room.pages,
    total: room.total,
  };
  return params.asOf === null
    ? payload
    : { ...payload, as_of: params.asOf.toISOString() };
}

export type NewsPostData = {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly subject: string;
  readonly tags: string[];
  readonly published_at: string;
  readonly read_time_minutes: number;
  readonly body: string;
  readonly linked_model: { slug: string; title: string } | null;
  readonly as_of?: string;
};

export async function newsPostData(slug: string, asOf: Date | null): Promise<NewsPostData> {
  const visibility = await publicVisibility(pool, 'news', slug, asOf);
  if (visibility.kind === 'hidden') throw errors.publicNotFound();
  if (visibility.kind === 'gone') throw errors.gone();
  const row = visibility.row;
  const payload: NewsPostData = {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    subject: row.subject ?? '',
    tags: row.tags ?? [],
    published_at: visibility.publishedAt.toISOString(),
    read_time_minutes: row.read_time_minutes ?? 1,
    body: row.body,
    linked_model: await linkedModelFor(pool, row.slug, asOf),
  };
  return asOf === null ? payload : { ...payload, as_of: asOf.toISOString() };
}

export type SearchData = {
  readonly query: string;
  readonly kind: SearchKind | null;
  readonly items: SearchPage['items'];
  readonly next_cursor: string | null;
};

export async function searchData(url: URL, defaultLimit = SEARCH_DEFAULT_LIMIT): Promise<SearchData> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 1 || q.length > 200) {
    throw errors.validationFailed({ q: 'Enter between 1 and 200 characters.' });
  }
  const rawLimit = url.searchParams.get('limit');
  let limit = defaultLimit;
  if (rawLimit !== null && rawLimit !== '') {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) {
      throw errors.validationFailed({ limit: 'Choose a limit from 1 to 50.' });
    }
    limit = parsed;
  }
  const rawKind = url.searchParams.get('kind');
  const kind = rawKind !== null && isSearchKind(rawKind) ? rawKind : null;
  const unknownKind = rawKind !== null && rawKind !== '' && !isSearchKind(rawKind);

  const rawCursor = url.searchParams.get('cursor');
  let cursor = null;
  if (rawCursor !== null && rawCursor !== '') {
    const decoded = decodeCursor(rawCursor);
    if (decoded === null || decoded.q !== q || decoded.k !== (kind ?? '')) {
      throw errors.validationFailed({ cursor: 'This cursor does not belong to this search.' });
    }
    cursor = decoded;
  }

  if (unknownKind) {
    return { query: q, kind: null, items: [], next_cursor: null };
  }
  const page = await searchRecord(pool, { q, kind, cursor, limit });
  return { query: q, kind, items: page.items, next_cursor: page.next_cursor };
}

export type RoleListData = {
  readonly items: readonly {
    slug: string;
    title: string;
    discipline: string;
    office: string;
    office_label: string;
    region: string;
    region_label: string;
    opened_at: string;
  }[];
};

export async function rolesData(filters: {
  readonly discipline: string | null;
  readonly office: string | null;
  readonly region: string | null;
}): Promise<RoleListData> {
  const roles = await openRoles(pool, filters);
  return {
    items: roles.map((role) => ({
      slug: role.slug,
      title: role.title,
      discipline: role.discipline,
      office: role.office,
      office_label: role.office_label,
      region: role.region,
      region_label: role.region_label,
      opened_at: role.opened_at.toISOString(),
    })),
  };
}

export type RoleData = RoleListData['items'][number] & {
  readonly description: string;
  readonly benefits: BenefitsEntry | null;
};

export async function roleData(slug: string): Promise<RoleData> {
  const result = await query<{
    slug: string;
    title: string;
    discipline: string;
    office: string;
    description: string;
    status: string;
    opened_at: Date | null;
  }>(
    `SELECT slug, title, discipline, office, description, status, opened_at
       FROM requisitions WHERE slug = $1`,
    [slug],
  );
  const role = result.rows[0];
  if (role === undefined || role.status === 'draft' || role.opened_at === null) {
    throw errors.publicNotFound();
  }
  if (role.status === 'closed') throw errors.gone('This role has closed.');
  const described = describeRole({
    slug: role.slug,
    title: role.title,
    discipline: role.discipline,
    office: role.office,
    opened_at: role.opened_at,
  });
  return {
    slug: described.slug,
    title: described.title,
    discipline: described.discipline,
    office: described.office,
    office_label: described.office_label,
    region: described.region,
    region_label: described.region_label,
    opened_at: described.opened_at.toISOString(),
    description: role.description,
    benefits: await benefitsInForce(pool, described.region),
  };
}

export type BenefitsData = {
  readonly regions: readonly {
    region: string;
    label: string;
    entry: BenefitsEntry | null;
  }[];
};

export async function benefitsData(): Promise<BenefitsData> {
  const regions: BenefitsData['regions'][number][] = [];
  for (const region of REGIONS) {
    regions.push({
      region: region.value,
      label: region.label,
      entry: await benefitsInForce(pool, region.value),
    });
  }
  return { regions };
}

export async function feedXml(): Promise<string> {
  const posts = await publishedNewsForFeed(pool);
  const newest = posts[0];
  const updated = newest === undefined ? FEED_EPOCH : newest.published_at.toISOString();
  const entries = posts
    .map((post) =>
      [
        '  <entry>',
        `    <id>${config.publicBaseUrl}/news/${escapeHtml(post.slug)}</id>`,
        `    <title>${escapeHtml(post.title)}</title>`,
        `    <link href="${config.publicBaseUrl}/news/${escapeHtml(post.slug)}"/>`,
        `    <updated>${post.published_at.toISOString()}</updated>`,
        `    <summary>${escapeHtml(post.summary)}</summary>`,
        '  </entry>',
      ].join('\n'),
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>Aldermoor Labs: the open record</title>',
    `  <id>${config.publicBaseUrl}/</id>`,
    `  <link href="${config.publicBaseUrl}/"/>`,
    `  <link rel="self" href="${config.publicBaseUrl}/feed.xml"/>`,
    `  <updated>${updated}</updated>`,
    entries,
    '</feed>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function sitemapXml(): Promise<string> {
  const models = await publishedModels(pool, null);
  const posts = await publishedNewsForFeed(pool);
  const roles = await openRoles(pool, { discipline: null, office: null, region: null });
  const paths = [
    '/',
    '/models',
    '/news',
    '/search',
    '/careers',
    ...models.map((model) => `/models/${model.slug}`),
    ...posts.map((post) => `/news/${post.slug}`),
    ...roles.map((role) => `/careers/${role.slug}`),
  ];
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => `  <url><loc>${config.publicBaseUrl}${escapeHtml(path)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}
