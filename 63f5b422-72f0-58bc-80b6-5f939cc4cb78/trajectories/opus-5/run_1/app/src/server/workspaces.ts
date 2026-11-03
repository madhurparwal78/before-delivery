import type { ImageIndex } from '../shared/apply.js';
import { uniqueSlug } from '../shared/slug.js';
import { emptyStyles } from '../shared/tree.js';
import type { PlinthDocument, Role } from '../shared/types.js';
import { one, query } from './db.js';
import { notFound } from './errors.js';
import { newId } from './ids.js';

export interface WorkspaceAccess {
  workspaceId: string;
  name: string;
  slug: string;
  role: Role;
}

export function seedDocument(id: string, name: string, slug: string): PlinthDocument {
  return {
    id,
    name,
    slug,
    seq: 0,
    tokens: [
      { name: 'ink', kind: 'color', value: 'black' },
      { name: 'paper', kind: 'color', value: 'white' },
      { name: 'space-md', kind: 'size', value: 16, unit: 'px' },
      { name: 'size-xl', kind: 'size', value: 40, unit: 'px' },
    ],
    pages: [
      {
        id: newId('pg'),
        name: 'Home',
        slug: 'home',
        order: 0,
        root: {
          id: newId('n'),
          type: 'page',
          name: 'Home',
          props: {},
          styles: emptyStyles(),
          children: [],
        },
      },
    ],
    components: [],
    collection: { name: 'Entries', fields: [], entries: [] },
  };
}

export async function createWorkspace(ownerId: string, name: string): Promise<PlinthDocument> {
  const taken = (await query<{ slug: string }>('select slug from workspaces')).map((r) => r.slug);
  const id = newId('w');
  const slug = uniqueSlug(name, taken);
  const doc = seedDocument(id, name, slug);
  await query('insert into workspaces (id, name, slug, doc, seq) values ($1, $2, $3, $4, 0)', [
    id,
    name,
    slug,
    JSON.stringify(doc),
  ]);
  await query('insert into members (workspace_id, user_id, role) values ($1, $2, $3)', [
    id,
    ownerId,
    'owner',
  ]);
  return doc;
}

export async function accessFor(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess | undefined> {
  const row = await one<{ id: string; name: string; slug: string; role: Role }>(
    `select w.id, w.name, w.slug, m.role from workspaces w
     join members m on m.workspace_id = w.id and m.user_id = $2
     where w.id = $1`,
    [workspaceId, userId],
  );
  if (!row) return undefined;
  return { workspaceId: row.id, name: row.name, slug: row.slug, role: row.role };
}

export async function requireAccess(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const access = await accessFor(userId, workspaceId);
  if (!access) throw notFound();
  return access;
}

export async function loadDocument(workspaceId: string): Promise<PlinthDocument> {
  const row = await one<{ doc: PlinthDocument; seq: string; name: string; slug: string }>(
    'select doc, seq, name, slug from workspaces where id = $1',
    [workspaceId],
  );
  if (!row) throw notFound();
  return { ...row.doc, id: workspaceId, name: row.name, slug: row.slug, seq: Number(row.seq) };
}

export async function workspacesOf(
  userId: string,
): Promise<{ id: string; name: string; slug: string; role: Role }[]> {
  return query<{ id: string; name: string; slug: string; role: Role }>(
    `select w.id, w.name, w.slug, m.role from workspaces w
     join members m on m.workspace_id = w.id
     where m.user_id = $1 order by w.created_at asc`,
    [userId],
  );
}

export async function imageIndex(workspaceId: string): Promise<ImageIndex> {
  const rows = await query<{ id: string; status: string }>(
    'select id, status from images where workspace_id = $1',
    [workspaceId],
  );
  return {
    known: new Set(rows.map((r) => r.id)),
    confirmed: new Set(rows.filter((r) => r.status === 'confirmed').map((r) => r.id)),
  };
}

/** The workspace that holds a page, used by the page-scoped routes. */
export async function workspaceOfPage(pageId: string): Promise<string | undefined> {
  const row = await one<{ id: string }>(
    `select w.id from workspaces w, jsonb_array_elements(w.doc -> 'pages') page
     where page ->> 'id' = $1`,
    [pageId],
  );
  return row?.id;
}

export async function workspaceBySlug(
  slug: string,
): Promise<{ id: string; name: string } | undefined> {
  return one<{ id: string; name: string }>('select id, name from workspaces where slug = $1', [
    slug,
  ]);
}
