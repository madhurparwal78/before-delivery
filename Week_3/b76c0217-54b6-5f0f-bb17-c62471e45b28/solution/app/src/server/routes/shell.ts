import { copy } from '../../shared/copy';
import type { PageSummary } from '../../shared/types';
import { db } from '../db';
import { pageRoute, reply, type Reply, type Signed } from '../http';
import { loadInviteByToken } from '../domain/invites';
import { loadAnalytics } from '../domain/analytics';
import { loadNavigation } from '../domain/navigation';
import { loadPages, type PageRow } from '../domain/pages';
import { findOperation } from '../domain/reference';
import { renderPage } from '../domain/render';
import { versionBySlugs } from '../domain/scopes';
import { messageHtml } from '../views/document';
import { readerHtml } from '../views/reader';
import { readerModel } from '../views/reader-model';
import { shellHtml } from '../views/shell';
import { meJson } from './session';
import { sitesOfTeam } from './sites';
import { loadTeam } from './team';

const notFound = (): Reply =>
  reply.html(404, messageHtml({ title: 'Not found', heading: 'Nothing is filed here.', text: 'Check the address, or go back to the editor.', mark: 'strike' }));

const summary = (page: PageRow): PageSummary => ({ id: page.id, path: page.path, title: page.title, kind: page.kind });

/** The pages of the draft preview: the version's navigation as it is now, linking to the other previews. */
async function draftPreview(ctx: Signed): Promise<Reply> {
  const version = await versionBySlugs(ctx.principal, ctx.params.site ?? '', ctx.params.ver ?? '');
  if (version === null) {
    return notFound();
  }
  const path = ctx.params.path ?? '';
  const [pages, navigation] = await Promise.all([loadPages(db, version.id), loadNavigation(db, version.id)]);
  const page = pages.find((candidate) => candidate.path === path);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const operation = page?.operationId ? await findOperation(version.id, page.operationId) : null;
  const rendered = page ? renderPage(page.source, { siteSlug: version.siteSlug, versionSlug: version.slug, operation }) : null;
  const html = readerHtml(
    readerModel({
      mode: 'draft',
      documentTitle: page ? copy.documentTitle(page.title, version.siteTitle, version.title) : copy.notFoundTitle(version.siteTitle, version.title),
      site: { slug: version.siteSlug, title: version.siteTitle },
      version: { slug: version.slug, title: version.title },
      navigation: {
        tabs: navigation.tabs.map((tab) => ({
          id: tab.id,
          title: tab.title,
          groups: tab.groups.map((group) => ({
            id: group.id,
            title: group.title,
            pages: group.pages.flatMap((id) => {
              const entry = byId.get(id);
              return entry ? [{ id, title: entry.title, path: entry.path }] : [];
            }),
          })),
        })),
      },
      currentPageId: page?.id ?? null,
      hrefOf: (p) => `/app/sites/${version.siteSlug}/${version.slug}/preview/${p}`,
      versions: [],
      article: (groupTitle) =>
        page && rendered
          ? { kind: 'page', pageId: page.id, title: page.title, groupTitle, path: page.path, html: rendered.html, headings: rendered.headings, vote: null, operationId: page.operationId }
          : { kind: 'notfound' },
    }),
  );
  return reply.html(page ? 200 : 404, html);
}

export function shellRoutes(): void {
  pageRoute('/', { access: 'public', handle: async () => reply.redirect(302, '/app') });

  pageRoute('/signin', {
    access: 'public',
    handle: async (ctx) => reply.html(200, shellHtml('Sign in - Galley', { route: 'signin', next: ctx.url.searchParams.get('next') })),
  });

  pageRoute('/app', {
    access: 'member',
    handle: async (ctx) =>
      reply.html(200, shellHtml('Galley', { route: 'home', me: meJson(ctx.principal), sites: await sitesOfTeam(ctx.principal.teamId) })),
  });

  pageRoute('/app/team', {
    access: 'member',
    handle: async (ctx) =>
      ctx.principal.role === 'owner'
        ? reply.html(200, shellHtml('Team - Galley', { route: 'team', me: meJson(ctx.principal), sites: await sitesOfTeam(ctx.principal.teamId), team: await loadTeam(ctx.principal) }))
        : reply.html(403, messageHtml({ title: 'No access - Galley', heading: 'This screen is for owners.', text: copy.noAccess, mark: 'caret' })),
  });

  pageRoute('/app/sites/:site/analytics', {
    access: 'member',
    handle: async (ctx) => {
      const sites = await sitesOfTeam(ctx.principal.teamId);
      const site = sites.find((candidate) => candidate.slug === ctx.params.site);
      return site === undefined
        ? notFound()
        : reply.html(200, shellHtml('Analytics - Galley', { route: 'analytics', me: meJson(ctx.principal), sites, site, analytics: await loadAnalytics(site.id) }));
    },
  });

  for (const route of ['editor', 'redirects'] as const) {
    pageRoute(route === 'editor' ? '/app/sites/:site/:ver/pages/*path' : '/app/sites/:site/:ver/redirects', {
      access: 'member',
      handle: async (ctx) => {
        const scope = await versionBySlugs(ctx.principal, ctx.params.site ?? '', ctx.params.ver ?? '');
        if (scope === null) {
          return notFound();
        }
        const site = (await sitesOfTeam(ctx.principal.teamId)).find((candidate) => candidate.id === scope.siteId);
        const version = site?.versions.find((candidate) => candidate.id === scope.id);
        if (site === undefined || version === undefined) {
          return notFound();
        }
        const pages = (await loadPages(db, scope.id)).map(summary);
        const navigation = await loadNavigation(db, scope.id);
        const pagePath = ctx.params.path ?? null;
        if (route === 'editor' && pagePath === '') {
          const first = pages.find((candidate) => candidate.id === navigation.tabs.flatMap((tab) => tab.groups.flatMap((group) => group.pages))[0]);
          if (first) {
            return reply.redirect(302, `/app/sites/${scope.siteSlug}/${scope.slug}/pages/${first.path}`);
          }
        }
        const title = route === 'editor' ? (pages.find((candidate) => candidate.path === pagePath)?.title ?? 'Editor') : 'Redirects';
        return reply.html(200, shellHtml(`${title} - ${scope.siteTitle}`, { route, me: meJson(ctx.principal), site, version, pages, navigation, pagePath }));
      },
    });
  }

  pageRoute('/app/sites/:site/:ver/preview/*path', { access: 'member', handle: draftPreview });

  pageRoute('/invite/:token', {
    access: 'public',
    handle: async (ctx) => {
      const invite = await loadInviteByToken(ctx.params.token ?? '');
      const valid = invite !== null && (invite.status === 'held' || invite.status === 'sent');
      return reply.html(valid ? 200 : 410, shellHtml('Join Galley', { route: 'invite', invite: { teamName: invite?.teamName ?? '', valid, token: ctx.params.token ?? '' } }));
    },
  });
}
