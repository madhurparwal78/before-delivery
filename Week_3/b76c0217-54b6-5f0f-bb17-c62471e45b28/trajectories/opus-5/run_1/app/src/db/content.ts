import { newId } from './ids';
import { db, type Queryable } from './pool';
import { sortRedirects, type Redirect, type RedirectKind } from '../domain/redirects';

export type PageKind = 'page' | 'reference';
export type PageState = 'draft' | 'in_preview' | 'published' | 'removed';

export interface Site {
  id: string;
  teamId: string;
  slug: string;
  title: string;
}

export interface Version {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  isDefault: boolean;
  publishedAt: Date | null;
  liveSnapshotId: string | null;
  position: number;
}

export interface Tab {
  id: string;
  versionId: string;
  title: string;
  position: number;
}

export interface Group {
  id: string;
  versionId: string;
  tabId: string;
  title: string;
  position: number;
}

export interface Page {
  id: string;
  versionId: string;
  groupId: string;
  path: string;
  title: string;
  kind: PageKind;
  operationId: string | null;
  source: string;
  revision: number;
  state: PageState;
  hasDraftChanges: boolean;
  position: number;
  updatedAt: Date;
  updatedBy: string | null;
}

interface SiteRow {
  id: string;
  team_id: string;
  slug: string;
  title: string;
}

interface VersionRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  is_default: boolean;
  published_at: Date | null;
  live_snapshot_id: string | null;
  position: number;
}

interface TabRow {
  id: string;
  version_id: string;
  title: string;
  position: number;
}

interface GroupRow {
  id: string;
  version_id: string;
  tab_id: string;
  title: string;
  position: number;
}

interface PageRow {
  id: string;
  version_id: string;
  group_id: string;
  path: string;
  title: string;
  kind: PageKind;
  operation_id: string | null;
  source: string;
  revision: number;
  state: PageState;
  has_draft_changes: boolean;
  position: number;
  updated_at: Date;
  updated_by: string | null;
}

const toSite = (row: SiteRow): Site => ({
  id: row.id,
  teamId: row.team_id,
  slug: row.slug,
  title: row.title,
});

const toVersion = (row: VersionRow): Version => ({
  id: row.id,
  siteId: row.site_id,
  slug: row.slug,
  title: row.title,
  isDefault: row.is_default,
  publishedAt: row.published_at,
  liveSnapshotId: row.live_snapshot_id,
  position: row.position,
});

const toTab = (row: TabRow): Tab => ({
  id: row.id,
  versionId: row.version_id,
  title: row.title,
  position: row.position,
});

const toGroup = (row: GroupRow): Group => ({
  id: row.id,
  versionId: row.version_id,
  tabId: row.tab_id,
  title: row.title,
  position: row.position,
});

const toPage = (row: PageRow): Page => ({
  id: row.id,
  versionId: row.version_id,
  groupId: row.group_id,
  path: row.path,
  title: row.title,
  kind: row.kind,
  operationId: row.operation_id,
  source: row.source,
  revision: row.revision,
  state: row.state,
  hasDraftChanges: row.has_draft_changes,
  position: row.position,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
});

export async function createSite(
  q: Queryable,
  input: { teamId: string; slug: string; title: string },
): Promise<Site> {
  const id = newId('site');
  await q.query('INSERT INTO sites (id, team_id, slug, title) VALUES ($1, $2, $3, $4)', [
    id,
    input.teamId,
    input.slug,
    input.title,
  ]);
  return { id, ...input };
}

