import { siteBySlug, versionBySlug, versionsOfSite, type Site, type Version } from '../db/content';
import { newId } from '../db/ids';
import { recordSearch, setVote, snapshotById, snapshotPages, voteOf, type SnapshotPage } from '../db/publishing';
import { readerMessages } from '../domain/messages';
import { resolvePublicPath, type Redirect } from '../domain/redirects';
import { searchPages, type SearchablePage } from '../domain/search';
import { withSlash } from '../domain/paths';
import { apiError, validationFailed } from '../http/errors';
import {
  cookies,
  readJsonBody,
  sendHtml,
  sendJson,
  sendRedirect,
  setCookie,
  str,
  type Ctx,
} from '../http/http';
import { emitAnalytics, openStream } from '../services/events';
import {
  notFoundPage,
  readerPage,
  type NavTab,
  type ReaderView,
  type VersionChoice,
} from '../ui/reader';
import { READER_COOKIE } from './auth';
import type { NavigationDocument } from './documents';

interface LiveVersion {
  site: Site;
  version: Version;
  navigation: NavigationDocument;
  pages: SnapshotPage[];
  versions: VersionChoice[];
}

async function loadLive(siteSlug: string, versionSlug: string): Promise<LiveVersion | null> {
  const site = await siteBySlug(siteSlug);
  if (site === null) return null;
  const version = await versionBySlug(site.id, versionSlug);
  if (version === null || version.liveSnapshotId === null) return null;
  const snapshot = await snapshotById(version.liveSnapshotId);
  if (snapshot === null) return null;
  const [pages, versions] = await Promise.all([
    snapshotPages(snapshot.id),
    versionsOfSite(site.id),
  ]);
  return {
    site,
    version,
    navigation: snapshot.navigation as NavigationDocument,
    pages,
    versions: versions
      .filter((candidate) => candidate.liveSnapshotId !== null)
      .map((candidate) => ({ slug: candidate.slug, title: candidate.title })),
  };
}

function navTabs(live: LiveVersion): NavTab[] {
  const byId = new Map(live.pages.map((page) => [page.pageId, page]));
  return live.navigation.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    groups: tab.groups.map((group) => ({
      id: group.id,
      title: group.title,
      pages: group.pages
        .map((pageId) => byId.get(pageId))
        .filter((page): page is SnapshotPage => page !== undefined)
        .map((page) => ({ id: page.pageId, title: page.title, path: page.path })),
    })),
  }));
}

const orderedPages = (live: LiveVersion): SnapshotPage[] =>
  navTabs(live)
    .flatMap((tab) => tab.groups.flatMap((group) => group.pages))
    .map((navPage) => live.pages.find((page) => page.pageId === navPage.id) as SnapshotPage);

const searchable = (live: LiveVersion): SearchablePage[] =>
  orderedPages(live).map((page) => ({
    pageId: page.pageId,
    title: page.title,
    path: page.path,
    groupTitle: page.groupTitle,
    headings: page.headings
      .filter((heading) => heading.anchor !== null)
      .map((heading) => ({ text: heading.text, anchor: heading.anchor as string })),
    bodyText: page.bodyText,
  }));

function renderNotFound(live: LiveVersion): string {
  return notFoundPage({
    siteSlug: live.site.slug,
    siteTitle: live.site.title,
    versionSlug: live.version.slug,
    versionTitle: live.version.title,
    versions: live.versions,
    tabs: navTabs(live),
  });
}

function readerViewOf(
  live: LiveVersion,
  page: SnapshotPage,
  vote: 'yes' | 'no' | null,
  fallbackNotice: string | null,
): ReaderView {
  const tabs = navTabs(live);
  const currentTab = tabs.find((tab) =>
    tab.groups.some((group) => group.pages.some((navPage) => navPage.id === page.pageId)),
  );
  return {
    siteSlug: live.site.slug,
    siteTitle: live.site.title,
    versionSlug: live.version.slug,
    versionTitle: live.version.title,
    versions: live.versions,
    tabs,
    currentTabId: currentTab === undefined ? null : currentTab.id,
    page: {
      id: page.pageId,
      title: page.title,
      path: page.path,
      groupTitle: page.groupTitle,
      aboveTitle: '',
      html: page.html,
      headings: page.headings,
    },
    mode: 'public',
    vote,
    fallbackNotice,
  };
}

