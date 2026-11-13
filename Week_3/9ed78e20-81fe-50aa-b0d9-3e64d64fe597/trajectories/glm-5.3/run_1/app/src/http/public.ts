import type { RequestCtx } from './dispatch.js';
import { errors } from '../platform/errors.js';
import { sendJson, sendHtml, sendBytes } from './plumbing.js';
import { escapeHtml } from '../domain/text.js';
import { config } from '../config.js';
import { formatLondon, parseStrictInstant } from '../domain/time.js';
import {
  SUBJECTS,
  SUBJECT_LABELS,
  type ClaimInput,
  type RowView,
} from '../domain/lifecycles.js';
import {
  chartGroupsFor,
  getContentById,
  claimViewsFor,
  type ContentRow,
} from './content.js';
import { htmlPageHeaders, pageHtml, publicationTimesHtml, readTimeHtml, asOfBanner, resendFormHtml } from '../html/shell.js';
import { refreshSearchIndex } from '../db/migrate.js';
import { modelRoute, newsPostRoute, feedRoute, sitemapRoute, mediaRoute } from './public-model.js';
import { careersRoute, benefitsApi, roleRoute } from './careers.js';

const PAGE_SIZE = 10;
const SEARCH_PAGE_SIZE = 3;

type PublicContentRow = ContentRow;

export async function handlePublic(ctx: RequestCtx): Promise<void> {
  const { method, path, query } = ctx;
  if (method !== 'GET' && method !== 'HEAD') {
    throw errors.notFoundPublic();
  }

  // Health and readiness.
  if (path === '/api/health') {
    sendJson(ctx.res, 200, { status: 'ok' });
    return;
  }
  if (path === '/api/ready') {
    const storageMod = await import('../platform/storage.js');
    const mailMod = await import('../platform/mail.js');
    const storage = storageMod.storageStatus() ? 'up' : 'down';
    const mail = mailMod.mailStatus() ? 'up' : 'down';
    const degraded: string[] = [];
    if (storage === 'down') degraded.push('applications', 'resume_downloads', 'samples');
    if (mail === 'down') degraded.push('mail_delivery');
    degraded.sort();
    sendJson(ctx.res, 200, {
      status: degraded.length > 0 ? 'degraded' : 'ready',
      dependencies: { database: 'up', storage, mail },
      degraded_features: degraded,
    });
    return;
  }

  const asOfRaw = query.get('as_of');
  let asOf: Date | null = null;
  if (asOfRaw !== null) {
    const parsed = parseStrictInstant(asOfRaw);
    if (!parsed || parsed.getTime() > Date.now()) {
      throw errors.validation({
        as_of: 'Choose a past instant in the form YYYY-MM-DDTHH:mm:ssZ.',
      });
    }
    asOf = parsed;
  }

  if (path === '/' ) return homeRoute(ctx, asOf);
  if (path === '/api/public/home') return homeApi(ctx);
  if (path === '/models') return modelsRoute(ctx, asOf);
  if (path === '/api/public/models') return modelsApi(ctx, asOf);
  if (path === '/news') return newsRoute(ctx, asOf);
  if (path === '/api/public/news') return newsApi(ctx, asOf);
  if (path === '/search' || path === '/api/public/search') return searchRoute(ctx, path.startsWith('/api/'));
  if (path === '/careers') return careersRoute(ctx, false, asOf);
  if (path === '/api/public/roles') return careersRoute(ctx, true, asOf);
  if (path === '/api/public/benefits') return benefitsApi(ctx);
  if (path === '/feed.xml') return feedRoute(ctx);
  if (path === '/sitemap.xml') return sitemapRoute(ctx);
  if (path === '/robots.txt') {
    sendBytes(ctx.res, 200, Buffer.from('User-agent: *\nAllow: /\n'), 'text/plain; charset=utf-8');
    return;
  }

  const modelMatch = /^\/models\/([^/]+)$/.exec(path);
  if (modelMatch) {
    return modelRoute(ctx, modelMatch[1], asOf, false);
  }
  const modelApiMatch = /^\/api\/public\/models\/([^/]+)$/.exec(path);
  if (modelApiMatch) {
    return modelRoute(ctx, modelApiMatch[1], asOf, true);
  }
  const newsMatch = /^\/news\/([^/]+)$/.exec(path);
  if (newsMatch) {
    return newsPostRoute(ctx, newsMatch[1], asOf, false);
  }
  const newsApiMatch = /^\/api\/public\/news\/([^/]+)$/.exec(path);
  if (newsApiMatch) {
    return newsPostRoute(ctx, newsApiMatch[1], asOf, true);
  }
  const roleMatch = /^\/careers\/([^/]+)$/.exec(path);
  if (roleMatch) {
    return roleRoute(ctx, roleMatch[1], false);
  }
  const roleApiMatch = /^\/api\/public\/roles\/([^/]+)$/.exec(path);
  if (roleApiMatch) {
    return roleRoute(ctx, roleApiMatch[1], true);
  }
  const mediaMatch = /^\/media\/samples\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (mediaMatch) return mediaRoute(ctx, mediaMatch.slice(1).join('/'));

  const assetMatch = /^\/assets\/([a-z0-9\-./]+)$/.exec(path);
  if (assetMatch) {
    return assetRoute(ctx, assetMatch[1]);
  }

  throw errors.notFoundPublic();
}

