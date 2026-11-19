// Postgres is the system of record: users, sessions, layouts, versions, links, change log.
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { LayoutData, Role } from '../domain/layout.js';

export interface LayoutRecord {
  id: string;
  name: string;
  owner: string;
  revision: number;
  data: LayoutData;
}

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists users (
      username text primary key,
      password_hash text not null
    );
    create table if not exists sessions (
      token text primary key,
      username text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists layouts (
      id text primary key,
      name text not null,
      owner text not null,
      revision integer not null,
      data jsonb not null,
      created_at timestamptz not null default now()
    );
    create table if not exists library (
      username text not null,
      layout_id text not null,
      entered_at timestamptz not null default now(),
      primary key (username, layout_id)
    );
    create table if not exists change_log (
      layout_id text not null,
      revision integer not null,
      username text not null,
      change jsonb not null,
      primary key (layout_id, revision)
    );
    create table if not exists undo_log (
      layout_id text not null,
      username text not null,
      seq serial primary key,
      change jsonb not null,
      before jsonb not null,
      undone boolean not null default false
    );
    create table if not exists versions (
      layout_id text not null,
      number integer not null,
      name text not null,
      revision integer not null,
      data jsonb not null,
      primary key (layout_id, number)
    );
    create table if not exists collaborators (
      layout_id text not null,
      username text not null,
      primary key (layout_id, username)
    );
    create table if not exists view_links (
      layout_id text primary key,
      token text not null,
      active boolean not null default true
    );
    create table if not exists join_links (
      layout_id text primary key,
      token text not null
    );
  `);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function createUser(pool: Pool, username: string, passwordHash: string): Promise<void> {
  await pool.query('insert into users (username, password_hash) values ($1, $2)', [username, passwordHash]);
}

export async function findUser(pool: Pool, username: string): Promise<string | null> {
  const res = await pool.query('select password_hash from users where username = $1', [username]);
  const row = res.rows[0];
  return row ? (row.password_hash as string) : null;
}

export async function createSession(pool: Pool, username: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('insert into sessions (token, username) values ($1, $2)', [token, username]);
  return token;
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
  await pool.query('delete from sessions where token = $1', [token]);
}

export async function userOfSession(pool: Pool, token: string): Promise<string | null> {
  const res = await pool.query('select username from sessions where token = $1', [token]);
  const row = res.rows[0];
  return row ? (row.username as string) : null;
}

export async function insertLayout(pool: Pool, record: LayoutRecord): Promise<void> {
  const { id, name, owner, revision, data } = record;
  await pool.query(
    'insert into layouts (id, name, owner, revision, data) values ($1, $2, $3, $4, $5)',
    [id, name, owner, revision, JSON.stringify(data)]
  );
  await pool.query('insert into library (username, layout_id) values ($1, $2)', [owner, id]);
}

export async function loadLayout(pool: Pool, id: string): Promise<LayoutRecord | null> {
  const res = await pool.query('select id, name, owner, revision, data from layouts where id = $1', [id]);
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, owner: row.owner, revision: row.revision, data: row.data as LayoutData };
}

export async function saveLayoutData(pool: Pool, id: string, name: string, revision: number, data: LayoutData): Promise<void> {
  await pool.query('update layouts set name = $2, revision = $3, data = $4 where id = $1', [id, name, revision, JSON.stringify(data)]);
}

export async function roleFor(pool: Pool, layoutId: string, username: string): Promise<Role | null> {
  const layout = await loadLayout(pool, layoutId);
  if (!layout) return null;
  if (layout.owner === username) return 'owner';
  const collab = await pool.query('select 1 from collaborators where layout_id = $1 and username = $2', [layoutId, username]);
  if (collab.rows.length > 0) return 'collaborator';
  return null;
}

export async function libraryOf(pool: Pool, username: string): Promise<Array<{ id: string; name: string; role: Role; columns: string[] }>> {
  const res = await pool.query(`
    select l.id, l.name, l.data,
      case when l.owner = $1 then 'owner' else 'collaborator' end as role
    from library li join layouts l on l.id = li.layout_id
    where li.username = $1
    order by li.entered_at desc, l.created_at desc
  `, [username]);
  return res.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    role: row.role as Role,
    columns: ((row.data as LayoutData).columns) as string[],
  }));
}

export async function addToLibrary(pool: Pool, username: string, layoutId: string): Promise<void> {
  await pool.query(`
    insert into library (username, layout_id) values ($1, $2)
    on conflict (username, layout_id) do nothing
  `, [username, layoutId]);
}

export async function removeFromLibrary(pool: Pool, username: string, layoutId: string): Promise<void> {
  await pool.query('delete from library where username = $1 and layout_id = $2', [username, layoutId]);
}

export async function appendChange(pool: Pool, layoutId: string, revision: number, username: string, change: Record<string, unknown>): Promise<void> {
  await pool.query('insert into change_log (layout_id, revision, username, change) values ($1, $2, $3, $4)', [layoutId, revision, username, JSON.stringify(change)]);
}

export async function changeRowsSince(pool: Pool, layoutId: string, afterRevision: number): Promise<Array<{ revision: number; username: string; change: Record<string, unknown> }>> {
  const res = await pool.query(
    'select revision, username, change from change_log where layout_id = $1 and revision > $2 order by revision',
    [layoutId, afterRevision]
  );
  return res.rows.map((row) => ({ revision: row.revision as number, username: row.username as string, change: row.change as Record<string, unknown> }));
}

export async function appendUndo(pool: Pool, layoutId: string, username: string, change: Record<string, unknown>, before: LayoutData): Promise<void> {
  await pool.query('insert into undo_log (layout_id, username, change, before) values ($1, $2, $3, $4)', [layoutId, username, JSON.stringify(change), JSON.stringify(before)]);
}

export async function markUndone(pool: Pool, layoutId: string, username: string, seq: number, undone: boolean): Promise<void> {
  await pool.query('update undo_log set undone = $4 where layout_id = $1 and username = $2 and seq = $3', [layoutId, username, seq, undone]);
}

export interface UndoEntry { seq: number; change: Record<string, unknown>; before: LayoutData; undone: boolean }

export async function lastUndoEntries(pool: Pool, layoutId: string, username: string): Promise<UndoEntry[]> {
  const res = await pool.query(
    'select seq, change, before, undone from undo_log where layout_id = $1 and username = $2 order by seq',
    [layoutId, username]
  );
  return res.rows.map((row) => ({
    seq: row.seq as number,
    change: row.change as Record<string, unknown>,
    before: row.before as LayoutData,
    undone: row.undone as boolean,
  }));
}

export async function clearRedo(pool: Pool, layoutId: string, username: string): Promise<void> {
  await pool.query('delete from undo_log where layout_id = $1 and username = $2 and undone', [layoutId, username]);
}

export async function saveVersion(pool: Pool, layoutId: string, number: number, name: string, revision: number, data: LayoutData): Promise<void> {
  await pool.query('insert into versions (layout_id, number, name, revision, data) values ($1, $2, $3, $4, $5)', [layoutId, number, name, revision, JSON.stringify(data)]);
}

export async function versionCount(pool: Pool, layoutId: string): Promise<number> {
  const res = await pool.query('select count(*)::int as n from versions where layout_id = $1', [layoutId]);
  return res.rows[0]?.n ?? 0;
}

export async function versionList(pool: Pool, layoutId: string): Promise<Array<{ number: number; name: string }>> {
  const res = await pool.query('select number, name from versions where layout_id = $1 order by number', [layoutId]);
  return res.rows.map((row) => ({ number: row.number as number, name: row.name as string }));
}

export async function versionData(pool: Pool, layoutId: string, number: number): Promise<{ number: number; name: string; revision: number; data: LayoutData } | null> {
  const res = await pool.query('select number, name, revision, data from versions where layout_id = $1 and number = $2', [layoutId, number]);
  const row = res.rows[0];
  if (!row) return null;
  return { number: row.number, name: row.name, revision: row.revision, data: row.data as LayoutData };
}

export async function addCollaborator(pool: Pool, layoutId: string, username: string): Promise<void> {
  await pool.query('insert into collaborators (layout_id, username) values ($1, $2) on conflict do nothing', [layoutId, username]);
  await addToLibrary(pool, username, layoutId);
}

export async function removeCollaborator(pool: Pool, layoutId: string, username: string): Promise<void> {
  await pool.query('delete from collaborators where layout_id = $1 and username = $2', [layoutId, username]);
  await removeFromLibrary(pool, username, layoutId);
}

export async function collaboratorsOf(pool: Pool, layoutId: string): Promise<string[]> {
  const res = await pool.query('select username from collaborators where layout_id = $1 order by username', [layoutId]);
  return res.rows.map((row) => row.username as string);
}

export async function setViewLink(pool: Pool, layoutId: string, token: string): Promise<void> {
  await pool.query(`
    insert into view_links (layout_id, token, active) values ($1, $2, true)
    on conflict (layout_id) do update set token = $2, active = true
  `, [layoutId, token]);
}

export async function revokeViewLink(pool: Pool, layoutId: string): Promise<void> {
  await pool.query('update view_links set active = false where layout_id = $1', [layoutId]);
}

export async function viewLinkOf(pool: Pool, layoutId: string): Promise<string | null> {
  const res = await pool.query('select token from view_links where layout_id = $1 and active', [layoutId]);
  const row = res.rows[0];
  return row ? (row.token as string) : null;
}

export async function layoutOfViewToken(pool: Pool, token: string): Promise<string | null> {
  const res = await pool.query('select layout_id from view_links where token = $1 and active', [token]);
  const row = res.rows[0];
  return row ? (row.layout_id as string) : null;
}

export async function setJoinLink(pool: Pool, layoutId: string, token: string): Promise<void> {
  await pool.query(`
    insert into join_links (layout_id, token) values ($1, $2)
    on conflict (layout_id) do update set token = $2
  `, [layoutId, token]);
}

export async function joinLinkOf(pool: Pool, layoutId: string): Promise<string | null> {
  const res = await pool.query('select token from join_links where layout_id = $1', [layoutId]);
  const row = res.rows[0];
  return row ? (row.token as string) : null;
}

export async function layoutOfJoinToken(pool: Pool, token: string): Promise<string | null> {
  const res = await pool.query('select layout_id from join_links where token = $1', [token]);
  const row = res.rows[0];
  return row ? (row.layout_id as string) : null;
}
