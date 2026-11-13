import { config } from '../config';
import {
  createGroup,
  createPage,
  createTab,
  createVersion,
  groupsOfVersion,
  importOfVersion,
  livePages,
  pagesOfVersion,
  redirectsOfVersion,
  replaceRedirects,
  saveImport,
  setDefaultVersion,
  setPageState,
  tabsOfVersion,
  versionsOfSite,
} from '../db/content';
import { newId } from '../db/ids';
import { db, withTx } from '../db/pool';
import { findIdempotency, saveIdempotency } from '../db/publishing';
import {
  createPreviewLink,
  hasLivePreviewLink,
  previewLinkById,
  previewLinksOfPage,
  revokePreviewLink,
} from '../db/previews';
import { messages } from '../domain/messages';
import { isValidSlug } from '../domain/paths';
import { apiError, validationFailed } from '../http/errors';
import { readJsonBody, sendJson, sendNoContent, str, type Ctx } from '../http/http';
import { emitPage, openStream } from '../services/events';
import {
  checkVersion,
  publishVersion,
  PublishBlocked,
  PublishFailed,
  PublishInProgress,
} from '../services/publisher';
import { loadPage, loadSite, loadVersion, requireUser, requireWriter } from './auth';
import { pageDocument, publishReportDocument } from './documents';

export async function postCheck(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version, site } = await loadVersion(user, ctx.params.versionId);
  const result = await checkVersion(site, version);
  sendJson(ctx, 200, result);
}

export async function postPublish(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version, site } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 1 || key.length > 100) {
    throw apiError('idempotency_key_required');
  }
  const stored = await findIdempotency(key);
  if (stored !== null) {
    if (stored.versionId !== version.id) throw apiError('idempotency_key_reused');
    sendJson(ctx, stored.status, stored.response);
    return;
  }
  try {
    const report = await publishVersion(site, version);
    await saveIdempotency(key, version.id, 200, report);
    sendJson(ctx, 200, report);
  } catch (error) {
    if (error instanceof PublishBlocked) {
      throw apiError('publish_blocked', messages.checkFoundProblems(
        (error.report as { errors: unknown[] }).errors.length,
      ), { report: error.report });
    }
    if (error instanceof PublishInProgress) throw apiError('publish_in_progress');
    if (error instanceof PublishFailed) {
      throw apiError('storage_unavailable', messages.publishOutage, { report: error.report });
    }
    throw error;
  }
}

export async function getPublishReport(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  sendJson(ctx, 200, await publishReportDocument(version.id));
}

const versionBody = (version: {
  id: string;
  slug: string;
  title: string;
  isDefault: boolean;
  publishedAt: Date | null;
}): Record<string, unknown> => ({
  id: version.id,
  slug: version.slug,
  title: version.title,
  default: version.isDefault,
  publishedAt: version.publishedAt === null ? null : version.publishedAt.toISOString(),
});

export async function getSite(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const site = await loadSite(user, ctx.params.siteId);
  const versions = await versionsOfSite(site.id);
  sendJson(ctx, 200, {
    id: site.id,
    slug: site.slug,
    title: site.title,
    versions: versions.map(versionBody),
  });
}

