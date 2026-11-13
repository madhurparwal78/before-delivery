import { newId } from './ids';
import { db, type Queryable } from './pool';
import type { GateError } from '../domain/gate';
import type { PageKind } from './content';

export type PublishStatus = 'idle' | 'validating' | 'blocked' | 'uploading' | 'published' | 'failed';

export interface PublishAttempt {
  id: string;
  versionId: string;
  status: PublishStatus;
  errors: GateError[];
  publishedAt: Date | null;
  snapshotId: string | null;
}

export interface SnapshotPage {
  pageId: string;
  path: string;
  title: string;
  kind: PageKind;
  operationId: string | null;
  groupId: string;
  groupTitle: string;
  tabId: string;
  html: string;
  bodyText: string;
  headings: { level: number; text: string; anchor: string | null }[];
  position: number;
  objectKey: string;
}

export interface Snapshot {
  id: string;
  versionId: string;
  publishedAt: Date;
  navigation: unknown;
}

export async function recordAttempt(input: {
  versionId: string;
  status: PublishStatus;
  errors: readonly GateError[];
  publishedAt: Date | null;
  snapshotId: string | null;
}): Promise<PublishAttempt> {
  const id = newId('attempt');
  await db.query(
    `INSERT INTO publish_attempts (id, version_id, status, errors, published_at, snapshot_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      id,
      input.versionId,
      input.status,
      JSON.stringify(input.errors),
      input.publishedAt,
      input.snapshotId,
    ],
  );
  return {
    id,
    versionId: input.versionId,
    status: input.status,
    errors: [...input.errors],
    publishedAt: input.publishedAt,
    snapshotId: input.snapshotId,
  };
}

export async function latestAttempt(versionId: string): Promise<PublishAttempt | null> {
  const { rows } = await db.query<{
    id: string;
    version_id: string;
    status: PublishStatus;
    errors: GateError[];
    published_at: Date | null;
    snapshot_id: string | null;
  }>(
    'SELECT * FROM publish_attempts WHERE version_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [versionId],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        versionId: row.version_id,
        status: row.status,
        errors: row.errors,
        publishedAt: row.published_at,
        snapshotId: row.snapshot_id,
      };
}

export async function createSnapshot(
  q: Queryable,
  snapshot: Snapshot,
  pages: readonly SnapshotPage[],
): Promise<void> {
  await q.query(
    'INSERT INTO snapshots (id, version_id, published_at, navigation) VALUES ($1, $2, $3, $4::json)',
    [snapshot.id, snapshot.versionId, snapshot.publishedAt, JSON.stringify(snapshot.navigation)],
  );
  for (const page of pages) {
    await q.query(
      `INSERT INTO snapshot_pages (snapshot_id, page_id, path, title, kind, operation_id, group_id,
                                   group_title, tab_id, html, body_text, headings, position, object_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::json, $13, $14)`,
      [
        snapshot.id,
        page.pageId,
        page.path,
        page.title,
        page.kind,
        page.operationId,
        page.groupId,
        page.groupTitle,
        page.tabId,
        page.html,
        page.bodyText,
        JSON.stringify(page.headings),
        page.position,
        page.objectKey,
      ],
    );
  }
}

export async function setLiveSnapshot(
  q: Queryable,
  versionId: string,
  snapshotId: string,
  publishedAt: Date,
): Promise<void> {
  await q.query(
    'UPDATE versions SET live_snapshot_id = $2, published_at = $3 WHERE id = $1',
    [versionId, snapshotId, publishedAt],
  );
}

export async function snapshotById(id: string): Promise<Snapshot | null> {
  const { rows } = await db.query<{
    id: string;
    version_id: string;
    published_at: Date;
    navigation: unknown;
  }>('SELECT * FROM snapshots WHERE id = $1', [id]);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        versionId: row.version_id,
        publishedAt: row.published_at,
        navigation: row.navigation,
      };
}

export async function snapshotPages(snapshotId: string): Promise<SnapshotPage[]> {
  const { rows } = await db.query<{
    page_id: string;
    path: string;
    title: string;
    kind: PageKind;
    operation_id: string | null;
    group_id: string;
    group_title: string;
    tab_id: string;
    html: string;
    body_text: string;
    headings: { level: number; text: string; anchor: string | null }[];
    position: number;
    object_key: string;
  }>('SELECT * FROM snapshot_pages WHERE snapshot_id = $1 ORDER BY position', [snapshotId]);
  return rows.map((row) => ({
    pageId: row.page_id,
    path: row.path,
    title: row.title,
    kind: row.kind,
    operationId: row.operation_id,
    groupId: row.group_id,
    groupTitle: row.group_title,
    tabId: row.tab_id,
    html: row.html,
    bodyText: row.body_text,
    headings: row.headings,
    position: row.position,
    objectKey: row.object_key,
  }));
}

export interface StoredIdempotency {
  versionId: string;
  status: number;
  response: unknown;
}

export async function findIdempotency(key: string): Promise<StoredIdempotency | null> {
  const { rows } = await db.query<{ version_id: string; status: number; response: unknown }>(
    `SELECT version_id, status, response FROM idempotency_keys
     WHERE key = $1 AND created_at > now() - interval '24 hours'`,
    [key],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { versionId: row.version_id, status: row.status, response: row.response };
}

export async function saveIdempotency(
  key: string,
  versionId: string,
  status: number,
  response: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO idempotency_keys (key, version_id, status, response) VALUES ($1, $2, $3, $4::json)
     ON CONFLICT (key) DO UPDATE SET version_id = $2, status = $3, response = $4::json, created_at = now()`,
    [key, versionId, status, JSON.stringify(response)],
  );
}

