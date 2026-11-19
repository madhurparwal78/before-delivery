import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { newToken, type User } from './auth.js';
import { generateCss, generateHtml } from '../shared/codegen.js';
import { normalise } from '../shared/grid.js';
import type { LayoutContent, LayoutObject, LayoutState, LibraryEntry, Role } from '../shared/types.js';
import { pool } from './db.js';
import { valkeyLive } from './valkey.js';

export interface LayoutRow {
  id: string;
  name: string;
  ownerId: number;
  revision: number;
  state: LayoutState;
  viewToken: string | null;
  joinToken: string;
}

export interface Access {
  layout: LayoutRow;
  role: LibraryEntry['role'];
}

type Queryable = pg.Pool | pg.PoolClient;

export async function accessFor(user: User, layoutId: string): Promise<Access | null> {
  const { rows } = await pool.query<LayoutRow & { role: Access['role'] }>(
    'SELECT l.id, l.name, l.owner_id AS "ownerId", l.revision, l.state, l.view_token AS "viewToken", l.join_token AS "joinToken", m.role FROM layouts l JOIN memberships m ON m.layout_id = l.id AND m.user_id = $2 WHERE l.id = $1',
    [layoutId, user.id],
  );
  if (!rows[0]) return null;
  const { role, ...layout } = rows[0];
  return { layout, role };
}

export async function layoutByViewToken(token: string): Promise<LayoutRow | null> {
  const { rows } = await pool.query<LayoutRow>(
    'SELECT l.id, l.name, l.owner_id AS "ownerId", l.revision, l.state, l.view_token AS "viewToken", l.join_token AS "joinToken" FROM layouts l WHERE l.view_token = $1',
    [token],
  );
  return rows[0] ?? null;
}

export async function layoutByJoinToken(token: string): Promise<LayoutRow | null> {
  const { rows } = await pool.query<LayoutRow>(
    'SELECT l.id, l.name, l.owner_id AS "ownerId", l.revision, l.state, l.view_token AS "viewToken", l.join_token AS "joinToken" FROM layouts l WHERE l.join_token = $1',
    [token],
  );
  return rows[0] ?? null;
}

/** A layout's state at one revision together with the code generated from it. */
export function contentOf(revision: number, state: LayoutState): LayoutContent {
  const normal = normalise(state);
  return { revision, ...normal, css: generateCss(normal), html: generateHtml(normal) };
}

export async function objectWith(layout: Pick<LayoutRow, 'id' | 'name'>, role: Role, content: LayoutContent): Promise<LayoutObject> {
  return { id: layout.id, name: layout.name, role, live: await valkeyLive(), ...content };
}

export const objectOf = (layout: LayoutRow, role: Role): Promise<LayoutObject> => objectWith(layout, role, contentOf(layout.revision, layout.state));

export async function libraryOf(user: User): Promise<LibraryEntry[]> {
  const { rows } = await pool.query<{ id: string; name: string; role: LibraryEntry['role']; state: LayoutState }>(
    'SELECT l.id, l.name, m.role, l.state FROM memberships m JOIN layouts l ON l.id = m.layout_id WHERE m.user_id = $1 ORDER BY m.id DESC',
    [user.id],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role, columns: row.state.columns }));
}

/** A new layout at revision 1 with its owner's membership and a co-edit link; no versions, no view link. */
export async function insertLayout(client: Queryable, ownerId: number, name: string, state: LayoutState): Promise<LayoutRow> {
  const id = randomBytes(12).toString('base64url');
  const joinToken = newToken();
  const stored = normalise(state);
  await client.query('INSERT INTO layouts (id, owner_id, name, revision, state, join_token) VALUES ($1, $2, $3, 1, $4, $5)', [id, ownerId, name, stored, joinToken]);
  await client.query("INSERT INTO memberships (layout_id, user_id, role) VALUES ($1, $2, 'owner')", [id, ownerId]);
  return { id, name, ownerId, revision: 1, state: stored, viewToken: null, joinToken };
}

export async function insertVersion(client: Queryable, layoutId: string, name: string, revision: number, state: LayoutState): Promise<number> {
  const { rows } = await client.query<{ number: number }>(
    'INSERT INTO versions (layout_id, number, name, revision, state) SELECT $1, COALESCE(MAX(number), 0) + 1, $2, $3, $4 FROM versions WHERE layout_id = $1 RETURNING number',
    [layoutId, name, revision, normalise(state)],
  );
  return rows[0].number;
}

export async function addCollaborator(client: Queryable, layoutId: string, userId: number): Promise<void> {
  await client.query("INSERT INTO memberships (layout_id, user_id, role) VALUES ($1, $2, 'collaborator') ON CONFLICT DO NOTHING", [layoutId, userId]);
}

export async function collaboratorsOf(layoutId: string): Promise<string[]> {
  const { rows } = await pool.query<{ username: string }>(
    "SELECT u.username FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.layout_id = $1 AND m.role = 'collaborator'",
    [layoutId],
  );
  return rows.map((row) => row.username).sort();
}
