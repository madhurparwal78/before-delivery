import { pool } from './db';
import { ApiError } from '../errors';
import { copy } from '../shared/copy';
import { storage } from './storage';
import { events } from './events';
import { gateErrorsForPage, sortGateErrors } from './gate';
import type { GateError } from './gate';
import { pageHeadings } from '../shared/headings';
import { getLivePages, getRedirects, navigationJson, getVersion, getSite, type NavigationJson } from './queries';
import { renderScreen } from './screen';
import { newId } from './ids';

export type PublishStatus = 'idle' | 'validating' | 'blocked' | 'uploading' | 'published' | 'failed';
export type PublishReport = {
  versionId: string; status: PublishStatus;
  publishedAt: string | null; snapshotId: string | null;
  errors: GateError[];
};

function isoOrNull(d: Date | null): string | null { return d ? new Date(d).toISOString() : null; }

export async function currentAttempt(versionId: string): Promise<{ attemptId: string; report: PublishReport } | null> {
  const r = await pool.query<{ id: string; status: PublishStatus; published_at: Date | null; snapshot_id: string | null; errors: GateError[] }>(
    'SELECT * FROM publish_attempts WHERE version_id = $1 ORDER BY started_at DESC LIMIT 1',
    [versionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    attemptId: row.id,
    report: { versionId, status: row.status, publishedAt: isoOrNull(row.published_at), snapshotId: row.snapshot_id, errors: row.errors ?? [] },
  };
}

export async function runCheck(versionId: string): Promise<{ pages: number; changedPages: number; errors: GateError[] }> {
  const pages = await getLivePages(versionId);
  const redirectRows = await getRedirects(versionId);
  const redirects = new Map(redirectRows.map((r) => [r.from_path, r.to_path]));
  const livePaths = new Set(pages.map((p) => p.path));
  const anchorsByPath = new Map<string, Set<string>>();
  for (const p of pages) {
    const anchors = new Set<string>();
    for (const h of pageHeadings(p.source)) anchors.add(h.anchor);
    anchorsByPath.set(p.path, anchors);
  }
  const version = (await getVersion(versionId))!;
  const site = (await getSite(version.site_id))!;
  const imgRes = await pool.query<{ id: string }>('SELECT id FROM images WHERE site_id = $1', [site.id]);
  const validImageUrls = new Set(imgRes.rows.map((r) => `/assets/${site.slug}/${r.id}`));
  const pathCount = new Map<string, number>();
  for (const p of pages) pathCount.set(p.path, (pathCount.get(p.path) ?? 0) + 1);
  const duplicatePaths = new Set([...pathCount].filter(([, n]) => n > 1).map(([p]) => p));

  const allErrors: GateError[] = [];
  for (const p of pages) {
    allErrors.push(...gateErrorsForPage(
      { id: p.id, path: p.path, title: p.title, source: p.source, removed: false },
      livePaths, redirects, anchorsByPath, validImageUrls, duplicatePaths,
    ));
  }
  const errors = sortGateErrors(allErrors);

  const previous = await getLiveSnapshotRow(versionId);
  let changedPages: number;
  if (!previous) {
    changedPages = pages.length;
  } else {
    let changed = 0;
    for (const p of pages) {
      if (previous.pages.get(p.id)?.path !== p.path || previous.pages.get(p.id)?.source !== p.source || previous.pages.get(p.id)?.title !== p.title) changed++;
    }
    const added = pages.filter((p) => !previous.pages.has(p.id)).length;
    const removed = previous.pages.size - pages.filter((p) => previous.pages.has(p.id)).length;
    changedPages = changed + added + removed;
  }
  return { pages: pages.length, changedPages, errors };
}

export type ManifestJson = {
  snapshotId: string; versionId: string; publishedAt: string;
  pages: { pageId: string; path: string; title: string; key: string; source: string }[];
  navigation: NavigationJson;
};

export type SnapshotRow = { snapshotId: string; publishedAt: string; manifest: ManifestJson; pages: Map<string, { path: string; source: string; title: string }> };

export async function getLiveSnapshotRow(versionId: string): Promise<SnapshotRow | null> {
  const r = await pool.query<{ id: string; manifest: ManifestJson; published_at: Date }>(
    'SELECT id, manifest, published_at FROM snapshots WHERE version_id = $1 ORDER BY published_at DESC LIMIT 1',
    [versionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const manifest = row.manifest;
  const pageMap = new Map<string, { path: string; source: string; title: string }>();
  for (const p of manifest.pages) {
    pageMap.set(p.pageId, { path: p.path, source: p.source, title: p.title });
  }
  return { snapshotId: row.id, publishedAt: new Date(row.published_at).toISOString(), manifest, pages: pageMap };
}

const publishing = new Set<string>();

export async function publishVersion(versionId: string, idempotencyKey: string): Promise<PublishReport> {
  const existing = await pool.query<{ version_id: string; body: PublishReport }>(
    'SELECT version_id, body FROM idempotency_keys WHERE key = $1', [idempotencyKey],
  );
  const prior = existing.rows[0];
  if (prior) {
    if (prior.version_id !== versionId) throw new ApiError('idempotency_key_reused', 'Idempotency key already used for another version.');
    return prior.body;
  }

  if (publishing.has(versionId)) throw new ApiError('publish_in_progress', copy.publishInProgress);
  publishing.add(versionId);
  try {
    const attemptId = newId('pub');
    await pool.query(
      "INSERT INTO publish_attempts (id, version_id, status) VALUES ($1, $2, 'validating')",
      [attemptId, versionId],
    );
    const check = await runCheck(versionId);
    await pool.query('UPDATE publish_attempts SET pages_count = $2, changed_pages = $3 WHERE id = $1',
      [attemptId, check.pages, check.changedPages]);

    if (check.errors.length > 0) {
      await pool.query(
        "UPDATE publish_attempts SET status = 'blocked', errors = $2, finished_at = now() WHERE id = $1",
        [attemptId, JSON.stringify(check.errors)],
      );
      const report = await reportFor(attemptId, versionId);
      await storeIdempotency(idempotencyKey, versionId, 409, report);
      throw new ApiError('publish_blocked', copy.checkFoundProblems(check.errors.length), { report });
    }

    const version = (await getVersion(versionId))!;
    const site = (await getSite(version.site_id))!;
    await pool.query("UPDATE publish_attempts SET status = 'uploading' WHERE id = $1", [attemptId]);

    const snapshotId = newId('snap');
    const pages = await getLivePages(versionId);
    const navigation = await navigationJson(versionId);
    const manifestPages: ManifestJson['pages'] = [];
    let manifest: ManifestJson;
    try {
      for (const p of pages) {
        const key = `sites/${site.id}/versions/${versionId}/snapshots/${snapshotId}/pages/${p.path}.html`;
        const html = await renderScreen({ page: p, site, version, navigation, mode: 'public' });
        await storage.snapshotPage(site.id, versionId, snapshotId, p.path, html);
        manifestPages.push({ pageId: p.id, path: p.path, title: p.title, key, source: p.source });
      }
      manifest = { snapshotId, versionId, publishedAt: new Date().toISOString(), pages: manifestPages, navigation };
      await storage.snapshotManifest(site.id, versionId, snapshotId, JSON.stringify(manifest));
    } catch {
      await pool.query("UPDATE publish_attempts SET status = 'failed', finished_at = now() WHERE id = $1", [attemptId]);
      const report = await reportFor(attemptId, versionId);
      await storeIdempotency(idempotencyKey, versionId, 503, report);
      throw new ApiError('storage_unavailable', copy.publishOutage, { report });
    }

    await pool.query(
      "UPDATE publish_attempts SET status = 'published', snapshot_id = $2, published_at = now(), finished_at = now() WHERE id = $1",
      [attemptId, snapshotId],
    );
    await pool.query(
      "UPDATE pages SET state = 'published', has_draft_changes = false WHERE version_id = $1 AND state != 'removed'",
      [versionId],
    );
    await pool.query(
      'INSERT INTO snapshots (id, version_id, manifest, published_at) VALUES ($1, $2, $3, now())',
      [snapshotId, versionId, JSON.stringify(manifest)],
    );
    for (const p of manifestPages) {
      const page = pages.find((row) => row.id === p.pageId)!;
      const html = await renderScreen({ page, site, version, navigation, mode: 'public' });
      await pool.query(
        'INSERT INTO snapshot_pages (snapshot_id, path, html) VALUES ($1, $2, $3) ON CONFLICT (snapshot_id, path) DO NOTHING',
        [snapshotId, p.path, html],
      );
    }
    const report = await reportFor(attemptId, versionId);
    await storeIdempotency(idempotencyKey, versionId, 200, report);
    events.published(site.id, versionId, snapshotId, pages.map((p) => p.id));
    events.report(versionId, report);
    return report;
  } finally {
    publishing.delete(versionId);
  }
}

async function storeIdempotency(key: string, versionId: string, status: number, body: PublishReport): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_keys (key, version_id, status, body) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key, version_id) DO NOTHING`,
    [key, versionId, status, JSON.stringify(body)],
  );
  await pool.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'");
}

async function reportFor(attemptId: string, versionId: string): Promise<PublishReport> {
  const r = await pool.query<{ status: PublishStatus; published_at: Date | null; snapshot_id: string | null; errors: GateError[] }>(
    'SELECT status, published_at, snapshot_id, errors FROM publish_attempts WHERE id = $1', [attemptId],
  );
  const row = r.rows[0];
  return { versionId, status: row.status, publishedAt: isoOrNull(row.published_at), snapshotId: row.snapshot_id, errors: row.errors ?? [] };
}