export async function setVote(
  readerId: string,
  pageId: string,
  vote: 'yes' | 'no' | null,
): Promise<void> {
  if (vote === null) {
    await db.query('DELETE FROM votes WHERE reader_id = $1 AND page_id = $2', [readerId, pageId]);
    return;
  }
  await db.query(
    `INSERT INTO votes (reader_id, page_id, vote) VALUES ($1, $2, $3)
     ON CONFLICT (reader_id, page_id) DO UPDATE SET vote = $3, created_at = now()`,
    [readerId, pageId, vote],
  );
}

export async function voteOf(readerId: string, pageId: string): Promise<'yes' | 'no' | null> {
  const { rows } = await db.query<{ vote: 'yes' | 'no' }>(
    'SELECT vote FROM votes WHERE reader_id = $1 AND page_id = $2',
    [readerId, pageId],
  );
  return rows[0]?.vote ?? null;
}

export async function recordSearch(input: {
  siteId: string;
  versionId: string;
  term: string;
  results: number;
}): Promise<void> {
  await db.query(
    'INSERT INTO search_records (site_id, version_id, term, results) VALUES ($1, $2, $3, $4)',
    [input.siteId, input.versionId, input.term, input.results],
  );
}

export interface RatingRow {
  pageId: string;
  title: string;
  versionSlug: string;
  yes: number;
  no: number;
}

export async function ratingsOfSite(siteId: string): Promise<RatingRow[]> {
  const { rows } = await db.query<{
    page_id: string;
    title: string;
    version_slug: string;
    yes: string;
    no: string;
  }>(
    `SELECT pages.id AS page_id, pages.title, versions.slug AS version_slug,
            count(votes.vote) FILTER (WHERE votes.vote = 'yes')::text AS yes,
            count(votes.vote) FILTER (WHERE votes.vote = 'no')::text AS no
     FROM pages
       JOIN versions ON versions.id = pages.version_id
       LEFT JOIN votes ON votes.page_id = pages.id
     WHERE versions.site_id = $1 AND pages.state <> 'removed'
     GROUP BY pages.id, pages.title, versions.slug`,
    [siteId],
  );
  return rows.map((row) => ({
    pageId: row.page_id,
    title: row.title,
    versionSlug: row.version_slug,
    yes: Number(row.yes),
    no: Number(row.no),
  }));
}

export interface TermRow {
  term: string;
  searches: number;
  results: number;
}

export async function searchTermsOfSite(siteId: string): Promise<TermRow[]> {
  const { rows } = await db.query<{ term: string; searches: string; results: number }>(
    `SELECT term, count(*)::text AS searches,
            (array_agg(results ORDER BY created_at DESC, id DESC))[1] AS results
     FROM search_records
     WHERE site_id = $1
     GROUP BY term`,
    [siteId],
  );
  return rows.map((row) => ({
    term: row.term,
    searches: Number(row.searches),
    results: row.results,
  }));
}