export async function siteById(id: string): Promise<Site | null> {
  const { rows } = await db.query<SiteRow>('SELECT * FROM sites WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toSite(rows[0]);
}

export async function siteBySlug(slug: string): Promise<Site | null> {
  const { rows } = await db.query<SiteRow>('SELECT * FROM sites WHERE slug = $1', [slug]);
  return rows[0] === undefined ? null : toSite(rows[0]);
}

export async function sitesOfTeam(teamId: string): Promise<Site[]> {
  const { rows } = await db.query<SiteRow>(
    'SELECT * FROM sites WHERE team_id = $1 ORDER BY created_at',
    [teamId],
  );
  return rows.map(toSite);
}

export async function createVersion(
  q: Queryable,
  input: { siteId: string; slug: string; title: string; isDefault: boolean },
): Promise<Version> {
  const id = newId('version');
  const { rows } = await q.query<VersionRow>(
    `INSERT INTO versions (id, site_id, slug, title, is_default, position)
     VALUES ($1, $2, $3, $4, $5,
             (SELECT coalesce(max(position) + 1, 0) FROM versions WHERE site_id = $2))
     RETURNING *`,
    [id, input.siteId, input.slug, input.title, input.isDefault],
  );
  return toVersion(rows[0]);
}

export async function versionById(id: string): Promise<Version | null> {
  const { rows } = await db.query<VersionRow>('SELECT * FROM versions WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toVersion(rows[0]);
}

export async function versionsOfSite(siteId: string): Promise<Version[]> {
  const { rows } = await db.query<VersionRow>(
    'SELECT * FROM versions WHERE site_id = $1 ORDER BY position',
    [siteId],
  );
  return rows.map(toVersion);
}

export async function siteOfVersion(versionId: string): Promise<{ site: Site; version: Version } | null> {
  const { rows } = await db.query<SiteRow & { version_id: string }>(
    `SELECT sites.*, versions.id AS version_id FROM versions
       JOIN sites ON sites.id = versions.site_id
     WHERE versions.id = $1`,
    [versionId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const version = await versionById(versionId);
  return version === null ? null : { site: toSite(row), version };
}

export async function versionBySlug(siteId: string, slug: string): Promise<Version | null> {
  const { rows } = await db.query<VersionRow>(
    'SELECT * FROM versions WHERE site_id = $1 AND slug = $2',
    [siteId, slug],
  );
  return rows[0] === undefined ? null : toVersion(rows[0]);
}

export async function setDefaultVersion(siteId: string, versionId: string): Promise<void> {
  await db.query('UPDATE versions SET is_default = (id = $2) WHERE site_id = $1', [siteId, versionId]);
}

export async function createTab(
  q: Queryable,
  input: { versionId: string; title: string },
): Promise<Tab> {
  const id = newId('tab');
  const { rows } = await q.query<TabRow>(
    `INSERT INTO tabs (id, version_id, title, position)
     VALUES ($1, $2, $3, (SELECT coalesce(max(position) + 1, 0) FROM tabs WHERE version_id = $2))
     RETURNING *`,
    [id, input.versionId, input.title],
  );
  return toTab(rows[0]);
}

export async function createGroup(
  q: Queryable,
  input: { versionId: string; tabId: string; title: string },
): Promise<Group> {
  const id = newId('group');
  const { rows } = await q.query<GroupRow>(
    `INSERT INTO groups (id, version_id, tab_id, title, position)
     VALUES ($1, $2, $3, $4, (SELECT coalesce(max(position) + 1, 0) FROM groups WHERE tab_id = $3))
     RETURNING *`,
    [id, input.versionId, input.tabId, input.title],
  );
  return toGroup(rows[0]);
}

export async function tabsOfVersion(q: Queryable, versionId: string): Promise<Tab[]> {
  const { rows } = await q.query<TabRow>(
    'SELECT * FROM tabs WHERE version_id = $1 ORDER BY position',
    [versionId],
  );
  return rows.map(toTab);
}

export async function groupsOfVersion(q: Queryable, versionId: string): Promise<Group[]> {
  const { rows } = await q.query<GroupRow>(
    `SELECT groups.* FROM groups JOIN tabs ON tabs.id = groups.tab_id
     WHERE groups.version_id = $1 ORDER BY tabs.position, groups.position`,
    [versionId],
  );
  return rows.map(toGroup);
}

export async function groupById(id: string): Promise<Group | null> {
  const { rows } = await db.query<GroupRow>('SELECT * FROM groups WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toGroup(rows[0]);
}

export async function tabById(id: string): Promise<Tab | null> {
  const { rows } = await db.query<TabRow>('SELECT * FROM tabs WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toTab(rows[0]);
}

/** Every page of a version, removed ones included, in navigation order. */
export async function pagesOfVersion(q: Queryable, versionId: string): Promise<Page[]> {
  const { rows } = await q.query<PageRow>(
    `SELECT pages.* FROM pages
       JOIN groups ON groups.id = pages.group_id
       JOIN tabs ON tabs.id = groups.tab_id
     WHERE pages.version_id = $1
     ORDER BY tabs.position, groups.position, pages.position`,
    [versionId],
  );
  return rows.map(toPage);
}

export const livePages = (pages: readonly Page[]): Page[] =>
  pages.filter((page) => page.state !== 'removed');

export async function pageById(q: Queryable, id: string): Promise<Page | null> {
  const { rows } = await q.query<PageRow>('SELECT * FROM pages WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toPage(rows[0]);
}

export async function createPage(
  q: Queryable,
  input: {
    versionId: string;
    groupId: string;
    path: string;
    title: string;
    source: string;
    kind?: PageKind;
    operationId?: string | null;
    state?: PageState;
    updatedBy: string | null;
  },
): Promise<Page> {
  const id = newId('page');
  const { rows } = await q.query<PageRow>(
    `INSERT INTO pages (id, version_id, group_id, path, title, kind, operation_id, source,
                        revision, state, has_draft_changes, position, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, true,
             (SELECT coalesce(max(position) + 1, 0) FROM pages WHERE group_id = $3), $10)
     RETURNING *`,
    [
      id,
      input.versionId,
      input.groupId,
      input.path,
      input.title,
      input.kind ?? 'page',
      input.operationId ?? null,
      input.source,
      input.state ?? 'draft',
      input.updatedBy,
    ],
  );
  return toPage(rows[0]);
}

export async function savePage(
  q: Queryable,
  input: { id: string; title: string; source: string; updatedBy: string | null },
): Promise<Page> {
  const { rows } = await q.query<PageRow>(
    `UPDATE pages SET title = $2, source = $3, revision = revision + 1, has_draft_changes = true,
                      updated_at = now(), updated_by = $4
     WHERE id = $1 RETURNING *`,
    [input.id, input.title, input.source, input.updatedBy],
  );
  return toPage(rows[0]);
}

export async function setPagePath(q: Queryable, id: string, path: string): Promise<Page> {
  const { rows } = await q.query<PageRow>(
    `UPDATE pages SET path = $2, has_draft_changes = true, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, path],
  );
  return toPage(rows[0]);
}

export async function setPageState(q: Queryable, id: string, state: PageState): Promise<Page> {
  const { rows } = await q.query<PageRow>(
    'UPDATE pages SET state = $2 WHERE id = $1 RETURNING *',
    [id, state],
  );
  return toPage(rows[0]);
}

export async function setPageSource(
  q: Queryable,
  input: { id: string; source: string },
): Promise<Page> {
  const { rows } = await q.query<PageRow>(
    `UPDATE pages SET source = $2, revision = revision + 1, has_draft_changes = true, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [input.id, input.source],
  );
  return toPage(rows[0]);
}

async function reposition(
  q: Queryable,
  table: 'pages' | 'groups',
  ids: readonly string[],
): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await q.query(`UPDATE ${table} SET position = $2 WHERE id = $1`, [ids[index], index]);
  }
}

export async function movePage(
  q: Queryable,
  page: Page,
  groupId: string,
  index: number,
): Promise<void> {
  const pages = await pagesOfVersion(q, page.versionId);
  const target = pages.filter((other) => other.groupId === groupId && other.id !== page.id);
  const source = pages.filter((other) => other.groupId === page.groupId && other.id !== page.id);
  const slot = Math.max(0, Math.min(index, target.length));
  const ordered = [...target.slice(0, slot).map((p) => p.id), page.id, ...target.slice(slot).map((p) => p.id)];
  await q.query('UPDATE pages SET group_id = $2 WHERE id = $1', [page.id, groupId]);
  if (page.groupId !== groupId) await reposition(q, 'pages', source.map((p) => p.id));
  await reposition(q, 'pages', ordered);
}

export async function moveGroup(
  q: Queryable,
  group: Group,
  tabId: string,
  index: number,
): Promise<void> {
  const groups = await groupsOfVersion(q, group.versionId);
  const target = groups.filter((other) => other.tabId === tabId && other.id !== group.id);
  const source = groups.filter((other) => other.tabId === group.tabId && other.id !== group.id);
  const slot = Math.max(0, Math.min(index, target.length));
  const ordered = [...target.slice(0, slot).map((g) => g.id), group.id, ...target.slice(slot).map((g) => g.id)];
  await q.query('UPDATE groups SET tab_id = $2 WHERE id = $1', [group.id, tabId]);
  if (group.tabId !== tabId) await reposition(q, 'groups', source.map((g) => g.id));
  await reposition(q, 'groups', ordered);
}

export async function redirectsOfVersion(q: Queryable, versionId: string): Promise<Redirect[]> {
  const { rows } = await q.query<{ from_path: string; to_path: string; kind: RedirectKind }>(
    'SELECT from_path, to_path, kind FROM redirects WHERE version_id = $1',
    [versionId],
  );
  return sortRedirects(rows.map((row) => ({ from: row.from_path, to: row.to_path, kind: row.kind })));
}

export async function replaceRedirects(
  q: Queryable,
  versionId: string,
  redirects: readonly Redirect[],
): Promise<void> {
  await q.query('DELETE FROM redirects WHERE version_id = $1', [versionId]);
  for (const redirect of redirects) {
    await q.query(
      'INSERT INTO redirects (version_id, from_path, to_path, kind) VALUES ($1, $2, $3, $4)',
      [versionId, redirect.from, redirect.to, redirect.kind],
    );
  }
}

export async function removeRedirect(versionId: string, from: string): Promise<void> {
  await db.query('DELETE FROM redirects WHERE version_id = $1 AND from_path = $2', [versionId, from]);
}

export interface Asset {
  id: string;
  siteId: string;
  contentType: string;
  objectKey: string;
}

export async function createAsset(input: {
  siteId: string;
  contentType: string;
  bytes: number;
  objectKey: string;
  id: string;
}): Promise<void> {
  await db.query(
    'INSERT INTO assets (id, site_id, content_type, bytes, object_key) VALUES ($1, $2, $3, $4, $5)',
    [input.id, input.siteId, input.contentType, input.bytes, input.objectKey],
  );
}

export async function assetById(siteId: string, id: string): Promise<Asset | null> {
  const { rows } = await db.query<{
    id: string;
    site_id: string;
    content_type: string;
    object_key: string;
  }>('SELECT id, site_id, content_type, object_key FROM assets WHERE id = $1 AND site_id = $2', [
    id,
    siteId,
  ]);
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, siteId: row.site_id, contentType: row.content_type, objectKey: row.object_key };
}

export async function assetIdsOfSite(siteId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM assets WHERE site_id = $1', [
    siteId,
  ]);
  return new Set(rows.map((row) => row.id));
}

export interface OpenapiImport {
  id: string;
  versionId: string;
  groupId: string;
  fileName: string;
  bytes: number;
  sha256: string;
  objectKey: string;
  spec: unknown;
  importedAt: Date;
}

export async function saveImport(
  q: Queryable,
  input: Omit<OpenapiImport, 'importedAt'>,
): Promise<void> {
  await q.query('DELETE FROM openapi_imports WHERE version_id = $1', [input.versionId]);
  await q.query(
    `INSERT INTO openapi_imports (id, version_id, group_id, file_name, bytes, sha256, object_key, spec)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.versionId,
      input.groupId,
      input.fileName,
      input.bytes,
      input.sha256,
      input.objectKey,
      JSON.stringify(input.spec),
    ],
  );
}

export async function importOfVersion(versionId: string): Promise<OpenapiImport | null> {
  const { rows } = await db.query<{
    id: string;
    version_id: string;
    group_id: string;
    file_name: string;
    bytes: number;
    sha256: string;
    object_key: string;
    spec: unknown;
    imported_at: Date;
  }>('SELECT * FROM openapi_imports WHERE version_id = $1', [versionId]);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        versionId: row.version_id,
        groupId: row.group_id,
        fileName: row.file_name,
        bytes: row.bytes,
        sha256: row.sha256,
        objectKey: row.object_key,
        spec: row.spec,
        importedAt: row.imported_at,
      };
}
