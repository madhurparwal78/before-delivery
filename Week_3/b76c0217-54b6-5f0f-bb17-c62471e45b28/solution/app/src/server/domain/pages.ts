// Pages: their JSON document, their state, their signature and the saves that change them.

import { createHash } from 'node:crypto';
import { one, type Db } from '../db';
import { fail } from '../errors';
import { newId } from '../ids';
import { compactGroup } from './navigation';
import type { PageJson, PageKind, PageState, UserRef } from '../../shared/types';

export interface PageRow {
  id: string;
  versionId: string;
  groupId: string;
  path: string;
  title: string;
  kind: PageKind;
  operationId: string | null;
  source: string;
  revision: number;
  removed: boolean;
  publishedOnce: boolean;
  sig: string;
  publishedSig: string | null;
  updatedAt: Date;
  updatedBy: string;
  updatedByName: string;
  previewing: boolean;
}

const PAGE_COLUMNS = `p.id, p.version_id, p.group_id, p.path, p.title, p.kind, p.operation_id, p.source, p.revision,
  p.removed, p.published_once, p.sig, p.published_sig, p.updated_at, p.updated_by, u.name as updated_by_name,
  exists (select 1 from preview_links l where l.page_id = p.id and not l.revoked and l.expires_at > now()) as previewing`;

/** A page is removed after a delete, published once a publish included it, in preview while a live link exists. */
function pageState(page: Pick<PageRow, 'removed' | 'publishedOnce' | 'previewing'>): PageState {
  if (page.removed) {
    return 'removed';
  }
  if (page.publishedOnce) {
    return 'published';
  }
  return page.previewing ? 'in_preview' : 'draft';
}

/** What the reader would see of a page: a change to any part of it changes the signature. */
function signatureOf(path: string, title: string, source: string): string {
  return createHash('sha1').update(`${path}\0${title}\0${source}`).digest('hex');
}

export function pageJson(row: PageRow): PageJson {
  return {
    id: row.id,
    versionId: row.versionId,
    path: row.path,
    title: row.title,
    kind: row.kind,
    operationId: row.operationId,
    source: row.source,
    revision: row.revision,
    state: pageState(row),
    hasDraftChanges: row.sig !== row.publishedSig,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: { id: row.updatedBy, name: row.updatedByName },
  };
}

export async function loadPage(source: Db, pageId: string): Promise<PageRow | null> {
  return one<PageRow>(source, `select ${PAGE_COLUMNS} from pages p join users u on u.id = p.updated_by where p.id = $1`, [pageId]);
}

export async function loadPages(source: Db, versionId: string): Promise<PageRow[]> {
  return source.query<PageRow>(
    `select ${PAGE_COLUMNS} from pages p join users u on u.id = p.updated_by
      where p.version_id = $1 and not p.removed order by p.group_id, p.position`,
    [versionId],
  );
}

export async function requirePage(source: Db, pageId: string): Promise<PageRow> {
  const row = await loadPage(source, pageId);
  if (row === null) {
    throw fail.notFound();
  }
  return row;
}

export const savedBy = (row: PageRow): UserRef => ({ id: row.updatedBy, name: row.updatedByName });

export async function insertPage(
  source: Db,
  page: { versionId: string; groupId: string; path: string; title: string; source: string; userId: string; kind?: PageKind; operationId?: string },
): Promise<string> {
  const id = newId('pg');
  await source.query(
    `insert into pages (id, version_id, group_id, position, path, title, kind, operation_id, source, sig, updated_by)
     values ($1, $2, $3, (select count(*) from pages where group_id = $3 and not removed), $4, $5, $6, $7, $8, $9, $10)`,
    [id, page.versionId, page.groupId, page.path, page.title, page.kind ?? 'page', page.operationId ?? null, page.source,
     signatureOf(page.path, page.title, page.source), page.userId],
  );
  return id;
}

/** Write a page's new fields and bump its revision. With `revision`, the write happens only on that revision. */
export async function writePage(
  source: Db,
  pageId: string,
  fields: { path: string; title: string; source: string; userId: string; revision?: number },
): Promise<boolean> {
  const written = await source.query(
    `update pages set path = $2, title = $3, source = $4, sig = $5, revision = revision + 1, updated_at = now(), updated_by = $6
      where id = $1 and not removed and ($7::integer is null or revision = $7) returning id`,
    [pageId, fields.path, fields.title, fields.source, signatureOf(fields.path, fields.title, fields.source), fields.userId, fields.revision ?? null],
  );
  return written.length === 1;
}

/** A page leaves the version: its path becomes free, redirects that led to it are dropped, links to it are revoked. */
export async function removePage(tx: Db, page: PageRow): Promise<void> {
  await tx.query('update pages set removed = true, updated_at = now() where id = $1 and not removed', [page.id]);
  await tx.query('delete from redirects where version_id = $1 and to_path = $2', [page.versionId, `/${page.path}`]);
  await tx.query('update preview_links set revoked = true where page_id = $1', [page.id]);
  await compactGroup(tx, page.groupId);
}
