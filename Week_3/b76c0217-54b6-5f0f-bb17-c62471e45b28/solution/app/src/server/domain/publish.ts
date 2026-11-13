// Publishing, all or nothing: validate, upload every rendered page and then the manifest, and only after the
// manifest is confirmed in file storage switch the version to the new snapshot.

import { copy } from '../../shared/copy';
import type { CheckResult, GateError, NavigationJson, PublishReport, PublishStatus } from '../../shared/types';
import { db, one, transaction, type Db } from '../db';
import { fail } from '../errors';
import { emit, emitPublished } from '../events';
import { newId } from '../ids';
import { putObject, StorageUnavailableError } from '../storage';
import { runGate } from './gate';
import { loadNavigation } from './navigation';
import { loadPages, type PageRow } from './pages';
import { findOperation } from './reference';
import { renderPage } from './render';
import type { VersionScope } from './scopes';

interface Attempt {
  status: PublishStatus;
  errors: string;
  snapshotId: string | null;
  publishedAt: Date | null;
}

export async function latestReport(source: Db, versionId: string): Promise<PublishReport> {
  const row = await one<Attempt>(
    source,
    'select status, errors, snapshot_id, published_at from publish_attempts where version_id = $1 order by id desc limit 1',
    [versionId],
  );
  return {
    versionId,
    status: row?.status ?? 'idle',
    publishedAt: row?.publishedAt?.toISOString() ?? null,
    snapshotId: row?.snapshotId ?? null,
    errors: row ? (JSON.parse(row.errors) as GateError[]) : [],
  };
}

interface Checked {
  pages: PageRow[];
  navigation: NavigationJson;
  errors: GateError[];
  changedIds: string[];
}

async function check(version: VersionScope): Promise<Checked> {
  const [pages, navigation, images, live] = await Promise.all([
    loadPages(db, version.id),
    loadNavigation(db, version.id),
    db.query<{ id: string }>('select id from assets where site_id = $1', [version.siteId]),
    db.query<{ pageId: string; sig: string }>(
      'select page_id, sig from snapshot_pages where snapshot_id = (select live_snapshot_id from versions where id = $1)',
      [version.id],
    ),
  ]);
  const errors = runGate({
    pages,
    redirects: navigation.redirects,
    siteSlug: version.siteSlug,
    imageIds: new Set(images.map((image) => image.id)),
  });
  const published = new Map(live.map((row) => [row.pageId, row.sig]));
  const current = new Set(pages.map((page) => page.id));
  const changedIds = [
    ...pages.filter((page) => published.get(page.id) !== page.sig).map((page) => page.id),
    ...live.filter((row) => !current.has(row.pageId)).map((row) => row.pageId),
  ];
  return { pages, navigation, errors, changedIds };
}

/** The check endpoint: record a blocked attempt when it finds problems, nothing when it is clean. */
export async function checkVersion(version: VersionScope): Promise<CheckResult> {
  const { pages, errors, changedIds } = await check(version);
  if (errors.length > 0) {
    await recordAttempt(version, 'blocked', errors);
  }
  return { pages: pages.length, changedPages: changedIds.length, errors };
}

async function recordAttempt(version: VersionScope, status: PublishStatus, errors: GateError[]): Promise<number> {
  const rows = await db.query<{ id: string }>(
    'insert into publish_attempts (version_id, status, errors) values ($1, $2, $3) returning id',
    [version.id, status, JSON.stringify(errors)],
  );
  await announceReport(version);
  return Number(rows[0]?.id);
}

async function announceReport(version: VersionScope): Promise<void> {
  emit('report', await latestReport(db, version.id), { versionId: version.id });
}

const running = new Set<string>();

interface PublishOutcome {
  status: number;
  body: PublishReport;
}

export async function publishVersion(version: VersionScope, key: string): Promise<PublishOutcome> {
  const stored = await one<{ versionId: string; status: number; body: string }>(
    db,
    'select version_id, status, body from idempotency_keys where team_id = $1 and key = $2',
    [version.teamId, key],
  );
  if (stored !== null) {
    if (stored.versionId !== version.id) {
      throw fail.keyReused();
    }
    return { status: stored.status, body: JSON.parse(stored.body) as PublishReport };
  }
  if (running.has(version.id)) {
    throw fail.publishInProgress();
  }
  running.add(version.id);
  try {
    return await run(version, key);
  } finally {
    running.delete(version.id);
  }
}

