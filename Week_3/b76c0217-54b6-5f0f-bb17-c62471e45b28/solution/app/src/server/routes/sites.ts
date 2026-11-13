import { db, isUniqueViolation, one, transaction, type Db } from '../db';
import { fail } from '../errors';
import { endpoint, reply } from '../http';
import { newId } from '../ids';
import { Fields } from '../input';
import { siteScope, versionScope, type SiteScope } from '../domain/scopes';
import { isSlug } from '../../shared/rules';
import type { SiteJson, VersionJson } from '../../shared/types';

async function loadSite(source: Db, site: SiteScope): Promise<SiteJson> {
  const versions = await source.query<{ id: string; slug: string; title: string; isDefault: boolean; publishedAt: Date | null }>(
    'select id, slug, title, is_default, published_at from versions where site_id = $1 order by created_at, id',
    [site.id],
  );
  return {
    ...site,
    versions: versions.map((v) => ({ id: v.id, slug: v.slug, title: v.title, default: v.isDefault, publishedAt: v.publishedAt?.toISOString() ?? null })),
  };
}

export async function sitesOfTeam(teamId: string): Promise<SiteJson[]> {
  const sites = await db.query<SiteScope>('select id, slug, title from sites where team_id = $1 order by created_at, id', [teamId]);
  return Promise.all(sites.map((site) => loadSite(db, site)));
}

/** Copy a version: new ids everywhere, the same sources, navigation and redirects, and no publish. */
async function copyVersion(tx: Db, fromVersionId: string, slug: string, title: string, siteId: string): Promise<string> {
  const versionId = newId('ver');
  await tx.query('insert into versions (id, site_id, slug, title) values ($1, $2, $3, $4)', [versionId, siteId, slug, title]);
  const tabs = await tx.query<{ id: string; title: string; position: number }>('select id, title, position from tabs where version_id = $1', [fromVersionId]);
  const groups = await tx.query<{ id: string; tabId: string; title: string; position: number }>('select id, tab_id, title, position from groups where version_id = $1', [fromVersionId]);
  const pages = await tx.query<{ id: string; groupId: string; position: number; path: string; title: string; kind: string; operationId: string | null; source: string; sig: string; updatedBy: string }>(
    'select id, group_id, position, path, title, kind, operation_id, source, sig, updated_by from pages where version_id = $1 and not removed',
    [fromVersionId],
  );
  const tabIds = new Map(tabs.map((tab) => [tab.id, newId('tab')]));
  const groupIds = new Map(groups.map((group) => [group.id, newId('grp')]));
  for (const tab of tabs) {
    await tx.query('insert into tabs (id, version_id, title, position) values ($1, $2, $3, $4)', [tabIds.get(tab.id), versionId, tab.title, tab.position]);
  }
  for (const group of groups) {
    await tx.query('insert into groups (id, tab_id, version_id, title, position) values ($1, $2, $3, $4, $5)', [groupIds.get(group.id), tabIds.get(group.tabId), versionId, group.title, group.position]);
  }
  for (const page of pages) {
    await tx.query(
      `insert into pages (id, version_id, group_id, position, path, title, kind, operation_id, source, sig, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [newId('pg'), versionId, groupIds.get(page.groupId), page.position, page.path, page.title, page.kind, page.operationId, page.source, page.sig, page.updatedBy],
    );
  }
  await tx.query(
    'insert into redirects (version_id, from_path, to_path, kind) select $2, from_path, to_path, kind from redirects where version_id = $1',
    [fromVersionId, versionId],
  );
  await tx.query(
    `insert into openapi_imports (id, version_id, file_name, bytes, sha256, s3_key, document, imported_at)
     select $3, $2, file_name, bytes, sha256, s3_key, document, imported_at from openapi_imports where version_id = $1 order by imported_at desc, id desc limit 1`,
    [fromVersionId, versionId, newId('imp')],
  );
  return versionId;
}

export function siteRoutes(): void {
  endpoint('GET', '/api/sites/:siteId', {
    access: 'member',
    prepare: (ctx) => siteScope(ctx.principal, ctx.params.siteId ?? ''),
    handle: async (_ctx, site) => reply.json(200, await loadSite(db, site)),
  });

  endpoint('POST', '/api/sites/:siteId/versions', {
    access: 'editor',
    body: 'json',
    prepare: (ctx) => siteScope(ctx.principal, ctx.params.siteId ?? ''),
    handle: async (ctx, site) => {
      const fields = new Fields(ctx.json);
      const slug = fields.text('slug', 60);
      const title = fields.text('title', 100);
      const fromVersionId = fields.text('fromVersionId', 100);
      if (slug !== '' && (await one(db, 'select 1 as x from versions where site_id = $1 and slug = $2', [site.id, slug])) !== null) {
        throw fail.slugTaken();
      }
      if (slug !== '' && !isSlug(slug)) {
        fields.problems.slug = 'Slugs use letters, digits, hyphens and underscores.';
      }
      const source = fromVersionId === '' ? null : await one(db, 'select 1 as x from versions where id = $1 and site_id = $2', [fromVersionId, site.id]);
      if (fromVersionId !== '' && source === null) {
        fields.problems.fromVersionId = 'Choose a version of this site.';
      }
      fields.check();
      const id = await transaction((tx) => copyVersion(tx, fromVersionId, slug, title, site.id)).catch((error: unknown) => {
        throw isUniqueViolation(error) ? fail.slugTaken() : error;
      });
      const version: VersionJson = { id, slug, title, default: false, publishedAt: null };
      return reply.json(201, version);
    },
  });

  endpoint('POST', '/api/versions/:versionId/make-default', {
    access: 'owner',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (_ctx, version) => {
      const made = await db.query(
        'update versions set is_default = (id = $1) where site_id = $2 and exists (select 1 from versions where id = $1 and live_snapshot_id is not null) returning id',
        [version.id, version.siteId],
      );
      if (made.length === 0) {
        throw fail.versionUnpublished();
      }
      return reply.json(200, await loadSite(db, { id: version.siteId, slug: version.siteSlug, title: version.siteTitle }));
    },
  });
}