const ASSET_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  json: 'application/json',
};

async function assetRoute(ctx: RequestCtx, relative: string): Promise<void> {
  if (relative.includes('..')) throw errors.notFoundPublic();
  const ext = relative.split('.').pop() ?? '';
  const type = ASSET_TYPES[ext];
  if (!type) throw errors.notFoundPublic();
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const bytes = await readFile(join(root, 'assets', relative));
    sendBytes(ctx.res, 200, bytes, type, {
      'Cache-Control': 'public, max-age=3600',
    });
  } catch {
    throw errors.notFoundPublic();
  }
}

async function publishedModels(
  ctx: RequestCtx,
  asOf: Date | null,
): Promise<PublicContentRow[]> {
  if (asOf) {
    const rows = await ctx.client.query<ContentRow & { tags: unknown; claims: unknown; withdrawn_at: Date | null }>(
      `SELECT c.*, ph.withdrawn_at FROM content_items c
       LEFT JOIN publication_history ph ON ph.content_id = c.id
       WHERE c.kind = 'model' AND ph.published_at IS NOT NULL AND ph.published_at <= $1
         AND ph.withdrawn_at IS NULL
       ORDER BY c.published_at DESC`,
      [asOf.toISOString()],
    );
    return rows.rows.map((r) => ({ ...r, claims: normalizeClaims(r.claims), tags: null })) as unknown as PublicContentRow[];
  }
  const rows = await ctx.client.query<ContentRow & { tags: unknown; claims: unknown }>(
    `SELECT * FROM content_items WHERE kind = 'model' AND status = 'published' ORDER BY published_at DESC`,
  );
  return rows.rows.map((r) => ({ ...r, claims: normalizeClaims(r.claims), tags: null })) as unknown as PublicContentRow[];
}

function normalizeClaims(raw: unknown): ClaimInput[] | null {
  return Array.isArray(raw) ? (raw as ClaimInput[]) : null;
}

