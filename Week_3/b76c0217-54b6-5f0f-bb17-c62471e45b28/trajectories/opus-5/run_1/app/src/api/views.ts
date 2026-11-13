import { inviteByToken, teamById, type User } from '../db/accounts';
import {
  groupsOfVersion,
  importOfVersion,
  livePages,
  pageById,
  pagesOfVersion,
  redirectsOfVersion,
  siteBySlug,
  siteOfVersion,
  sitesOfTeam,
  tabsOfVersion,
  versionBySlug,
  versionsOfSite,
  type Page,
  type Site,
  type Version,
} from '../db/content';
import { db } from '../db/pool';
import { previewLinkByToken } from '../db/previews';
import { apiError } from '../http/errors';
import { sendHtml, sendRedirect, type Ctx } from '../http/http';
import { renderPageContent } from '../services/renderer';
import { editorPage } from '../ui/editor';
import { expiredPreviewPage, readerPage, type NavTab, type ReaderView } from '../ui/reader';
import {
  analyticsPage,
  forbiddenPage,
  homePage,
  invalidInvitePage,
  invitePage,
  redirectsPage,
  signInPage,
  teamPage,
} from '../ui/screens';
import { currentUser } from './auth';
import { pageDocument } from './documents';
import { inviteStatusOf } from './team';

async function draftTabs(versionId: string): Promise<NavTab[]> {
  const [tabs, groups, pages] = await Promise.all([
    tabsOfVersion(db, versionId),
    groupsOfVersion(db, versionId),
    pagesOfVersion(db, versionId),
  ]);
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    groups: groups
      .filter((group) => group.tabId === tab.id)
      .map((group) => ({
        id: group.id,
        title: group.title,
        pages: livePages(pages)
          .filter((page) => page.groupId === group.id)
          .map((page) => ({ id: page.id, title: page.title, path: page.path })),
      })),
  }));
}

async function requireSignedIn(ctx: Ctx): Promise<User | null> {
  const user = await currentUser(ctx);
  if (user === null) {
    sendRedirect(ctx, 302, `/signin?next=${encodeURIComponent(ctx.url.pathname)}`);
    return null;
  }
  return user;
}

interface EditorScope {
  site: Site;
  version: Version;
}

async function editorScope(ctx: Ctx, teamId: string): Promise<EditorScope> {
  const site = await siteBySlug(ctx.params.siteSlug);
  if (site === null || site.teamId !== teamId) throw apiError('not_found');
  const version = await versionBySlug(site.id, ctx.params.versionSlug);
  if (version === null) throw apiError('not_found');
  return { site, version };
}

export async function signInView(ctx: Ctx): Promise<void> {
  sendHtml(ctx, 200, signInPage(ctx.url.searchParams.get('next')));
}

export async function homeView(ctx: Ctx): Promise<void> {
  const user = await requireSignedIn(ctx);
  if (user === null) return;
  const [team, sites] = await Promise.all([teamById(user.teamId), sitesOfTeam(user.teamId)]);
  const cards = await Promise.all(
    sites.map(async (site) => ({
      slug: site.slug,
      title: site.title,
      versions: (await versionsOfSite(site.id)).map((version) => ({
        slug: version.slug,
        title: version.title,
        isDefault: version.isDefault,
        published: version.liveSnapshotId !== null,
      })),
    })),
  );
  sendHtml(
    ctx,
    200,
    homePage({
      user: { name: user.name, role: user.role },
      teamName: team === null ? 'Galley' : team.name,
      sites: cards,
    }),
  );
}

export async function editorFirstPageView(ctx: Ctx): Promise<void> {
  const user = await requireSignedIn(ctx);
  if (user === null) return;
  const { site, version } = await editorScope(ctx, user.teamId);
  const pages = livePages(await pagesOfVersion(db, version.id));
  if (pages.length === 0) throw apiError('not_found');
  sendRedirect(ctx, 302, `/app/sites/${site.slug}/${version.slug}/pages/${pages[0].path}`);
}

export async function editorPageView(ctx: Ctx): Promise<void> {
  const user = await requireSignedIn(ctx);
  if (user === null) return;
  const { site, version } = await editorScope(ctx, user.teamId);
  const pages = await pagesOfVersion(db, version.id);
  const page = livePages(pages).find((candidate) => candidate.path === ctx.params.pagePath);
  if (page === undefined) throw apiError('not_found');
  const [tabs, redirects, versions, imported] = await Promise.all([
    draftTabs(version.id),
    redirectsOfVersion(db, version.id),
    versionsOfSite(site.id),
    importOfVersion(version.id),
  ]);
  sendHtml(
    ctx,
    200,
    editorPage({
      user: { id: user.id, name: user.name, role: user.role },
      site: { id: site.id, slug: site.slug, title: site.title },
      version: { id: version.id, slug: version.slug, title: version.title },
      versions: versions.map((candidate) => ({
        id: candidate.id,
        slug: candidate.slug,
        title: candidate.title,
      })),
      tabs,
      page: await pageDocument(page),
      pageGroupId: page.groupId,
      redirects,
      source:
        imported === null
          ? null
          : { fileName: imported.fileName, bytes: imported.bytes, sha256: imported.sha256 },
    }),
  );
}