export async function docsRoot(ctx: Ctx): Promise<void> {
  const site = await siteBySlug(ctx.params.siteSlug);
  if (site === null) throw apiError('not_found');
  const versions = await versionsOfSite(site.id);
  const fallback = versions.find((version) => version.isDefault);
  if (fallback === undefined || fallback.liveSnapshotId === null) throw apiError('not_found');
  const live = await loadLive(site.slug, fallback.slug);
  if (live === null) throw apiError('not_found');
  const first = orderedPages(live)[0];
  if (first === undefined) throw apiError('not_found');
  sendRedirect(ctx, 302, `/docs/${site.slug}/${fallback.slug}/${first.path}`);
}

export async function docsPage(ctx: Ctx): Promise<void> {
  const live = await loadLive(ctx.params.siteSlug, ctx.params.versionSlug);
  if (live === null) throw apiError('not_found');
  const path = withSlash(ctx.params.pagePath);
  const livePaths = new Set(live.pages.map((page) => withSlash(page.path)));
  const redirects: Redirect[] = live.navigation.redirects;
  const resolution = resolvePublicPath(redirects, livePaths, path);
  if (resolution.kind === 'redirect') {
    sendRedirect(
      ctx,
      308,
      `/docs/${live.site.slug}/${live.version.slug}${resolution.to}`,
    );
    return;
  }
  const readerId = cookies(ctx)[READER_COOKIE] ?? null;
  if (resolution.kind === 'missing') {
    const fromVersion = ctx.url.searchParams.get('from');
    const first = orderedPages(live)[0];
    if (fromVersion === null || first === undefined) {
      sendHtml(ctx, 404, renderNotFound(live));
      return;
    }
    const previous = await loadLive(live.site.slug, fromVersion);
    const left =
      previous === null
        ? undefined
        : previous.pages.find((page) => withSlash(page.path) === path);
    const notice = readerMessages.versionFallback(
      left === undefined ? path : left.title,
      live.version.title,
    );
    const vote = readerId === null ? null : await voteOf(readerId, first.pageId);
    sendHtml(ctx, 200, readerPage(readerViewOf(live, first, vote, notice)));
    return;
  }
  const page = live.pages.find((candidate) => withSlash(candidate.path) === path) as SnapshotPage;
  const vote = readerId === null ? null : await voteOf(readerId, page.pageId);
  sendHtml(ctx, 200, readerPage(readerViewOf(live, page, vote, null)));
}

export async function docsSearch(ctx: Ctx): Promise<void> {
  const live = await loadLive(ctx.params.siteSlug, ctx.params.versionSlug);
  if (live === null) throw apiError('not_found');
  const query = (ctx.url.searchParams.get('q') ?? '').trim();
  const results = searchPages(searchable(live), query, (path, anchor) =>
    `/docs/${live.site.slug}/${live.version.slug}/${path}${anchor === null ? '' : `#${anchor}`}`,
  );
  sendJson(ctx, 200, { query, count: results.length, results });
}

export async function docsSearchTerms(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const live = await loadLive(ctx.params.siteSlug, ctx.params.versionSlug);
  if (live === null) throw apiError('not_found');
  const term = (str(body, 'term') ?? '').trim().toLowerCase();
  if (term.length < 2) throw validationFailed({ term: 'Search terms are 2 or more characters.' });
  const results = searchPages(searchable(live), term, () => '').length;
  await recordSearch({
    siteId: live.site.id,
    versionId: live.version.id,
    term,
    results,
  });
  emitAnalytics(live.site.teamId, live.site.id);
  sendJson(ctx, 201, { term, results });
}

export async function docsRating(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const site = await siteBySlug(ctx.params.siteSlug);
  if (site === null) throw apiError('not_found');
  const vote = body.vote;
  if (vote !== 'yes' && vote !== 'no' && vote !== null) {
    throw validationFailed({ vote: 'Vote yes, no or null.' });
  }
  let readerId = cookies(ctx)[READER_COOKIE];
  if (readerId === undefined) {
    readerId = newId('reader');
    setCookie(ctx, READER_COOKIE, readerId, { maxAgeSeconds: 60 * 60 * 24 * 365 });
  }
  await setVote(readerId, ctx.params.pageId, vote);
  emitAnalytics(site.teamId, site.id);
  sendJson(ctx, 200, { pageId: ctx.params.pageId, vote });
}

export async function docsEvents(ctx: Ctx): Promise<void> {
  openStream({ res: ctx.res, siteSlug: ctx.params.siteSlug });
}