async function homeRoute(ctx: RequestCtx, asOf: Date | null): Promise<void> {
  const theses = await ctx.client.query<{ number: number; heading: string; body: string }>(
    `SELECT number, heading, body FROM theses ORDER BY number ASC`,
  );
  const rail = await homeRail(ctx.client, asOf);
  const thesisItems = theses.rows
    .map(
      (t) => `<li class="thesis" data-reveal="pending" id="thesis-${t.number}">
        <div class="thesis-numeral mono" aria-hidden="true">${t.number}</div>
        <div class="thesis-text">
          <h2 class="thesis-heading">Thesis ${t.number}. ${escapeHtml(t.heading)}</h2>
          <p>${escapeHtml(t.body)}</p>
        </div>
      </li>`,
    )
    .join('\n');
  const railItems = rail
    .map(
      (item) => `<li>
        <a href="${item.kind === 'model' ? '/models/' : '/news/'}${escapeHtml(item.slug)}" class="rail-link">
          <span class="rail-kind">${item.kind === 'model' ? 'Model' : 'News'}</span>
          <span class="rail-title">${escapeHtml(item.title)}</span>
          <span class="rail-time">${escapeHtml(formatLondon(new Date(item.published_at)))}</span>
        </a>
      </li>`,
    )
    .join('\n');
  const body = `<section class="home-essay">
    <div class="thesis-progress" aria-hidden="true"><span class="thesis-progress-fill" id="thesis-progress-fill"></span></div>
    <h1 class="display home-title">The open record of Aldermoor Labs</h1>
    <ol class="theses" id="theses" data-thesis-progress="0.00">
${thesisItems}
    </ol>
  </section>
  <aside class="home-rail" aria-label="Latest from the record">
    <h2 class="rail-heading">Latest from the record</h2>
    <ol class="rail-list">
${railItems}
    </ol>
  </aside>`;
  sendHtml(ctx.res, 200, pageHtml({
    title: 'The open record of Aldermoor Labs',
    description: 'Five theses on how Aldermoor Labs publishes its research record.',
    body,
    bodyClass: 'public home',
  }), htmlPageHeaders(ctx.rateHeaders));
}

async function homeApi(ctx: RequestCtx): Promise<void> {
  const theses = await ctx.client.query<{ number: number; heading: string; body: string }>(
    `SELECT number, heading, body FROM theses ORDER BY number ASC`,
  );
  const rail = await homeRail(ctx.client, null);
  sendJson(ctx.res, 200, {
    theses: theses.rows.map((t) => ({ number: t.number, heading: t.heading, body: t.body })),
    rail: rail.map((item) => ({
      kind: item.kind,
      slug: item.slug,
      title: item.title,
      published_at: new Date(item.published_at).toISOString(),
      url: item.kind === 'model' ? `/models/${item.slug}` : `/news/${item.slug}`,
    })),
  }, ctx.rateHeaders);
}

type RailItem = { kind: 'model' | 'news'; slug: string; title: string; published_at: string };

async function homeRail(client: import('../platform/db.js').DbClient, asOf: Date | null): Promise<RailItem[]> {
  const params = asOf ? [asOf.toISOString()] : [];
  const asOfClause = asOf
    ? `AND ph.published_at <= $1`
    : '';
  const rows = await client.query<{ kind: string; slug: string; title: string; published_at: Date }>(
    `SELECT c.kind, c.slug, c.title, c.published_at FROM content_items c
     JOIN publication_history ph ON ph.content_id = c.id
     WHERE ph.withdrawn_at IS NULL ${asOfClause}
       AND c.status = 'published'
     ORDER BY c.published_at DESC, c.kind ASC, c.title ASC
     LIMIT 5`,
    params,
  );
  return rows.rows.map((r) => ({
    kind: r.kind as 'model' | 'news',
    slug: r.slug,
    title: r.title,
    published_at: new Date(r.published_at).toISOString(),
  }));
}

async function modelsRoute(ctx: RequestCtx, asOf: Date | null): Promise<void> {
  const models = await publishedModels(ctx, asOf);
  const cards = models
    .map(
      (m) => `<article class="catalogue-card" data-reveal="pending">
        <h2 class="card-title"><a href="/models/${escapeHtml(m.slug)}" data-continuity="${escapeHtml(m.title)}">${escapeHtml(m.title)}</a></h2>
        <p class="card-summary">${escapeHtml(m.summary)}</p>
        ${publicationTimesHtml(m.published_at as Date)}
      </article>`,
    )
    .join('\n');
  const banner = asOf ? asOfBanner(asOf, '/models') : '';
  sendHtml(ctx.res, 200, pageHtml({
    title: 'Model catalogue — Aldermoor Open Record',
    description: 'Every published model route of Aldermoor Labs.',
    body: `${banner}<section class="catalogue"><h1 class="display">Model catalogue</h1><div class="catalogue-grid">
${cards || '<p class="muted">No model routes are published yet.</p>'}
</div></section>`,
    bodyClass: 'public models',
  }), htmlPageHeaders(ctx.rateHeaders));
}

