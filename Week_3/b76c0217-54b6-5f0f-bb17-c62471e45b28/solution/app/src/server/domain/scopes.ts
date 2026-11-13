// Locating the resource a request names. An unknown id and an id of another team look the same: not found.

import { db, one, type Db } from '../db';
import { fail } from '../errors';
import type { Principal } from '../auth';

export interface VersionScope {
  id: string;
  slug: string;
  title: string;
  siteId: string;
  siteSlug: string;
  siteTitle: string;
  teamId: string;
  isDefault: boolean;
  liveSnapshotId: string | null;
}

const VERSION_COLUMNS = `v.id, v.slug, v.title, v.site_id, s.slug as site_slug, s.title as site_title, s.team_id,
  v.is_default, v.live_snapshot_id`;

export async function versionScope(principal: Principal, versionId: string, source: Db = db): Promise<VersionScope> {
  const row = await one<VersionScope>(
    source,
    `select ${VERSION_COLUMNS} from versions v join sites s on s.id = v.site_id where v.id = $1 and s.team_id = $2`,
    [versionId, principal.teamId],
  );
  if (row === null) {
    throw fail.notFound();
  }
  return row;
}

export async function versionBySlugs(principal: Principal, siteSlug: string, versionSlug: string): Promise<VersionScope | null> {
  return one<VersionScope>(
    db,
    `select ${VERSION_COLUMNS} from versions v join sites s on s.id = v.site_id where s.slug = $1 and v.slug = $2 and s.team_id = $3`,
    [siteSlug, versionSlug, principal.teamId],
  );
}

export async function versionById(versionId: string): Promise<VersionScope> {
  return (await db.query<VersionScope>(`select ${VERSION_COLUMNS} from versions v join sites s on s.id = v.site_id where v.id = $1`, [versionId]))[0] as VersionScope;
}

export async function versionOfPage(principal: Principal, pageId: string, source: Db = db): Promise<VersionScope> {
  const row = await one<VersionScope>(
    source,
    `select ${VERSION_COLUMNS} from pages p join versions v on v.id = p.version_id join sites s on s.id = v.site_id
      where p.id = $1 and s.team_id = $2`,
    [pageId, principal.teamId],
  );
  if (row === null) {
    throw fail.notFound();
  }
  return row;
}

export async function versionOfGroup(principal: Principal, groupId: string, source: Db = db): Promise<VersionScope> {
  const row = await one<VersionScope>(
    source,
    `select ${VERSION_COLUMNS} from groups g join versions v on v.id = g.version_id join sites s on s.id = v.site_id
      where g.id = $1 and s.team_id = $2`,
    [groupId, principal.teamId],
  );
  if (row === null) {
    throw fail.notFound();
  }
  return row;
}

export interface SiteScope {
  id: string;
  slug: string;
  title: string;
}

export async function siteScope(principal: Principal, siteId: string): Promise<SiteScope> {
  const row = await one<SiteScope>(db, 'select id, slug, title from sites where id = $1 and team_id = $2', [siteId, principal.teamId]);
  if (row === null) {
    throw fail.notFound();
  }
  return row;
}
