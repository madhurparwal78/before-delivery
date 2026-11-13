import { pool } from './db';

export type PageRow = {
  id: string; version_id: string; group_id: string | null; position: number;
  path: string; title: string; kind: string; operation_id: string | null;
  source: string; revision: number; state: string; has_draft_changes: boolean;
  updated_at: Date; updated_by: string | null;
};

export type VersionRow = { id: string; site_id: string; slug: string; title: string; position: number };
export type GroupRow = { id: string; tab_id: string; title: string; position: number };
export type TabRow = { id: string; version_id: string; title: string; position: number };
export type SiteRow = { id: string; team_id: string; slug: string; title: string; default_version_id: string | null };

export async function getPage(pageId: string): Promise<PageRow | null> {
  const r = await pool.query('SELECT * FROM pages WHERE id = $1', [pageId]);
  return r.rows[0] ?? null;
}

export async function getVersionsPages(versionId: string): Promise<PageRow[]> {
  const r = await pool.query('SELECT * FROM pages WHERE version_id = $1 ORDER BY position', [versionId]);
  return r.rows;
}

export async function getLivePages(versionId: string): Promise<PageRow[]> {
  const r = await pool.query("SELECT * FROM pages WHERE version_id = $1 AND state != 'removed' ORDER BY position", [versionId]);
  return r.rows;
}

export async function getSite(siteId: string): Promise<SiteRow | null> {
  const r = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
  return r.rows[0] ?? null;
}

export async function getSiteBySlug(slug: string): Promise<SiteRow | null> {
  const r = await pool.query('SELECT * FROM sites WHERE slug = $1', [slug]);
  return r.rows[0] ?? null;
}

export async function getVersion(versionId: string): Promise<VersionRow | null> {
  const r = await pool.query('SELECT * FROM versions WHERE id = $1', [versionId]);
  return r.rows[0] ?? null;
}

export async function getSiteVersions(siteId: string): Promise<VersionRow[]> {
  const r = await pool.query('SELECT * FROM versions WHERE site_id = $1 ORDER BY position, created_at', [siteId]);
  return r.rows;
}

export async function getVersionBySlug(siteId: string, slug: string): Promise<VersionRow | null> {
  const r = await pool.query('SELECT * FROM versions WHERE site_id = $1 AND slug = $2', [siteId, slug]);
  return r.rows[0] ?? null;
}

export async function getTabs(versionId: string): Promise<TabRow[]> {
  const r = await pool.query('SELECT * FROM tabs WHERE version_id = $1 ORDER BY position', [versionId]);
  return r.rows;
}

export async function getGroupsForTabs(tabIds: string[]): Promise<GroupRow[]> {
  if (tabIds.length === 0) return [];
  const r = await pool.query(
    'SELECT * FROM groups WHERE tab_id = ANY($1) ORDER BY position',
    [tabIds],
  );
  return r.rows;
}

export async function getRedirects(versionId: string): Promise<{ id: string; from_path: string; to_path: string; kind: string }[]> {
  const r = await pool.query('SELECT * FROM redirects WHERE version_id = $1 ORDER BY from_path', [versionId]);
  return r.rows;
}

export type NavigationJson = {
  versionId: string;
  tabs: { id: string; title: string; groups: { id: string; title: string; pages: string[] }[] }[];
  redirects: { from: string; to: string; kind: string }[];
};

export async function navigationJson(versionId: string): Promise<NavigationJson> {
  const tabs = await getTabs(versionId);
  const groups = await getGroupsForTabs(tabs.map((t) => t.id));
  const pages = await getLivePages(versionId);
  const redirects = await getRedirects(versionId);
  const pagesByGroup = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.group_id) continue;
    const list = pagesByGroup.get(p.group_id) ?? [];
    list.push(p.id);
    pagesByGroup.set(p.group_id, list);
  }
  return {
    versionId,
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title,
      groups: groups
        .filter((g) => g.tab_id === t.id)
        .map((g) => ({ id: g.id, title: g.title, pages: (pagesByGroup.get(g.id) ?? []).sort((a, b) => byPos(pages, a, b)) })),
    })),
    redirects: redirects.map((r) => ({ from: r.from_path, to: r.to_path, kind: r.kind })),
  };
}

function byPos(pages: PageRow[], a: string, b: string): number {
  const pa = pages.find((p) => p.id === a)?.position ?? 0;
  const pb = pages.find((p) => p.id === b)?.position ?? 0;
  return pa - pb;
}