async function modelsApi(ctx: RequestCtx, asOf: Date | null): Promise<void> {
  const models = await publishedModels(ctx, asOf);
  const payload: Record<string, unknown> = {
    items: models.map((m) => ({
      slug: m.slug,
      title: m.title,
      summary: m.summary,
      published_at: m.published_at ? new Date(m.published_at).toISOString() : null,
    })),
  };
  if (asOf) payload.as_of = asOf.toISOString();
  sendJson(ctx.res, 200, payload, ctx.rateHeaders);
}

async function newsRoute(ctx: RequestCtx, asOf: Date | null): Promise<void> {
  const data = await newsroomData(ctx, ctx.query, asOf);
  const banner = asOf ? asOfBanner(asOf, '/news') : '';
  const subjectLinks = data.facets.subjects
    .map((s) => {
      const active = ctx.query.get('subject') === s.value;
      const href = newsroomHref({ subject: s.value, tag: ctx.query.get('tag'), asOf });
      return `<a class="facet-link${active ? ' current' : ''}" aria-current="${active ? 'true' : 'false'}" href="${href}">${escapeHtml(SUBJECT_LABELS[s.value as keyof typeof SUBJECT_LABELS] ?? s.value)} <span class="mono count">(${s.count})</span></a>`;
    })
    .join('\n');
  const tagLinks = data.facets.tags
    .map((t) => {
      const active = ctx.query.get('tag') === t.value;
      const href = newsroomHref({ subject: ctx.query.get('subject'), tag: t.value, asOf });
      return `<a class="facet-link${active ? ' current' : ''}" aria-current="${active ? 'true' : 'false'}" href="${href}">${escapeHtml(t.value)} <span class="mono count">(${t.count})</span></a>`;
    })
    .join('\n');
  const posts = data.items
    .map(
      (p) => `<article class="news-item" data-reveal="pending">
        <h2 class="news-title"><a href="/news/${escapeHtml(p.slug)}" data-continuity="${escapeHtml(p.title)}">${escapeHtml(p.title)}</a></h2>
        <p class="news-summary">${escapeHtml(p.summary)}</p>
        <p class="news-meta">${escapeHtml(SUBJECT_LABELS[p.subject as keyof typeof SUBJECT_LABELS] ?? p.subject)}${p.tags.length > 0 ? ` · ${p.tags.map(escapeHtml).join(', ')}` : ''} · ${publicationTimesHtml(new Date(p.published_at))} · ${readTimeHtml(p.read_time_minutes)}</p>
      </article>`,
    )
    .join('\n');
  const hasFilters = Boolean(ctx.query.get('subject') || ctx.query.get('tag'));
  const pages: string[] = [];
  for (let n = 1; n <= data.pages; n += 1) {
    pages.push(`<a class="page-link${n === data.page ? ' current' : ''}" href="${newsroomHref({ subject: ctx.query.get('subject'), tag: ctx.query.get('tag'), page: n, asOf })}"${n === data.page ? ' aria-current="page"' : ''}>${n}</a>`);
  }
  const prev = data.page > 1 ? `<a class="page-link" href="${newsroomHref({ subject: ctx.query.get('subject'), tag: ctx.query.get('tag'), page: data.page - 1, asOf })}" rel="prev">Previous page</a>` : '';
  const next = data.page < data.pages ? `<a class="page-link" href="${newsroomHref({ subject: ctx.query.get('subject'), tag: ctx.query.get('tag'), page: data.page + 1, asOf })}" rel="next">Next page</a>` : '';
  sendHtml(ctx.res, 200, pageHtml({
    title: 'Newsroom — Aldermoor Open Record',
    description: 'News and announcements from Aldermoor Labs.',
    body: `${banner}<section class="newsroom">
      <h1 class="display">Newsroom</h1>
      <div class="newsroom-layout">
        <div class="newsroom-facets">
          <nav class="facets" aria-label="Subjects">
            <h2>Subjects</h2>
            <a class="facet-link${!ctx.query.get('subject') ? ' current' : ''}" aria-current="${!ctx.query.get('subject') ? 'true' : 'false'}" href="${newsroomHref({ tag: ctx.query.get('tag'), asOf })}">All subjects</a>
            ${subjectLinks}
          </nav>
          <nav class="facets" aria-label="Tags">
            <h2>Tags</h2>
            <a class="facet-link${!ctx.query.get('tag') ? ' current' : ''}" aria-current="${!ctx.query.get('tag') ? 'true' : 'false'}" href="${newsroomHref({ subject: ctx.query.get('subject'), asOf })}">All tags</a>
            ${tagLinks}
          </nav>
          ${hasFilters ? `<a class="clear-filters" href="${newsroomHref({ asOf })}">Clear filters</a>` : ''}
        </div>
        <div class="newsroom-list">
          ${data.items.length === 0 ? '<p class="empty">No posts match these filters.</p>' + (hasFilters ? `<a class="clear-filters" href="${newsroomHref({ asOf })}">Clear filters</a>` : '') : `<ol class="news-list">${posts}</ol>`}
          ${data.pages > 1 ? `<nav class="pages" aria-label="Pages">${prev}${pages.join(' ')}${next}</nav>` : ''}
        </div>
      </div>
    </section>`,
    bodyClass: 'public newsroom',
  }), htmlPageHeaders(ctx.rateHeaders));
}