/** A new version is a copy of an existing one with its own ids (DP-26). */
export async function postVersion(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const site = await loadSite(user, ctx.params.siteId);
  requireWriter(user);
  const slug = (str(body, 'slug') ?? '').trim();
  const title = (str(body, 'title') ?? '').trim();
  if (!isValidSlug(slug)) throw validationFailed({ slug: messages.badPath });
  if (title === '') throw validationFailed({ title: 'Enter a title.' });
  const versions = await versionsOfSite(site.id);
  if (versions.some((version) => version.slug === slug)) throw apiError('slug_taken');
  const from = versions.find((version) => version.id === str(body, 'fromVersionId'));
  if (from === undefined) throw apiError('not_found');

  const created = await withTx(async (tx) => {
    const version = await createVersion(tx, {
      siteId: site.id,
      slug,
      title,
      isDefault: false,
    });
    const [tabs, groups, pages, redirects, imported] = await Promise.all([
      tabsOfVersion(tx, from.id),
      groupsOfVersion(tx, from.id),
      pagesOfVersion(tx, from.id),
      redirectsOfVersion(tx, from.id),
      importOfVersion(from.id),
    ]);
    const tabIds = new Map<string, string>();
    for (const tab of tabs) {
      const copy = await createTab(tx, { versionId: version.id, title: tab.title });
      tabIds.set(tab.id, copy.id);
    }
    const groupIds = new Map<string, string>();
    for (const group of groups) {
      const copy = await createGroup(tx, {
        versionId: version.id,
        tabId: tabIds.get(group.tabId) as string,
        title: group.title,
      });
      groupIds.set(group.id, copy.id);
    }
    for (const page of livePages(pages)) {
      await createPage(tx, {
        versionId: version.id,
        groupId: groupIds.get(page.groupId) as string,
        path: page.path,
        title: page.title,
        source: page.source,
        kind: page.kind,
        operationId: page.operationId,
        updatedBy: user.id,
      });
    }
    await replaceRedirects(tx, version.id, redirects);
    if (imported !== null) {
      await saveImport(tx, {
        id: newId('import'),
        versionId: version.id,
        groupId: groupIds.get(imported.groupId) ?? imported.groupId,
        fileName: imported.fileName,
        bytes: imported.bytes,
        sha256: imported.sha256,
        objectKey: imported.objectKey,
        spec: imported.spec,
      });
    }
    return version;
  });
  sendJson(ctx, 201, versionBody(created));
}

export async function postMakeDefault(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version, site } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  if (version.liveSnapshotId === null) throw apiError('version_unpublished');
  await setDefaultVersion(site.id, version.id);
  const versions = await versionsOfSite(site.id);
  sendJson(ctx, 200, {
    id: site.id,
    slug: site.slug,
    title: site.title,
    versions: versions.map(versionBody),
  });
}

const previewBody = (link: {
  id: string;
  token: string;
  expiresAt: Date;
  revoked: boolean;
}): Record<string, unknown> => ({
  id: link.id,
  url: `/preview/${link.token}`,
  expiresAt: link.expiresAt.toISOString(),
  revoked: link.revoked,
});

export async function postPreviewLink(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { page } = await loadPage(user, ctx.params.pageId);
  requireWriter(user);
  if (page.state === 'removed') throw apiError('page_removed');
  const link = await createPreviewLink(page.id, config.previewLinkTtlMs);
  if (page.state === 'draft') {
    emitPage(await pageDocument(await setPageState(db, page.id, 'in_preview')));
  }
  const body = previewBody(link);
  sendJson(ctx, 201, { id: body.id, url: body.url, expiresAt: body.expiresAt });
}

export async function getPreviewLinks(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { page } = await loadPage(user, ctx.params.pageId);
  const links = await previewLinksOfPage(page.id);
  sendJson(ctx, 200, links.map(previewBody));
}

export async function deletePreviewLink(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const link = await previewLinkById(ctx.params.linkId);
  if (link === null) throw apiError('not_found');
  const { page } = await loadPage(user, link.pageId);
  requireWriter(user);
  await revokePreviewLink(link.id);
  if (page.state === 'in_preview' && !(await hasLivePreviewLink(page.id))) {
    emitPage(await pageDocument(await setPageState(db, page.id, 'draft')));
  }
  sendNoContent(ctx);
}

export async function events(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const versionId = ctx.url.searchParams.get('versionId');
  const pageId = ctx.url.searchParams.get('pageId');
  openStream({
    res: ctx.res,
    teamId: user.teamId,
    userId: user.id,
    userName: user.name,
    ...(versionId === null ? {} : { versionId }),
    ...(pageId === null ? {} : { pageId }),
  });
}
