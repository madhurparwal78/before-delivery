import { navigationDocument } from '../api/documents';
import {
  assetIdsOfSite,
  groupsOfVersion,
  livePages,
  pagesOfVersion,
  redirectsOfVersion,
  type Page,
  type Site,
  type Version,
} from '../db/content';
import { db, withTx } from '../db/pool';
import { newId } from '../db/ids';
import {
  createSnapshot,
  recordAttempt,
  setLiveSnapshot,
  snapshotPages,
  type PublishAttempt,
  type SnapshotPage,
} from '../db/publishing';
import { runGate, type GateError } from '../domain/gate';
import { emitPublished, emitReport } from './events';
import { renderPageContent } from './renderer';
import {
  putObject,
  snapshotManifestKey,
  snapshotPageKey,
  StorageUnavailable,
} from './storage';

export interface CheckResult {
  pages: number;
  changedPages: number;
  errors: GateError[];
}

async function gateErrors(site: Site, version: Version, pages: readonly Page[]): Promise<GateError[]> {
  const [redirects, assetIds] = await Promise.all([
    redirectsOfVersion(db, version.id),
    assetIdsOfSite(site.id),
  ]);
  return runGate({
    pages: pages.map((page) => ({
      id: page.id,
      path: page.path,
      title: page.title,
      source: page.source,
    })),
    redirects,
    siteSlug: site.slug,
    assetIds,
  });
}

async function renderAll(
  site: Site,
  version: Version,
  pages: readonly Page[],
): Promise<Omit<SnapshotPage, 'objectKey'>[]> {
  const groups = await groupsOfVersion(db, version.id);
  const rendered: Omit<SnapshotPage, 'objectKey'>[] = [];
  let position = 0;
  for (const page of pages) {
    const group = groups.find((candidate) => candidate.id === page.groupId);
    const content = await renderPageContent(page, site, version);
    rendered.push({
      pageId: page.id,
      path: page.path,
      title: page.title,
      kind: page.kind,
      operationId: page.operationId,
      groupId: page.groupId,
      groupTitle: group === undefined ? '' : group.title,
      tabId: group === undefined ? '' : group.tabId,
      html: content.aboveTitle + content.html,
      bodyText: content.text,
      headings: content.headings,
      position: position++,
    });
  }
  return rendered;
}

async function changedPageIds(
  version: Version,
  rendered: readonly Omit<SnapshotPage, 'objectKey'>[],
): Promise<string[]> {
  if (version.liveSnapshotId === null) return rendered.map((page) => page.pageId);
  const live = await snapshotPages(version.liveSnapshotId);
  const byId = new Map(live.map((page) => [page.pageId, page]));
  const changed: string[] = [];
  for (const page of rendered) {
    const previous = byId.get(page.pageId);
    if (previous === undefined || previous.html !== page.html || previous.path !== page.path) {
      changed.push(page.pageId);
    }
    byId.delete(page.pageId);
  }
  for (const removed of byId.keys()) changed.push(removed);
  return changed;
}

export async function checkVersion(site: Site, version: Version): Promise<CheckResult> {
  const pages = livePages(await pagesOfVersion(db, version.id));
  const errors = await gateErrors(site, version, pages);
  const rendered = await renderAll(site, version, pages);
  const changed = await changedPageIds(version, rendered);
  if (errors.length > 0) {
    const attempt = await recordAttempt({
      versionId: version.id,
      status: 'blocked',
      errors,
      publishedAt: null,
      snapshotId: null,
    });
    emitReport(version.id, reportOf(attempt));
  }
  return { pages: pages.length, changedPages: changed.length, errors };
}

const reportOf = (attempt: PublishAttempt): unknown => ({
  versionId: attempt.versionId,
  status: attempt.status,
  publishedAt: attempt.publishedAt === null ? null : attempt.publishedAt.toISOString(),
  snapshotId: attempt.snapshotId,
  errors: attempt.errors,
});

const running = new Set<string>();

export class PublishBlocked extends Error {
  constructor(readonly report: unknown) {
    super('Publish is blocked');
    this.name = 'PublishBlocked';
  }
}

export class PublishInProgress extends Error {
  constructor() {
    super('Another publish is running');
    this.name = 'PublishInProgress';
  }
}

export class PublishFailed extends Error {
  constructor(readonly report: unknown) {
    super('File storage is unavailable');
    this.name = 'PublishFailed';
  }
}

/** Publish runs all or nothing: validate, upload, manifest last, then switch (DP-20). */
export async function publishVersion(site: Site, version: Version): Promise<unknown> {
  if (running.has(version.id)) throw new PublishInProgress();
  running.add(version.id);
  try {
    const pages = livePages(await pagesOfVersion(db, version.id));
    const errors = await gateErrors(site, version, pages);
    if (errors.length > 0) {
      const attempt = await recordAttempt({
        versionId: version.id,
        status: 'blocked',
        errors,
        publishedAt: null,
        snapshotId: null,
      });
      const report = reportOf(attempt);
      emitReport(version.id, report);
      throw new PublishBlocked(report);
    }
    const rendered = await renderAll(site, version, pages);
    const changed = await changedPageIds(version, rendered);
    const snapshotId = newId('snapshot');
    const publishedAt = new Date();
    const navigation = await navigationDocument(version.id);
    const snapshotPagesToWrite: SnapshotPage[] = rendered.map((page) => ({
      ...page,
      objectKey: snapshotPageKey(site.id, version.id, snapshotId, page.path),
    }));
    try {
      for (const page of snapshotPagesToWrite) {
        await putObject(page.objectKey, Buffer.from(page.html, 'utf8'), 'text/html; charset=utf-8');
      }
      const manifest = {
        snapshotId,
        versionId: version.id,
        publishedAt: publishedAt.toISOString(),
        pages: snapshotPagesToWrite.map((page) => ({
          pageId: page.pageId,
          path: page.path,
          title: page.title,
          key: page.objectKey,
        })),
        navigation,
      };
      await putObject(
        snapshotManifestKey(site.id, version.id, snapshotId),
        Buffer.from(JSON.stringify(manifest), 'utf8'),
        'application/json',
      );
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      const attempt = await recordAttempt({
        versionId: version.id,
        status: 'failed',
        errors: [],
        publishedAt: null,
        snapshotId: null,
      });
      const report = reportOf(attempt);
      emitReport(version.id, report);
      throw new PublishFailed(report);
    }
    await withTx(async (tx) => {
      await createSnapshot(
        tx,
        { id: snapshotId, versionId: version.id, publishedAt, navigation },
        snapshotPagesToWrite,
      );
      await setLiveSnapshot(tx, version.id, snapshotId, publishedAt);
      await tx.query(
        `UPDATE pages SET state = 'published', has_draft_changes = false
         WHERE version_id = $1 AND state <> 'removed'`,
        [version.id],
      );
    });
    const attempt = await recordAttempt({
      versionId: version.id,
      status: 'published',
      errors: [],
      publishedAt,
      snapshotId,
    });
    const report = reportOf(attempt);
    emitReport(version.id, report);
    emitPublished(site.slug, { versionId: version.id, snapshotId, changedPageIds: changed });
    return report;
  } finally {
    running.delete(version.id);
  }
}
