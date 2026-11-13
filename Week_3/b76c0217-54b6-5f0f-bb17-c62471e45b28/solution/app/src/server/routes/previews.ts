import { copy } from '../../shared/copy';
import { db, one } from '../db';
import { endpoint, pageRoute, reply, type Reply } from '../http';
import { loadPage } from '../domain/pages';
import { findOperation } from '../domain/reference';
import { renderPage } from '../domain/render';
import { messageHtml } from '../views/document';
import { readerHtml } from '../views/reader';
import { readerModel } from '../views/reader-model';

interface SharedLink {
  pageId: string;
  siteSlug: string;
  siteTitle: string;
  versionSlug: string;
  versionTitle: string;
  versionId: string;
  groupId: string;
  groupTitle: string;
  tabId: string;
  tabTitle: string;
}

const expired = (): Reply =>
  reply.html(410, messageHtml({ title: `${copy.expiredPreview} - Galley`, heading: copy.expiredPreview, text: 'Ask the person who shared it for a new link.', mark: 'strike' }));

/** A shared preview shows one draft page, as it is when the link is opened, and nothing else of the site. */
async function sharedPreview(token: string): Promise<Reply> {
  const link = await one<SharedLink>(
    db,
    `select p.id as page_id, s.slug as site_slug, s.title as site_title, v.slug as version_slug, v.title as version_title, v.id as version_id,
            g.id as group_id, g.title as group_title, t.id as tab_id, t.title as tab_title
       from preview_links l join pages p on p.id = l.page_id join versions v on v.id = p.version_id join sites s on s.id = v.site_id
       join groups g on g.id = p.group_id join tabs t on t.id = g.tab_id
      where l.token = $1 and not l.revoked and l.expires_at > now() and not p.removed`,
    [token],
  );
  const page = link ? await loadPage(db, link.pageId) : null;
  if (link === null || page === null) {
    return expired();
  }
  const operation = page.operationId ? await findOperation(link.versionId, page.operationId) : null;
  const rendered = renderPage(page.source, { siteSlug: link.siteSlug, versionSlug: link.versionSlug, operation });
  return reply.html(
    200,
    readerHtml(
      readerModel({
        mode: 'shared',
        documentTitle: copy.documentTitle(page.title, link.siteTitle, link.versionTitle),
        site: { slug: link.siteSlug, title: link.siteTitle },
        version: { slug: link.versionSlug, title: link.versionTitle },
        navigation: {
          tabs: [{ id: link.tabId, title: link.tabTitle, groups: [{ id: link.groupId, title: link.groupTitle, pages: [{ id: page.id, title: page.title, path: page.path }] }] }],
        },
        currentPageId: page.id,
        hrefOf: () => `/preview/${token}`,
        versions: [],
        article: (groupTitle) => ({
          kind: 'page',
          pageId: page.id,
          title: page.title,
          groupTitle,
          path: page.path,
          html: rendered.html,
          headings: rendered.headings,
          vote: null,
          operationId: page.operationId,
        }),
      }),
    ),
  );
}

export function previewRoutes(): void {
  pageRoute('/preview/:token', { access: 'public', handle: async (ctx) => sharedPreview(ctx.params.token ?? '') });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    endpoint(method, '/preview/:token', {
      access: 'public',
      handle: async () => reply.empty(405, { Allow: 'GET, HEAD' }),
    });
  }
}