async function run(version: VersionScope, key: string): Promise<PublishOutcome> {
  const attempt = await recordAttempt(version, 'validating', []);
  const setStatus = async (status: PublishStatus, errors: GateError[] = []): Promise<void> => {
    await db.query('update publish_attempts set status = $2, errors = $3 where id = $1', [attempt, status, JSON.stringify(errors)]);
    await announceReport(version);
  };
  const { pages, navigation, errors, changedIds } = await check(version);
  if (errors.length > 0) {
    await setStatus('blocked', errors);
    throw fail.publishBlocked(await latestReport(db, version.id));
  }
  await setStatus('uploading');

  const snapshotId = newId('snap');
  const publishedAt = new Date();
  const prefix = `sites/${version.siteId}/versions/${version.id}/snapshots/${snapshotId}`;
  const byId = new Map(pages.map((page) => [page.id, page]));
  const ordered = navigation.tabs.flatMap((tab) =>
    tab.groups.flatMap((group) =>
      group.pages.flatMap((id) => {
        const page = byId.get(id);
        return page ? [{ page, group, tab }] : [];
      }),
    ),
  );
  const rendered = await Promise.all(
    ordered.map(async ({ page, group, tab }, position) => {
      const operation = page.operationId ? await findOperation(version.id, page.operationId) : null;
      const output = renderPage(page.source, { siteSlug: version.siteSlug, versionSlug: version.slug, operation });
      return { page, group, tab, position, output, key: `${prefix}/pages/${page.path}.html` };
    }),
  );
  const manifest = {
    snapshotId,
    versionId: version.id,
    publishedAt: publishedAt.toISOString(),
    pages: rendered.map((r) => ({ pageId: r.page.id, path: r.page.path, title: r.page.title, key: r.key })),
    navigation,
  };
  try {
    await Promise.all(rendered.map((r) => putObject(r.key, r.output.html, 'text/html; charset=utf-8')));
    await putObject(`${prefix}/manifest.json`, JSON.stringify(manifest), 'application/json');
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) {
      throw error;
    }
    await setStatus('failed');
    const report = await latestReport(db, version.id);
    throw fail.storageUnavailable(copy.publishOutage, report);
  }

  const body: PublishReport = { versionId: version.id, status: 'published', publishedAt: manifest.publishedAt, snapshotId, errors: [] };
  await transaction(async (tx) => {
    await tx.query('insert into snapshots (id, version_id, manifest, published_at) values ($1, $2, $3, $4)', [snapshotId, version.id, JSON.stringify(manifest), publishedAt]);
    for (const r of rendered) {
      await tx.query(
        `insert into snapshot_pages (snapshot_id, page_id, position, path, title, group_id, group_title, tab_id, html, body_text, headings, sig, operation_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [snapshotId, r.page.id, r.position, r.page.path, r.page.title, r.group.id, r.group.title, r.tab.id, r.output.html, r.output.text,
         JSON.stringify(r.output.headings), r.page.sig, r.page.operationId],
      );
    }
    await tx.query('update versions set live_snapshot_id = $2, published_at = $3 where id = $1', [version.id, snapshotId, publishedAt]);
    await tx.query('update pages set published_sig = sig, published_once = true where version_id = $1 and not removed', [version.id]);
    await tx.query('update publish_attempts set status = $2, snapshot_id = $3, published_at = $4 where id = $1', [attempt, 'published', snapshotId, publishedAt]);
    await tx.query('insert into idempotency_keys (team_id, key, version_id, status, body) values ($1, $2, $3, 200, $4)', [version.teamId, key, version.id, JSON.stringify(body)]);
  });
  await announceReport(version);
  emitPublished(version.siteSlug, { versionId: version.id, snapshotId, changedPageIds: changedIds });
  return { status: 200, body };
}