export async function redirectsView(ctx: Ctx): Promise<void> {
  const user = await requireSignedIn(ctx);
  if (user === null) return;
  const { site, version } = await editorScope(ctx, user.teamId);
  sendHtml(
    ctx,
    200,
    redirectsPage({
      user: { name: user.name, role: user.role },
      site: { slug: site.slug, title: site.title },
      version: { id: version.id, slug: version.slug, title: version.title },
    }),
  );
}

export async function analyticsView(ctx: Ctx): Promise<void> {
  const user = await requireSignedIn(ctx);
  if (user === null) return;
  const site = await siteBySlug(ctx.params.siteSlug);
  if (site === null || site.teamId !== user.teamId) throw apiError('not_found');
  sendHtml(
    ctx,
    200,
    analyticsPage({
      user: { name: user.name, role: user.role },
      site: { id: site.id, slug: site.slug, title: site.title },
    }),
  );
}

export async function teamView(ctx: Ctx): Promise<void> {
  const user = await requireSignedIn(ctx);
  if (user === null) return;
  if (user.role !== 'owner') {
    sendHtml(ctx, 403, forbiddenPage());
    return;
  }
  const team = await teamById(user.teamId);
  sendHtml(
    ctx,
    200,
    teamPage({
      user: { name: user.name, role: user.role },
      teamName: team === null ? 'Galley' : team.name,
    }),
  );
}

async function previewView(
  ctx: Ctx,
  site: Site,
  version: Version,
  page: Page,
  tabs: NavTab[],
  mode: 'preview' | 'shared',
): Promise<void> {
  const groups = await groupsOfVersion(db, version.id);
  const group = groups.find((candidate) => candidate.id === page.groupId);
  const content = await renderPageContent(page, site, version);
  const currentTab = tabs.find((tab) =>
    tab.groups.some((candidate) => candidate.pages.some((navPage) => navPage.id === page.id)),
  );
  const view: ReaderView = {
    siteSlug: site.slug,
    siteTitle: site.title,
    versionSlug: version.slug,
    versionTitle: version.title,
    versions: [{ slug: version.slug, title: version.title }],
    tabs,
    currentTabId: currentTab === undefined ? (tabs[0]?.id ?? null) : currentTab.id,
    page: {
      id: page.id,
      title: page.title,
      path: page.path,
      groupTitle: group === undefined ? '' : group.title,
      aboveTitle: content.aboveTitle,
      html: content.html,
      headings: content.headings,
    },
    mode,
    vote: null,
    fallbackNotice: null,
  };
  sendHtml(ctx, 200, readerPage(view));
}

export async function draftPreviewView(ctx: Ctx): Promise<void> {
  const user = await requireSignedIn(ctx);
  if (user === null) return;
  const { site, version } = await editorScope(ctx, user.teamId);
  const page = livePages(await pagesOfVersion(db, version.id)).find(
    (candidate) => candidate.path === ctx.params.pagePath,
  );
  if (page === undefined) throw apiError('not_found');
  await previewView(ctx, site, version, page, await draftTabs(version.id), 'preview');
}

/** A shared preview shows only its one draft page, without sign-in (DP-23). */
export async function sharedPreviewView(ctx: Ctx): Promise<void> {
  const link = await previewLinkByToken(ctx.params.token);
  const page = link === null ? null : await pageById(db, link.pageId);
  if (
    link === null ||
    page === null ||
    link.revoked ||
    link.expiresAt.getTime() <= Date.now() ||
    page.state === 'removed'
  ) {
    sendHtml(ctx, 410, expiredPreviewPage());
    return;
  }
  const scope = await siteOfVersion(page.versionId);
  if (scope === null) throw apiError('not_found');
  const groups = await groupsOfVersion(db, page.versionId);
  const group = groups.find((candidate) => candidate.id === page.groupId) as (typeof groups)[number];
  const tabs: NavTab[] = [
    {
      id: group.tabId,
      title: group.title,
      groups: [
        {
          id: group.id,
          title: group.title,
          pages: [{ id: page.id, title: page.title, path: page.path }],
        },
      ],
    },
  ];
  await previewView(ctx, scope.site, scope.version, page, tabs, 'shared');
}

export async function inviteView(ctx: Ctx): Promise<void> {
  const invite = await inviteByToken(ctx.params.token);
  if (invite === null) {
    sendHtml(ctx, 410, invalidInvitePage());
    return;
  }
  const status = inviteStatusOf(invite);
  if (status !== 'held' && status !== 'sent') {
    sendHtml(ctx, 410, invalidInvitePage());
    return;
  }
  const team = await teamById(invite.teamId);
  sendHtml(
    ctx,
    200,
    invitePage({ teamName: team === null ? 'Galley' : team.name, token: ctx.params.token }),
  );
}