function newsroomHref(opts: { subject?: string | null; tag?: string | null; page?: number; asOf?: Date | null }): string {
  const params = new URLSearchParams();
  if (opts.subject) params.set('subject', opts.subject);
  if (opts.tag) params.set('tag', opts.tag);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts.asOf) params.set('as_of', opts.asOf.toISOString());
  const qs = params.toString();
  return qs ? `/news?${qs}` : '/news';
}

type NewsroomItem = {
  slug: string;
  title: string;
  summary: string;
  subject: string;
  tags: string[];
  published_at: string;
  read_time_minutes: number | null;
};

type NewsroomData = {
  items: NewsroomItem[];
  facets: { subjects: Array<{ value: string; label: string; count: number }>; tags: Array<{ value: string; count: number }> };
  page: number;
  pages: number;
  total: number;
};

async function newsroomData(
  ctx: RequestCtx,
  query: URLSearchParams,
  asOf: Date | null,
): Promise<NewsroomData> {
  const subject = query.get('subject');
  const tag = query.get('tag');
  const pageRaw = query.get('page');
  let page = 1;
  if (pageRaw !== null) {
    const n = Number(pageRaw);
    if (Number.isInteger(n) && n > 0) page = n;
  }
  const params: unknown[] = [];
  const where: string[] = [];
  if (asOf) {
    params.push(asOf.toISOString());
    where.push(`ph.published_at <= $${params.length}`);
  } else {
    where.push(`c.status = 'published'`);
  }
  where.push(`ph.withdrawn_at IS NULL`);
  where.push(`c.kind = 'news'`);
  if (subject) {
    params.push(subject);
    where.push(`c.subject = $${params.length}`);
  }
  if (tag) {
    params.push(tag);
    where.push(`c.tags ? $${params.length}`);
  }
  const whereSql = where.join(' AND ');
  const totalRows = await ctx.client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM content_items c JOIN publication_history ph ON ph.content_id = c.id WHERE ${whereSql}`,
    params,
  );
  const total = totalRows.rows[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;
  const rows = await ctx.client.query<ContentRow & { tags: unknown; claims: unknown }>(
    `SELECT c.* FROM content_items c JOIN publication_history ph ON ph.content_id = c.id
     WHERE ${whereSql}
     ORDER BY c.published_at DESC, c.slug ASC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params,
  );
  // Facets over the current record (or as-of set), matching the other filter.
  const subjectFacetParams: unknown[] = [];
  const subjectFacetWhere: string[] = [];
  if (asOf) {
    subjectFacetParams.push(asOf.toISOString());
    subjectFacetWhere.push(`ph.published_at <= $${subjectFacetParams.length}`);
  } else {
    subjectFacetWhere.push(`c.status = 'published'`);
  }
  subjectFacetWhere.push(`ph.withdrawn_at IS NULL`, `c.kind = 'news'`);
  if (tag) {
    subjectFacetParams.push(tag);
    subjectFacetWhere.push(`c.tags ? $${subjectFacetParams.length}`);
  }
  const subjectCounts = await ctx.client.query<{ subject: string; n: number }>(
    `SELECT c.subject, count(*)::int AS n FROM content_items c JOIN publication_history ph ON ph.content_id = c.id
     WHERE ${subjectFacetWhere.join(' AND ')} GROUP BY c.subject`,
    subjectFacetParams,
  );
  const subjectCountMap = new Map(subjectCounts.rows.map((r) => [r.subject, r.n]));

  const tagFacetParams: unknown[] = [];
  const tagFacetWhere: string[] = [];
  if (asOf) {
    tagFacetParams.push(asOf.toISOString());
    tagFacetWhere.push(`ph.published_at <= $${tagFacetParams.length}`);
  } else {
    tagFacetWhere.push(`c.status = 'published'`);
  }
  tagFacetWhere.push(`ph.withdrawn_at IS NULL`, `c.kind = 'news'`);
  if (subject) {
    tagFacetParams.push(subject);
    tagFacetWhere.push(`c.subject = $${tagFacetParams.length}`);
  }
  const tagRows = await ctx.client.query<{ tag: string; n: number }>(
    `SELECT t.tag, count(*)::int AS n FROM content_items c
     JOIN publication_history ph ON ph.content_id = c.id
     CROSS JOIN LATERAL jsonb_array_elements_text(c.tags) AS t(tag)
     WHERE ${tagFacetWhere.join(' AND ')} GROUP BY t.tag ORDER BY t.tag ASC`,
    tagFacetParams,
  );

  return {
    items: rows.rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      subject: r.subject ?? 'research',
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      published_at: new Date(r.published_at as Date).toISOString(),
      read_time_minutes: r.read_time_minutes,
    })),
    facets: {
      subjects: SUBJECTS.map((s) => ({
        value: s,
        label: SUBJECT_LABELS[s],
        count: subjectCountMap.get(s) ?? 0,
      })),
      tags: tagRows.rows.map((r) => ({ value: r.tag, count: r.n })),
    },
    page,
    pages,
    total,
  };
}

