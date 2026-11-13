import { copy } from '../../shared/copy';
import { db, one } from '../db';
import { fail } from '../errors';
import { newId } from '../ids';
import { emit, openReaderStream } from '../events';
import { cookies, endpoint, pageRoute, reply, readerCookie, type Ctx, type Reply } from '../http';
import { Fields } from '../input';
import { READER_COOKIE } from '../auth';
import { resolvePath } from '../domain/redirects';
import { searchPages, type IndexedPage } from '../domain/search';
import { findOperation } from '../domain/reference';
import { getObject, StorageUnavailableError } from '../storage';
import { readerHtml } from '../views/reader';
import { readerModel } from '../views/reader-model';
import type { ReaderBoot, RedirectJson, SearchResponse } from '../../shared/types';
import type { HeadingInfo } from '../domain/markdown';

interface Manifest {
  pages: { pageId: string; path: string; title: string }[];
  navigation: { tabs: { id: string; title: string; groups: { id: string; title: string; pages: string[] }[] }[]; redirects: RedirectJson[] };
}

interface Live {
  siteId: string;
  teamId: string;
  siteSlug: string;
  siteTitle: string;
  versionId: string;
  versionSlug: string;
  versionTitle: string;
  snapshotId: string;
  manifest: Manifest;
}

/** The published version a public address names, as its live snapshot. */
async function liveVersion(siteSlug: string, versionSlug: string): Promise<Live | null> {
  const row = await one<Omit<Live, 'manifest'> & { manifest: string }>(
    db,
    `select s.id as site_id, s.team_id, s.slug as site_slug, s.title as site_title, v.id as version_id, v.slug as version_slug,
            v.title as version_title, v.live_snapshot_id as snapshot_id, n.manifest
       from sites s join versions v on v.site_id = s.id join snapshots n on n.id = v.live_snapshot_id
      where s.slug = $1 and v.slug = $2`,
    [siteSlug, versionSlug],
  );
  return row === null ? null : { ...row, manifest: JSON.parse(row.manifest) as Manifest };
}

const docsPath = (live: Pick<Live, 'siteSlug' | 'versionSlug'>, path: string): string => `/docs/${live.siteSlug}/${live.versionSlug}/${path}`;

function firstPath(live: Live): string | undefined {
  const firstId = live.manifest.navigation.tabs.flatMap((t) => t.groups.flatMap((g) => g.pages))[0];
  return live.manifest.pages.find((p) => p.pageId === firstId)?.path;
}

function navSource(live: Live): Parameters<typeof readerModel>[0]['navigation'] {
  const byId = new Map(live.manifest.pages.map((p) => [p.pageId, p]));
  return {
    tabs: live.manifest.navigation.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      groups: tab.groups.map((group) => ({
        id: group.id,
        title: group.title,
        pages: group.pages.flatMap((id) => {
          const page = byId.get(id);
          return page ? [{ id, title: page.title, path: page.path }] : [];
        }),
      })),
    })),
  };
}

async function versionChoices(live: Live, path: string | null): Promise<ReaderBoot['versions']> {
  const rows = await db.query<{ slug: string; title: string; samePath: string | null; firstPath: string | null }>(
    `select v.slug, v.title,
            (select path from snapshot_pages where snapshot_id = v.live_snapshot_id and path = $2) as same_path,
            (select path from snapshot_pages where snapshot_id = v.live_snapshot_id order by position limit 1) as first_path
       from versions v where v.site_id = $1 and v.live_snapshot_id is not null order by v.created_at, v.id`,
    [live.siteId, path],
  );
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    current: row.slug === live.versionSlug,
    href: `/docs/${live.siteSlug}/${row.slug}/${row.samePath ?? row.firstPath ?? ''}`,
    fallback: row.samePath === null,
  }));
}

