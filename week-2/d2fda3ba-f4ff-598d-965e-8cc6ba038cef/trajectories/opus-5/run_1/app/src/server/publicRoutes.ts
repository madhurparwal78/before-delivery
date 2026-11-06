import { PUBLIC_COPY } from '../shared/copy';
import {
  renderPageDocument,
  searchPageInput,
  type NavEntry,
  type SearchHit,
  type SearchIndexEntry,
} from '../shared/dossier';
import { escapeHtml } from '../shared/markdown';
import { formatDisplayTime } from '../shared/time';
import { hashToken } from './auth';
import type { Reply, Router } from './http';
import { previewLinkState, type PreviewLinkRow } from './serialize';
import type { Services } from './services';
import { previewObjectKey, publishObjectKey, StorageUnavailableError } from './storage';
import type { PageRecord } from './publish';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

function publicHeaders(preview: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'cache-control': 'no-cache',
    'content-security-policy': CSP,
  };
  if (preview) headers['x-robots-tag'] = 'noindex';
  return headers;
}

function noticePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/reader.css" />
</head>
<body>
<main class="reader notice">
<h1 class="dossier-heading">${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</main>
</body>
</html>
`;
}

function htmlReply(status: number, body: string, preview: boolean): Reply {
  return { status, body, contentType: 'text/html; charset=utf-8', headers: publicHeaders(preview) };
}

function notFoundPage(preview: boolean): Reply {
  return htmlReply(404, noticePage('Not available', PUBLIC_COPY.notFound), preview);
}

function endedLinkPage(): Reply {
  return htmlReply(410, noticePage('Preview link ended', PUBLIC_COPY.endedLink), true);
}

function outagePage(preview: boolean): Reply {
  return htmlReply(503, noticePage('Temporarily unavailable', PUBLIC_COPY.storageUnavailable), preview);
}

interface LiveDossier {
  slug: string;
  publishId: string;
  pages: PageRecord[];
  publishedAt: Date | null;
  ownerTimeZone: string;
}

interface LivePreview {
  linkId: string;
  pages: PageRecord[];
}

export function registerPublicRoutes(router: Router, services: Services): void {
  const { db } = services;

  const liveDossier = async (slug: string | undefined): Promise<LiveDossier | null> => {
    if (!slug) return null;
    const row = await db.one<{
      slug: string;
      live_publish_id: string | null;
      pages: PageRecord[] | null;
      published_at: Date | null;
      time_zone: string;
    }>(
      `select d.slug, d.live_publish_id, m.pages, d.published_at, a.time_zone
         from dossiers d
         join accounts a on a.id = d.account_id
         left join publish_manifests m on m.publish_id = d.live_publish_id
        where d.slug = $1 and d.state = 'published'`,
      [slug],
    );
    if (!row?.live_publish_id || !row.pages) return null;
    return {
      slug: row.slug,
      publishId: row.live_publish_id,
      pages: row.pages,
      publishedAt: row.published_at,
      ownerTimeZone: row.time_zone,
    };
  };

  const livePreview = async (
    token: string | undefined,
  ): Promise<{ preview: LivePreview | null; ended: boolean }> => {
    if (!token) return { preview: null, ended: false };
    const row = await db.one<PreviewLinkRow & { pages: PageRecord[] }>(
      'select id, dossier_id, state, created_at, expires_at, pages from preview_links where token_hash = $1',
      [hashToken(token)],
    );
    if (!row) return { preview: null, ended: false };
    if (previewLinkState(row, new Date()) !== 'active') return { preview: null, ended: true };
    return { preview: { linkId: row.id, pages: row.pages }, ended: false };
  };

  const readObject = async (key: string, preview: boolean): Promise<Reply> => {
    try {
      const stored = await services.store.get(key);
      if (!stored) return notFoundPage(preview);
      return {
        status: 200,
        body: stored.body,
        contentType: stored.contentType,
        headers: publicHeaders(preview),
      };
    } catch (error) {
      if (error instanceof StorageUnavailableError) return outagePage(preview);
      throw error;
    }
  };

  const readSearchIndex = async (dossier: LiveDossier): Promise<SearchIndexEntry[] | null> => {
    const stored = await services.store.get(publishObjectKey(dossier.slug, dossier.publishId, 'search-index.json'));
    if (!stored) return null;
    const parsed = JSON.parse(stored.body.toString('utf8')) as { pages?: SearchIndexEntry[] };
    return parsed.pages ?? [];
  };

  router.add('GET', '/d/:slug', async (ctx) => {
    const dossier = await liveDossier(ctx.params.slug);
    if (!dossier) return notFoundPage(false);
    return readObject(publishObjectKey(dossier.slug, dossier.publishId, 'index.html'), false);
  });

  router.add('GET', '/d/:slug/search', async (ctx) => {
    const dossier = await liveDossier(ctx.params.slug);
    if (!dossier) return notFoundPage(false);
    const query = ctx.query.get('q') ?? '';
    try {
      const index = await readSearchIndex(dossier);
      if (!index) return notFoundPage(false);
      const needle = query.trim().toLowerCase();
      const hits: SearchHit[] =
        needle.length === 0
          ? []
          : index
              .filter(
                (entry) =>
                  entry.title.toLowerCase().includes(needle) || entry.text.toLowerCase().includes(needle),
              )
              .map((entry) => ({ title: entry.title, href: entry.path }));
      const nav: NavEntry[] = index
        .map((entry) => ({ title: entry.title, href: entry.path }))
        .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
      const basePath = `/d/${dossier.slug}/`;
      const rootTitle = index.find((entry) => entry.path === basePath)?.title ?? dossier.slug;
      const input = searchPageInput(
        basePath,
        rootTitle,
        nav,
        query,
        hits.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)),
        PUBLIC_COPY.publishedFooter(
          dossier.publishedAt ? formatDisplayTime(dossier.publishedAt, dossier.ownerTimeZone) : '',
          index.length,
        ),
        null,
        PUBLIC_COPY.noSearchResults(query),
      );
      return htmlReply(200, renderPageDocument(input), false);
    } catch (error) {
      if (error instanceof StorageUnavailableError) return outagePage(false);
      throw error;
    }
  });

  router.add('GET', '/d/:slug/assets/:file', async (ctx) => {
    const dossier = await liveDossier(ctx.params.slug);
    if (!dossier) return notFoundPage(false);
    return readObject(publishObjectKey(dossier.slug, dossier.publishId, `assets/${ctx.params.file ?? ''}`), false);
  });

  router.add('GET', '/d/:slug/:page', async (ctx) => {
    const dossier = await liveDossier(ctx.params.slug);
    if (!dossier) return notFoundPage(false);
    const page = ctx.params.page ?? '';
    if (page === 'sitemap.xml' || page === 'search-index.json' || page === 'previews.json') {
      return readObject(publishObjectKey(dossier.slug, dossier.publishId, page), false);
    }
    if (!dossier.pages.some((entry) => entry.page_slug === page)) return notFoundPage(false);
    return readObject(publishObjectKey(dossier.slug, dossier.publishId, `pages/${page}.html`), false);
  });

  router.add('GET', '/p/:token', async (ctx) => {
    const { preview, ended } = await livePreview(ctx.params.token);
    if (ended) return endedLinkPage();
    if (!preview) return notFoundPage(true);
    return readObject(previewObjectKey(preview.linkId, 'index.html'), true);
  });

  router.add('GET', '/p/:token/assets/:file', async (ctx) => {
    const { preview, ended } = await livePreview(ctx.params.token);
    if (ended) return endedLinkPage();
    if (!preview) return notFoundPage(true);
    return readObject(previewObjectKey(preview.linkId, `assets/${ctx.params.file ?? ''}`), true);
  });

  router.add('GET', '/p/:token/:page', async (ctx) => {
    const { preview, ended } = await livePreview(ctx.params.token);
    if (ended) return endedLinkPage();
    if (!preview) return notFoundPage(true);
    const page = ctx.params.page ?? '';
    if (page === 'previews.json') return readObject(previewObjectKey(preview.linkId, page), true);
    if (!preview.pages.some((entry) => entry.page_slug === page)) return notFoundPage(true);
    return readObject(previewObjectKey(preview.linkId, `pages/${page}.html`), true);
  });
}