async function newsApi(ctx: RequestCtx, asOf: Date | null): Promise<void> {
  const data = await newsroomData(ctx, ctx.query, asOf);
  const payload: Record<string, unknown> = {
    items: data.items,
    facets: data.facets,
    page: data.page,
    pages: data.pages,
    total: data.total,
  };
  if (asOf) payload.as_of = asOf.toISOString();
  sendJson(ctx.res, 200, payload, ctx.rateHeaders);
}

async function searchRoute(ctx: RequestCtx, isApi: boolean): Promise<void> {
  const q = ctx.query.get('q') ?? '';
  const kind = ctx.query.get('kind');
  const cursor = ctx.query.get('cursor');
  const limitRaw = ctx.query.get('limit');
  let limit = isApi ? 10 : SEARCH_PAGE_SIZE;
  if (isApi && limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      throw errors.validation({ limit: 'Choose a limit from 1 to 50.' });
    }
    limit = n;
  }
  if (codePointsLength(q) < 1 || codePointsLength(q) > 200) {
    if (isApi && q !== '') {
      throw errors.validation({ q: 'Enter between 1 and 200 characters.' });
    }
  }
  const results = q === '' ? { items: [], nextCursor: null } : await runSearch(ctx.client, q, kind, cursor, limit);
  if (isApi) {
    sendJson(ctx.res, 200, {
      query: q,
      kind: kind ?? null,
      items: results.items,
      next_cursor: results.nextCursor,
    }, ctx.rateHeaders);
    return;
  }
  const kindLinks = [
    ['', 'All kinds'],
    ['model', 'Models'],
    ['news', 'News'],
    ['role', 'Roles'],
  ]
    .map(([value, label]) => {
      const active = (kind ?? '') === value;
      const href = value === '' ? searchHref({ q }) : searchHref({ q, kind: value });
      return `<a class="facet-link${active ? ' current' : ''}" aria-current="${active ? 'true' : 'false'}" href="${href}">${label}</a>`;
    })
    .join('\n');
  const items = results.items
    .map((item) => `<li class="search-result">
      <p class="result-kind">${item.kind === 'model' ? 'Model route' : item.kind === 'news' ? 'News post' : 'Role'}</p>
      <h2 class="result-title"><a href="${item.kind === 'model' ? `/models/${item.slug}` : item.kind === 'news' ? `/news/${item.slug}` : `/careers/${item.slug}`}">${escapeHtml(item.title)}</a></h2>
      <p class="result-meta">${escapeHtml(formatLondon(new Date(item.published_at)))}</p>
      <p class="result-fragment">${item.highlight}</p>
    </li>`)
    .join('\n');
  const moreHref = results.nextCursor ? searchHref({ q, kind: kind ?? undefined, cursor: results.nextCursor }) : null;
  const body = `<section class="search-page">
    <h1 class="display">Search the record</h1>
    <form class="search-form" role="search" aria-label="Search the record" action="/search" method="get">
      <input class="search-input" type="search" name="q" value="${escapeHtml(q)}" placeholder="Search the record" aria-label="Search terms" id="search-terms">
      <button class="button" type="submit">Search</button>
    </form>
    <div class="search-layout">
      <nav class="search-kinds facets" aria-label="Kinds">
        ${kindLinks}
      </nav>
      <div class="search-results-pane">
        <p class="status" id="search-status" role="status" aria-live="polite"></p>
        ${q === '' ? '<p class="muted">Enter terms to search the published record.</p>' : results.items.length === 0 ? `<p class="empty">Nothing in the published record matches “${escapeHtml(q)}”.</p>` : `<ol class="search-results">${items}</ol>`}
        ${moreHref ? `<a class="more-results" href="${moreHref}">More results</a>` : ''}
      </div>
    </div>
  </section>`;
  sendHtml(ctx.res, 200, pageHtml({
    title: 'Search — Aldermoor Open Record',
    description: 'Search the published record of Aldermoor Labs.',
    body,
    bodyClass: 'public search',
  }), htmlPageHeaders(ctx.rateHeaders));
}

