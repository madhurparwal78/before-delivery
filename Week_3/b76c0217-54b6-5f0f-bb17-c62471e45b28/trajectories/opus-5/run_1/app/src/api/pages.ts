import {
  assetById,
  createAsset,
  createGroup,
  createPage,
  createTab,
  groupsOfVersion,
  livePages,
  movePage,
  moveGroup,
  pagesOfVersion,
  redirectsOfVersion,
  replaceRedirects,
  removeRedirect,
  savePage,
  setPagePath,
  setPageSource,
  setPageState,
  siteBySlug,
  type Page,
} from '../db/content';
import { newId } from '../db/ids';
import { db, withTx } from '../db/pool';
import { messages } from '../domain/messages';
import { rewriteLinks } from '../domain/markdown';
import { isValidPath, hasSchemeOrHost, withoutSlash, withSlash } from '../domain/paths';
import { planManualRedirect, planRename } from '../domain/redirects';
import { ApiError, apiError, validationFailed } from '../http/errors';
import {
  IMAGE_LIMIT,
  mediaType,
  readBody,
  readJsonBody,
  sendBytes,
  sendJson,
  str,
  type Ctx,
} from '../http/http';
import { emitNavigation, emitPage } from '../services/events';
import { assetKey, getObject, putObject, StorageUnavailable } from '../services/storage';
import { loadGroup, loadPage, loadSite, loadTab, loadVersion, requireUser, requireWriter } from './auth';
import { navigationDocument, pageDocument } from './documents';

const SOURCE_LIMIT = 200_000;

const pathField = (value: string | null, field: string): string => {
  const path = withoutSlash(value ?? '');
  if (path === '' || !isValidPath(path)) throw validationFailed({ [field]: messages.badPath });
  return path;
};

async function emitNavigationOf(versionId: string): Promise<void> {
  emitNavigation(versionId, await navigationDocument(versionId));
}

export async function getPage(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { page } = await loadPage(user, ctx.params.pageId);
  sendJson(ctx, 200, await pageDocument(page));
}

export async function postPage(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  const path = pathField(str(body, 'path'), 'path');
  const title = (str(body, 'title') ?? '').trim();
  if (title === '') throw validationFailed({ title: 'Enter a title.' });
  const groups = await groupsOfVersion(db, version.id);
  const group = groups.find((candidate) => candidate.id === str(body, 'groupId'));
  if (group === undefined) throw apiError('not_found');
  const pages = livePages(await pagesOfVersion(db, version.id));
  if (pages.some((existing) => existing.path === path)) {
    throw apiError('path_taken', messages.pathTaken(withSlash(path)));
  }
  const page = await createPage(db, {
    versionId: version.id,
    groupId: group.id,
    path,
    title,
    source: '',
    updatedBy: user.id,
  });
  const document = await pageDocument(page);
  await emitNavigationOf(version.id);
  emitPage(document);
  sendJson(ctx, 201, document);
}

export async function putPage(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const source = str(body, 'source') ?? '';
  if (Buffer.byteLength(source, 'utf8') > SOURCE_LIMIT) throw apiError('too_large');
  const user = await requireUser(ctx);
  const { page } = await loadPage(user, ctx.params.pageId);
  requireWriter(user);
  if (page.state === 'removed') throw apiError('page_removed');
  if (page.kind === 'reference' && source !== page.source) throw apiError('reference_page');
  const revision = body.revision;
  if (revision !== page.revision) {
    const document = await pageDocument(page);
    throw apiError('revision_conflict', messages.conflict(document.updatedBy?.name ?? ''), {
      savedBy: document.updatedBy,
    });
  }
  const title = (str(body, 'title') ?? '').trim();
  if (title === '') throw validationFailed({ title: 'Enter a title.' });
  const saved = await savePage(db, { id: page.id, title, source, updatedBy: user.id });
  const document = await pageDocument(saved);
  emitPage(document);
  sendJson(ctx, 200, document);
}

export async function renamePage(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const { page, version } = await loadPage(user, ctx.params.pageId);
  requireWriter(user);
  if (page.state === 'removed') throw apiError('page_removed');
  if (body.revision !== page.revision) {
    const document = await pageDocument(page);
    throw apiError('revision_conflict', messages.conflict(document.updatedBy?.name ?? ''), {
      savedBy: document.updatedBy,
    });
  }
  const newPath = pathField(str(body, 'path'), 'path');
  const pages = await pagesOfVersion(db, version.id);
  if (
    livePages(pages).some((other) => other.path === newPath && other.id !== page.id)
  ) {
    throw apiError('path_taken', messages.pathTaken(withSlash(newPath)));
  }
  const oldPath = page.path;
  const current = await redirectsOfVersion(db, version.id);
  const plan = planRename(current, withSlash(oldPath), withSlash(newPath));
  if (!plan.ok) {
    throw apiError('redirect_loop', messages.redirectLoop(plan.cycle), { cycle: plan.cycle });
  }
  const rewritten: Page[] = [];
  let linksRewritten = 0;
  const renamed = await withTx(async (tx) => {
    const updated = await setPagePath(tx, page.id, newPath);
    await replaceRedirects(tx, version.id, plan.plan.redirects);
    for (const other of pages) {
      if (other.state === 'removed') continue;
      const result = rewriteLinks(other.source, withSlash(oldPath), withSlash(newPath));
      if (result.count === 0) continue;
      linksRewritten += result.count;
      rewritten.push(await setPageSource(tx, { id: other.id, source: result.source }));
    }
    return updated;
  });
  const navigation = await navigationDocument(version.id);
  const document = await pageDocument(rewritten.find((p) => p.id === renamed.id) ?? renamed);
  emitNavigation(version.id, navigation);
  emitPage(document);
  for (const other of rewritten) {
    if (other.id !== renamed.id) emitPage(await pageDocument(other));
  }
  sendJson(ctx, 200, {
    page: document,
    navigation,
    linksRewritten,
    redirectAdded: plan.plan.added,
    redirectRemoved: plan.plan.removed,
  });
}

