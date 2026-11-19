import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PoolClient } from 'pg';
import { one, query, transaction } from './db.js';
import type { LayoutState, Role } from '../shared/types.js';

const scryptAsync = promisify(scrypt);

export interface DesignerRecord {
  id: string;
  username: string;
}

export interface LayoutRecord {
  id: string;
  name: string;
  owner_id: string;
  revision: number;
  state: LayoutState;
}

export interface VersionRecord {
  number: number;
  name: string;
  revision: number;
  state: LayoutState;
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const derived = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createDesigner(username: string, password: string): Promise<DesignerRecord | null> {
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await query('insert into designers (id, username, password_hash) values ($1, $2, $3)', [
      id,
      username,
      passwordHash,
    ]);
  } catch {
    return null;
  }
  return { id, username };
}

export async function designerByUsername(username: string): Promise<DesignerRecord | null> {
  return one<DesignerRecord>('select id, username from designers where username = $1', [username]);
}

export async function checkCredentials(username: string, password: string): Promise<DesignerRecord | null> {
  const row = await one<{ id: string; username: string; password_hash: string }>(
    'select id, username, password_hash from designers where username = $1',
    [username],
  );
  if (!row) return null;
  return (await passwordMatches(password, row.password_hash)) ? { id: row.id, username: row.username } : null;
}

export async function startSession(designerId: string): Promise<string> {
  const token = newToken();
  await query('insert into sessions (token, designer_id) values ($1, $2)', [token, designerId]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

export async function designerBySession(token: string): Promise<DesignerRecord | null> {
  return one<DesignerRecord>(
    'select designers.id, designers.username from sessions join designers on designers.id = sessions.designer_id where sessions.token = $1',
    [token],
  );
}

export interface LibraryEntry {
  id: string;
  name: string;
  role: Role;
  state: LayoutState;
}

export async function listLibrary(designerId: string): Promise<LibraryEntry[]> {
  return query<LibraryEntry>(
    `select id, name, role, state from (
       select l.id, l.name, 'owner'::text as role, l.state, l.entered_seq
         from layouts l where l.owner_id = $1
       union all
       select l.id, l.name, 'collaborator'::text as role, l.state, c.entered_seq
         from layouts l join collaborators c on c.layout_id = l.id where c.designer_id = $1
     ) entries order by entered_seq desc`,
    [designerId],
  );
}

export async function createLayout(
  ownerId: string,
  name: string,
  state: LayoutState,
): Promise<LayoutRecord> {
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query('insert into layouts (id, owner_id, name, revision, state) values ($1, $2, $3, 1, $4)', [
      id,
      ownerId,
      name,
      JSON.stringify(state),
    ]);
    await client.query('insert into links (token, layout_id, kind, active) values ($1, $2, $3, true)', [
      newToken(),
      id,
      'join',
    ]);
  });
  return { id, name, owner_id: ownerId, revision: 1, state };
}

export async function layoutById(id: string): Promise<LayoutRecord | null> {
  if (!isUuid(id)) return null;
  return one<LayoutRecord>('select id, name, owner_id, revision, state from layouts where id = $1', [id]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export async function roleFor(layout: LayoutRecord, designerId: string): Promise<Role | null> {
  if (layout.owner_id === designerId) return 'owner';
  const row = await one<{ layout_id: string }>(
    'select layout_id from collaborators where layout_id = $1 and designer_id = $2',
    [layout.id, designerId],
  );
  return row ? 'collaborator' : null;
}

export async function listVersions(layoutId: string): Promise<VersionRecord[]> {
  return query<VersionRecord>(
    'select number, name, revision, state from versions where layout_id = $1 order by number asc',
    [layoutId],
  );
}

export async function versionByNumber(layoutId: string, number: number): Promise<VersionRecord | null> {
  return one<VersionRecord>(
    'select number, name, revision, state from versions where layout_id = $1 and number = $2',
    [layoutId, number],
  );
}

export async function saveVersion(
  layoutId: string,
  name: string,
): Promise<{ number: number; name: string }> {
  return transaction(async (client) => {
    const layout = await lockLayout(client, layoutId);
    const number = await nextVersionNumber(client, layoutId);
    await insertVersion(client, layoutId, number, name, layout.revision, layout.state);
    return { number, name };
  });
}

export async function lockLayout(client: PoolClient, layoutId: string): Promise<LayoutRecord> {
  const result = await client.query(
    'select id, name, owner_id, revision, state from layouts where id = $1 for update',
    [layoutId],
  );
  return result.rows[0] as LayoutRecord;
}

export async function nextVersionNumber(client: PoolClient, layoutId: string): Promise<number> {
  const result = await client.query(
    'select coalesce(max(number), 0) + 1 as number from versions where layout_id = $1',
    [layoutId],
  );
  return Number((result.rows[0] as { number: string }).number);
}

export async function insertVersion(
  client: PoolClient,
  layoutId: string,
  number: number,
  name: string,
  revision: number,
  state: LayoutState,
): Promise<void> {
  await client.query(
    'insert into versions (layout_id, number, name, revision, state) values ($1, $2, $3, $4, $5)',
    [layoutId, number, name, revision, JSON.stringify(state)],
  );
}

export interface ShareInfo {
  view_path: string | null;
  join_path: string;
  collaborators: string[];
}

export async function shareInfo(layoutId: string): Promise<ShareInfo> {
  const rows = await query<{ token: string; kind: string }>(
    'select token, kind from links where layout_id = $1 and active',
    [layoutId],
  );
  const view = rows.find((row) => row.kind === 'view');
  const join = rows.find((row) => row.kind === 'join');
  const collaborators = await query<{ username: string }>(
    'select d.username from collaborators c join designers d on d.id = c.designer_id where c.layout_id = $1 order by d.username asc',
    [layoutId],
  );
  return {
    view_path: view ? `/view/${view.token}` : null,
    join_path: join ? `/join/${join.token}` : '',
    collaborators: collaborators.map((row) => row.username),
  };
}

export async function replaceLink(layoutId: string, kind: 'view' | 'join'): Promise<string> {
  const token = newToken();
  await transaction(async (client) => {
    await client.query('update links set active = false where layout_id = $1 and kind = $2 and active', [
      layoutId,
      kind,
    ]);
    await client.query('insert into links (token, layout_id, kind, active) values ($1, $2, $3, true)', [
      token,
      layoutId,
      kind,
    ]);
  });
  return token;
}

export async function revokeViewLink(layoutId: string): Promise<boolean> {
  const rows = await query<{ token: string }>(
    "update links set active = false where layout_id = $1 and kind = 'view' and active returning token",
    [layoutId],
  );
  return rows.length > 0;
}

export async function layoutByLink(token: string, kind: 'view' | 'join'): Promise<LayoutRecord | null> {
  return one<LayoutRecord>(
    `select l.id, l.name, l.owner_id, l.revision, l.state
       from links join layouts l on l.id = links.layout_id
      where links.token = $1 and links.kind = $2 and links.active`,
    [token, kind],
  );
}

export async function addCollaborator(layoutId: string, designerId: string): Promise<void> {
  await query(
    'insert into collaborators (layout_id, designer_id) values ($1, $2) on conflict (layout_id, designer_id) do nothing',
    [layoutId, designerId],
  );
}

export async function removeCollaborator(layoutId: string, username: string): Promise<boolean> {
  const rows = await query<{ designer_id: string }>(
    `delete from collaborators
       where layout_id = $1
         and designer_id = (select id from designers where username = $2)
     returning designer_id`,
    [layoutId, username],
  );
  return rows.length > 0;
}