function codePointsLength(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

function searchHref(opts: { q: string; kind?: string; cursor?: string }): string {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.kind) params.set('kind', opts.kind);
  if (opts.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

type SearchItem = {
  kind: 'model' | 'news' | 'role';
  slug: string;
  title: string;
  published_at: string;
  rank: number;
  highlight: string;
};

type SearchResult = { items: SearchItem[]; nextCursor: string | null };

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with']);

function stem(word: string): string {
  // A light English suffix stemmer for search.
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  for (const suffix of ['ies', 'ing', 'ed', 'es', 's', 'ly', 'er', 'ers']) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9']+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.toLowerCase())) !== null) {
    const token = m[0];
    if (!STOP_WORDS.has(token)) out.push(stem(token));
  }
  return out;
}

async function runSearch(
  client: import('../platform/db.js').DbClient,
  q: string,
  kind: string | null,
  cursor: string | null,
  limit: number,
): Promise<SearchResult> {
  // Parse query: quoted phrases, minus-excluded words, required words.
  const phrases: string[] = [];
  const words: string[] = [];
  const excluded: string[] = [];
  const phraseRe = /"([^"]+)"/g;
  let rest = q;
  let m: RegExpExecArray | null;
  while ((m = phraseRe.exec(q)) !== null) {
    phrases.push(m[1].toLowerCase());
  }
  rest = rest.replace(phraseRe, ' ');
  for (const raw of rest.split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('-') && raw.length > 1) {
      excluded.push(stem(raw.slice(1).toLowerCase()));
    } else {
      words.push(stem(raw.toLowerCase()));
    }
  }
  if (words.length === 0 && phrases.length === 0) {
    return { items: [], nextCursor: null };
  }
  const rows = await client.query<{
    kind: string;
    ref_id: string;
    title: string;
    summary: string;
    body: string;
    published_at: Date | null;
    slug: string | null;
  }>(
    `SELECT si.kind, si.ref_id, si.title, si.summary, si.body, si.published_at,
            (SELECT c.slug FROM content_items c WHERE si.kind IN ('model','news') AND c.id::text = si.ref_id) AS slug
     FROM search_index si WHERE si.live = true ORDER BY si.published_at DESC NULLS LAST`,
  );
  const scored: Array<{ item: SearchItem; sortKey: number }> = [];
  for (const row of rows.rows) {
    if (kind && row.kind !== kind) continue;
    const titleTokens = tokenize(row.title);
    const summaryTokens = tokenize(row.summary);
    const bodyTokens = tokenize(row.body);
    let rank = 0;
    let matchedAll = true;
    for (const phrase of phrases) {
      const hay = `${row.title} ${row.summary} ${row.body}`.toLowerCase();
      if (!hay.includes(phrase)) {
        matchedAll = false;
        break;
      }
      rank += 30;
    }
    if (!matchedAll) continue;
    for (const word of words) {
      const inTitle = titleTokens.includes(word);
      const inSummary = summaryTokens.includes(word);
      const inBody = bodyTokens.includes(word);
      if (!inTitle && !inSummary && !inBody) {
        matchedAll = false;
        break;
      }
      rank += inTitle ? 12 : 0;
      rank += inSummary ? 6 : 0;
      rank += inBody ? 3 : 0;
    }
    if (!matchedAll) continue;
    for (const ex of excluded) {
      if (titleTokens.includes(ex) || summaryTokens.includes(ex) || bodyTokens.includes(ex)) {
        matchedAll = false;
        break;
      }
    }
    if (!matchedAll) continue;
    scored.push({
      item: {
        kind: row.kind as SearchItem['kind'],
        slug: row.slug ?? row.ref_id,
        title: row.title,
        published_at: row.published_at ? new Date(row.published_at).toISOString() : '',
        rank,
        highlight: highlightPassage(row.summary, row.body, [...words, ...phrases]),
      },
      sortKey: rank,
    });
  }
  scored.sort((a, b) => {
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    const at = new Date(a.item.published_at).getTime();
    const bt = new Date(b.item.published_at).getTime();
    if (at !== bt) return bt - at;
    return a.item.slug.localeCompare(b.item.slug);
  });
  // Cursor: opaque offset bound to the query and kind.
  let offset = 0;
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    if (decoded === null || decoded.q !== q || (decoded.kind ?? null) !== (kind ?? null)) {
      throw errors.validation({ cursor: 'This cursor does not belong to this search.' });
    }
    offset = decoded.offset;
  }
  const page = scored.slice(offset, offset + limit);
  const next = offset + limit < scored.length ? encodeCursor({ q, kind: kind ?? undefined, offset: offset + limit }) : null;
  return {
    items: page.map((s) => s.item),
    nextCursor: next,
  };
}

function encodeCursor(value: { q: string; kind?: string; offset: number }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { q: string; kind?: string; offset: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.q !== 'string' || typeof parsed.offset !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function highlightPassage(summary: string, body: string, terms: string[]): string {
  const source = summary || body;
  const words = source.split(/\s+/).slice(0, 30);
  const escaped = words.map((word) => {
    const bare = word.replace(/[^A-Za-z0-9']/g, '').toLowerCase();
    const stemmed = stem(bare);
    const isMatch = terms.some((t) => stemmed === stem(t.replace(/[^A-Za-z0-9']/g, '').toLowerCase()) || bare === t.toLowerCase());
    return isMatch ? `<mark>${escapeHtml(word)}</mark>` : escapeHtml(word);
  });
  return escaped.join(' ');
}

export { searchRoute as searchPageRoute };