async function docsPage(ctx: Ctx): Promise<Reply> {
  const live = await liveVersion(ctx.params.site ?? '', ctx.params.ver ?? '');
  if (live === null) {
    return reply.html(404, readerHtml(missingModel(ctx.params.site ?? '', ctx.params.ver ?? '')));
  }
  const path = (ctx.params.path ?? '').replace(/\/+$/, '');
  if (path === '') {
    const first = firstPath(live);
    return first === undefined ? notFound(live) : reply.redirect(302, docsPath(live, first));
  }
  const resolution = resolvePath(live.manifest.navigation.redirects, (candidate) => live.manifest.pages.some((p) => `/${p.path}` === candidate), `/${path}`);
  if (resolution.kind === 'redirect') {
    return reply.redirect(308, docsPath(live, resolution.to.replace(/^\//, '')));
  }
  const page = await one<{ pageId: string; title: string; html: string; headings: string; groupTitle: string; operationId: string | null }>(
    db,
    'select page_id, title, html, headings, group_title, operation_id from snapshot_pages where snapshot_id = $1 and path = $2',
    [live.snapshotId, path],
  );
  if (resolution.kind === 'missing' || page === null) {
    return notFound(live, path);
  }
  const reader = cookies(ctx.req)[READER_COOKIE];
  const vote = reader ? await one<{ vote: 'yes' | 'no' }>(db, 'select vote from votes where page_id = $1 and reader = $2', [page.pageId, reader]) : null;
  return reply.html(
    200,
    readerHtml(
      readerModel({
        mode: 'public',
        documentTitle: copy.documentTitle(page.title, live.siteTitle, live.versionTitle),
        site: { slug: live.siteSlug, title: live.siteTitle },
        version: { slug: live.versionSlug, title: live.versionTitle },
        navigation: navSource(live),
        currentPageId: page.pageId,
        hrefOf: (p) => docsPath(live, p),
        versions: await versionChoices(live, path),
        article: (groupTitle) => ({
          kind: 'page',
          pageId: page.pageId,
          title: page.title,
          groupTitle,
          path,
          html: page.html,
          headings: JSON.parse(page.headings) as HeadingInfo[],
          vote: vote?.vote ?? null,
          operationId: page.operationId,
        }),
      }),
    ),
  );
}

async function notFound(live: Live, path: string | null = null): Promise<Reply> {
  return reply.html(
    404,
    readerHtml(
      readerModel({
        mode: 'public',
        documentTitle: copy.notFoundTitle(live.siteTitle, live.versionTitle),
        site: { slug: live.siteSlug, title: live.siteTitle },
        version: { slug: live.versionSlug, title: live.versionTitle },
        navigation: navSource(live),
        currentPageId: null,
        hrefOf: (p) => docsPath(live, p),
        versions: await versionChoices(live, path),
        article: () => ({ kind: 'notfound' }),
      }),
    ),
  );
}

/** An address that names no published version still gets the not-found page, without a sidebar. */
function missingModel(siteSlug: string, versionSlug: string): Parameters<typeof readerHtml>[0] {
  return readerModel({
    mode: 'public',
    documentTitle: 'Page not found',
    site: { slug: siteSlug, title: siteSlug },
    version: { slug: versionSlug, title: versionSlug },
    navigation: { tabs: [] },
    currentPageId: null,
    hrefOf: () => '#',
    versions: [],
    article: () => ({ kind: 'notfound' }),
  });
}

async function searchOf(live: Live, query: string): Promise<SearchResponse> {
  const rows = await db.query<{ pageId: string; path: string; title: string; groupTitle: string; headings: string; bodyText: string }>(
    'select page_id, path, title, group_title, headings, body_text from snapshot_pages where snapshot_id = $1 order by position',
    [live.snapshotId],
  );
  const pages: IndexedPage[] = rows.map((row) => ({
    pageId: row.pageId,
    path: row.path,
    title: row.title,
    groupTitle: row.groupTitle,
    headings: JSON.parse(row.headings) as HeadingInfo[],
    bodyText: row.bodyText,
  }));
  const results = searchPages(pages, query, (path) => docsPath(live, path));
  return { query: query.trim(), count: results.length, results };
}

async function liveOr404(ctx: Ctx): Promise<Live> {
  const live = await liveVersion(ctx.params.site ?? '', ctx.params.ver ?? '');
  if (live === null) {
    throw fail.notFound();
  }
  return live;
}

export function publicRoutes(): void {
  pageRoute('/docs/:site', {
    access: 'public',
    handle: async (ctx) => {
      const site = await one<{ id: string; slug: string }>(db, 'select id, slug from sites where slug = $1', [ctx.params.site]);
      const version = site ? await one<{ slug: string }>(db, 'select slug from versions where site_id = $1 and is_default and live_snapshot_id is not null', [site.id]) : null;
      const live = site && version ? await liveVersion(site.slug, version.slug) : null;
      const first = live ? firstPath(live) : undefined;
      return live && first !== undefined ? reply.redirect(302, docsPath(live, first)) : reply.html(404, readerHtml(missingModel(ctx.params.site ?? '', '')));
    },
  });

  endpoint('GET', '/docs/:site/events', {
    access: 'public',
    prepare: async (ctx) => {
      if ((await one(db, 'select 1 as x from sites where slug = $1', [ctx.params.site])) === null) {
        throw fail.notFound();
      }
    },
    handle: async (ctx) => reply.stream((sink) => openReaderStream(sink, ctx.params.site ?? '')),
  });

  endpoint('GET', '/docs/:site/:ver/search', {
    access: 'public',
    prepare: liveOr404,
    handle: async (ctx, live) => reply.json(200, await searchOf(live, ctx.url.searchParams.get('q') ?? '')),
  });

  endpoint('POST', '/docs/:site/:ver/search-terms', {
    access: 'public',
    body: 'json',
    prepare: liveOr404,
    handle: async (ctx, live) => {
      const fields = new Fields(ctx.json);
      const term = fields.text('term', 200).toLowerCase();
      if (term.length < 2) {
        fields.problems.term = 'Search terms have at least 2 characters.';
      }
      fields.check();
      const { count } = await searchOf(live, term);
      await db.query('insert into search_records (site_id, version_id, term, results) values ($1, $2, $3, $4)', [live.siteId, live.versionId, term, count]);
      emit('analytics', { siteId: live.siteId }, { teamId: live.teamId });
      return reply.json(201, { term, results: count });
    },
  });

  endpoint('PUT', '/docs/:site/ratings/:pageId', {
    access: 'public',
    body: 'json',
    prepare: async (ctx) => {
      const page = await one<{ siteId: string; teamId: string }>(
        db,
        `select s.id as site_id, s.team_id from pages p join versions v on v.id = p.version_id join sites s on s.id = v.site_id
          where p.id = $1 and s.slug = $2`,
        [ctx.params.pageId, ctx.params.site],
      );
      if (page === null) {
        throw fail.notFound();
      }
      return page;
    },
    handle: async (ctx, site) => {
      const vote = ctx.json.vote;
      if (vote !== null && vote !== 'yes' && vote !== 'no') {
        throw fail.validation({ vote: 'Vote yes, no or null.' });
      }
      const known = cookies(ctx.req)[READER_COOKIE];
      const reader = known ?? newId('rdr');
      if (vote === null) {
        await db.query('delete from votes where page_id = $1 and reader = $2', [ctx.params.pageId, reader]);
      } else {
        await db.query(
          'insert into votes (page_id, reader, vote) values ($1, $2, $3) on conflict (page_id, reader) do update set vote = excluded.vote',
          [ctx.params.pageId, reader, vote],
        );
      }
      emit('analytics', { siteId: site.siteId }, { teamId: site.teamId });
      return reply.json(200, { pageId: ctx.params.pageId, vote }, known ? {} : { 'Set-Cookie': readerCookie(reader) });
    },
  });

  pageRoute('/docs/:site/:ver/*path', { access: 'public', handle: docsPage });

  endpoint('GET', '/assets/:siteSlug/:imageId', {
    access: 'public',
    handle: async (ctx) => {
      const image = await one<{ siteId: string; contentType: string }>(
        db,
        'select a.site_id, a.content_type from assets a join sites s on s.id = a.site_id where a.id = $1 and s.slug = $2',
        [ctx.params.imageId, ctx.params.siteSlug],
      );
      if (image === null) {
        throw fail.notFound();
      }
      try {
        const bytes = await getObject(`sites/${image.siteId}/assets/${ctx.params.imageId}`);
        if (bytes === null) {
          throw fail.notFound();
        }
        return reply.bytes(200, bytes, image.contentType, { 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      } catch (error) {
        if (error instanceof StorageUnavailableError) {
          throw fail.storageUnavailable('File storage is unavailable.');
        }
        throw error;
      }
    },
  });

  endpoint('POST', '/api/mock/:site/:ver/:operationId', {
    access: 'public',
    body: 'json',
    prepare: liveOr404,
    handle: async (ctx, live) => {
      const operation = await findOperation(live.versionId, ctx.params.operationId ?? '');
      if (operation === null) {
        throw fail.notFound();
      }
      const given = ctx.json.parameters;
      const parameters: Record<string, unknown> = typeof given === 'object' && given !== null && !Array.isArray(given) ? (given as Record<string, unknown>) : {};
      const problems: Record<string, string> = {};
      for (const parameter of operation.parameters.filter((p) => p.required)) {
        const value = parameters[parameter.name];
        if (typeof value !== 'string' || value.trim() === '') {
          problems[parameter.name] = copy.requiredParameter(parameter.name);
        }
      }
      if (operation.hasRequestBody) {
        try {
          JSON.parse(typeof ctx.json.body === 'string' ? ctx.json.body : '');
        } catch {
          problems.body = copy.invalidBody;
        }
      }
      if (Object.keys(problems).length > 0) {
        throw fail.validation(problems);
      }
      const code = ctx.json.code;
      const response = operation.responses.find((r) => r.code === code);
      if (response === undefined) {
        throw fail.mockUnknownCode();
      }
      return reply.json(response.code, response.example ?? null);
    },
  });
}