export async function deletePage(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { page, version } = await loadPage(user, ctx.params.pageId);
  requireWriter(user);
  if (page.state === 'removed') throw apiError('page_removed');
  const removed = await setPageState(db, page.id, 'removed');
  const document = await pageDocument(removed);
  await emitNavigationOf(version.id);
  emitPage(document);
  sendJson(ctx, 200, document);
}

export async function getNavigation(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  sendJson(ctx, 200, await navigationDocument(version.id));
}

export async function postTab(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  const title = (str(body, 'title') ?? '').trim();
  if (title === '') throw validationFailed({ title: 'Enter a title.' });
  await createTab(db, { versionId: version.id, title });
  const navigation = await navigationDocument(version.id);
  emitNavigation(version.id, navigation);
  sendJson(ctx, 201, navigation);
}

export async function postGroup(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  const title = (str(body, 'title') ?? '').trim();
  if (title === '') throw validationFailed({ title: 'Enter a title.' });
  const { tab } = await loadTab(user, str(body, 'tabId') ?? '');
  if (tab.versionId !== version.id) throw apiError('not_found');
  await createGroup(db, { versionId: version.id, tabId: tab.id, title });
  const navigation = await navigationDocument(version.id);
  emitNavigation(version.id, navigation);
  sendJson(ctx, 201, navigation);
}

export async function postPageMove(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const { page, version } = await loadPage(user, ctx.params.pageId);
  requireWriter(user);
  if (page.state === 'removed') throw apiError('page_removed');
  const groups = await groupsOfVersion(db, version.id);
  const group = groups.find((candidate) => candidate.id === str(body, 'groupId'));
  if (group === undefined) throw apiError('not_found');
  const index = typeof body.index === 'number' ? body.index : 0;
  await withTx((tx) => movePage(tx, page, group.id, index));
  const navigation = await navigationDocument(version.id);
  emitNavigation(version.id, navigation);
  sendJson(ctx, 200, navigation);
}

export async function postGroupMove(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const { group, version } = await loadGroup(user, ctx.params.groupId);
  requireWriter(user);
  const { tab } = await loadTab(user, str(body, 'tabId') ?? '');
  if (tab.versionId !== version.id) throw apiError('not_found');
  const index = typeof body.index === 'number' ? body.index : 0;
  await withTx((tx) => moveGroup(tx, group, tab.id, index));
  const navigation = await navigationDocument(version.id);
  emitNavigation(version.id, navigation);
  sendJson(ctx, 200, navigation);
}

export async function postRedirect(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  const rawFrom = str(body, 'from') ?? '';
  const rawTo = str(body, 'to') ?? '';
  const current = await redirectsOfVersion(db, version.id);
  if (hasSchemeOrHost(rawFrom)) throw apiError('redirect_off_site');
  if (hasSchemeOrHost(rawTo)) throw apiError('redirect_off_site');
  const from = withSlash(pathField(rawFrom, 'from'));
  const to = withSlash(pathField(rawTo, 'to'));
  if (current.some((redirect) => redirect.from === from)) {
    throw apiError('redirect_exists', messages.redirectExists(from));
  }
  const pages = livePages(await pagesOfVersion(db, version.id));
  if (!pages.some((page) => withSlash(page.path) === to)) {
    throw apiError('redirect_target_missing', messages.targetMissing(to));
  }
  const plan = planManualRedirect(current, from, to);
  if (!plan.ok) {
    throw apiError('redirect_loop', messages.redirectLoop(plan.cycle), { cycle: plan.cycle });
  }
  await withTx((tx) => replaceRedirects(tx, version.id, plan.plan));
  const navigation = await navigationDocument(version.id);
  emitNavigation(version.id, navigation);
  sendJson(ctx, 201, navigation);
}

export async function deleteRedirect(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  const from = withSlash(ctx.url.searchParams.get('from') ?? '');
  await removeRedirect(version.id, from);
  const navigation = await navigationDocument(version.id);
  emitNavigation(version.id, navigation);
  sendJson(ctx, 200, navigation);
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function postAsset(ctx: Ctx): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readBody(ctx, IMAGE_LIMIT);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'too_large') {
      throw apiError('too_large', messages.imageSize);
    }
    throw error;
  }
  const type = mediaType(ctx);
  if (!IMAGE_TYPES.includes(type)) throw apiError('unsupported_media_type', messages.imageType);
  const user = await requireUser(ctx);
  const site = await loadSite(user, ctx.params.siteId);
  requireWriter(user);
  const id = newId('asset');
  const key = assetKey(site.id, id);
  try {
    await putObject(key, bytes, type);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    throw apiError('storage_unavailable', messages.imageOutage);
  }
  await createAsset({ id, siteId: site.id, contentType: type, bytes: bytes.length, objectKey: key });
  sendJson(ctx, 201, { id, url: `/assets/${site.slug}/${id}` });
}

export async function getAsset(ctx: Ctx): Promise<void> {
  const site = await siteBySlug(ctx.params.siteSlug);
  if (site === null) throw apiError('not_found');
  const asset = await assetById(site.id, ctx.params.imageId);
  if (asset === null) throw apiError('not_found');
  try {
    const stored = await getObject(asset.objectKey);
    sendBytes(ctx, 200, stored.bytes, asset.contentType, { 'Cache-Control': 'no-store' });
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    throw apiError('storage_unavailable');
  }
}
