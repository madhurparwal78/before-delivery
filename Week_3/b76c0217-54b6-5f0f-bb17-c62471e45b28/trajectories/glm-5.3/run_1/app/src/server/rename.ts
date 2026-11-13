import { pool } from './db';
import { ApiError } from '../errors';
import { copy } from '../shared/copy';
import { withLeadingSlash } from '../shared/rules';
import { detectLoop } from './redirects';
import { getPage, getLivePages, navigationJson } from './queries';
import { events } from './events';
import { newId } from './ids';
import type { PageRow } from './queries';

export type RenameResult = {
  page: unknown;
  navigation: unknown;
  linksRewritten: number;
  redirectAdded: { from: string; to: string } | null;
  redirectRemoved: { from: string; to: string } | null;
};

export async function renamePage(page: PageRow, newPath: string, revision: number, userId: string, userName: string): Promise<RenameResult> {
  if (page.state === 'removed') throw new ApiError('page_removed', 'This page was removed.');
  if (page.revision !== revision) {
    throw new ApiError('revision_conflict', copy.conflict(userName), { savedBy: { id: userId, name: userName } });
  }
  const oldPath = page.path;
  if (oldPath === newPath) {
    const nav = await navigationJson(page.version_id);
    return { page, navigation: nav, linksRewritten: 0, redirectAdded: null, redirectRemoved: null };
  }

  const clash = await pool.query<{ id: string }>(
    "SELECT id FROM pages WHERE version_id = $1 AND path = $2 AND state != 'removed' AND id != $3",
    [page.version_id, newPath, page.id],
  );
  const autoRedirect = await pool.query<{ id: string; from_path: string; to_path: string }>(
    "SELECT id, from_path, to_path FROM redirects WHERE version_id = $1 AND from_path = $2 AND kind = 'auto'",
    [page.version_id, newPath],
  );
  const autoRow = autoRedirect.rows[0];
  const clashBlocked = clash.rows.length > 0 && !(autoRow && autoRow.to_path === oldPath);
  if (clashBlocked) throw new ApiError('path_taken', copy.pathTaken(withLeadingSlash(newPath)));

  const redirects = new Map((await pool.query<{ from_path: string; to_path: string }>(
    'SELECT from_path, to_path FROM redirects WHERE version_id = $1', [page.version_id],
  )).rows.map((r) => [r.from_path, r.to_path]));

  let redirectRemoved: { from: string; to: string } | null = null;
  const working = new Map(redirects);
  if (autoRow) {
    if (autoRow.to_path !== oldPath) {
      await pool.query('DELETE FROM redirects WHERE id = $1', [autoRow.id]);
      redirectRemoved = { from: withLeadingSlash(newPath), to: withLeadingSlash(autoRow.to_path) };
      working.delete(newPath);
    }
  }

  const existingAutoToOld = await pool.query<{ id: string; from_path: string; to_path: string }>(
    "SELECT id, from_path, to_path FROM redirects WHERE version_id = $1 AND to_path = $2 AND kind = 'auto' AND from_path = $3",
    [page.version_id, oldPath, newPath],
  );
  if (existingAutoToOld.rows.length > 0) {
    await pool.query('DELETE FROM redirects WHERE id = $1', [existingAutoToOld.rows[0].id]);
    redirectRemoved = { from: withLeadingSlash(newPath), to: withLeadingSlash(oldPath) };
    working.delete(newPath);
  }

  const cycle = detectLoop(newPath, oldPath, new Map([...working].filter(([k]) => k !== newPath)));
  if (cycle) {
    const cyclePaths = cycle.map(withLeadingSlash);
    throw new ApiError('redirect_loop', copy.redirectLoop(cyclePaths), { cycle: cyclePaths });
  }

  let linksRewritten = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const newRevision = page.revision + 1;
    await client.query(
      'UPDATE pages SET path = $2, revision = $3, has_draft_changes = true, updated_at = now(), updated_by = $4 WHERE id = $1',
      [page.id, newPath, newRevision, userId],
    );
    const toUpdate = await client.query<PageRow>(
      "SELECT * FROM pages WHERE version_id = $1 AND state != 'removed' AND id != $2", [page.version_id, page.id],
    );
    for (const other of toUpdate.rows) {
      const { source, count } = rewriteLinks(other.source, oldPath, newPath);
      if (count > 0) {
        linksRewritten += count;
        await client.query(
          'UPDATE pages SET source = $2, revision = revision + 1, has_draft_changes = true, updated_at = now(), updated_by = $3 WHERE id = $1',
          [other.id, source, userId],
        );
      }
    }
    await client.query(
      'INSERT INTO redirects (id, version_id, from_path, to_path, kind) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (version_id, from_path) DO UPDATE SET to_path = EXCLUDED.to_path',
      [newId('red'), page.version_id, oldPath, newPath, 'auto'],
    );
    await client.query(
      'UPDATE redirects SET to_path = $3 WHERE version_id = $1 AND to_path = $2',
      [page.version_id, oldPath, newPath],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const updated = (await getPage(page.id))!;
  const nav = await navigationJson(page.version_id);
  events.navigation(page.version_id, nav);
  events.page(page.id, page.version_id, pageJson(updated, userName));
  for (const other of await getLivePages(page.version_id)) {
    if (other.id !== page.id) events.page(other.id, page.version_id, pageJson(other, userName));
  }
  return {
    page: pageJson(updated, userName),
    navigation: nav,
    linksRewritten,
    redirectAdded: { from: withLeadingSlash(oldPath), to: withLeadingSlash(newPath) },
    redirectRemoved,
  };
}

export function pageJson(p: PageRow, updatedByName: string | null): unknown {
  return {
    id: p.id, versionId: p.version_id, path: p.path, title: p.title, kind: p.kind,
    operationId: p.operation_id, source: p.source, revision: p.revision, state: p.state,
    hasDraftChanges: p.has_draft_changes,
    updatedAt: new Date(p.updated_at).toISOString(),
    updatedBy: { id: p.updated_by ?? '', name: updatedByName ?? '' },
  };
}

export function rewriteLinks(source: string, oldPath: string, newPath: string): { source: string; count: number } {
  let count = 0;
  const lines = source.split('\n');
  let inFence = false;
  const out = lines.map((line) => {
    if (line.trim().startsWith('```')) { inFence = !inFence; return line; }
    if (inFence) return line;
    const replaced = line.replace(/\]\((\/[^)#\s]*)(#[^)]*)?\)/g, (match, pathPart, anchorPart) => {
      if (pathPart.slice(1) !== oldPath) return match;
      count++;
      return `](/${newPath}${anchorPart ?? ''})`;
    });
    return replaced;
  });
  return { source: out.join('\n'), count };
}
