// Typed reads and writes over the store. Every row the server answers with is built here.

import type { Pool } from './db.ts';
import { newId } from './db.ts';
import type { IsoDate } from '../domain/calendar.ts';

export type Role = 'owner' | 'editor' | 'viewer';

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  capacity: number;
}

export interface ItemRow {
  id: string;
  projectId: string;
  row: number;
  name: string;
  kind: 'task' | 'milestone' | 'group';
  groupId: string | null;
  chosenStart: IsoDate | null;
  duration: number;
  percent: number;
  version: number;
  versionBy: string;
}

export interface LinkRow {
  id: string;
  projectId: string;
  fromId: string;
  toId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lag: number;
}

export interface HolidayRow {
  projectId: string;
  date: IsoDate;
  name: string;
}

export interface AssignmentRow {
  itemId: string;
  userId: string;
  hours: number;
}

export interface CommentRow {
  id: string;
  itemId: string;
  authorId: string;
  text: string;
  createdAt: Date;
}

export interface BaselineRow {
  projectId: string;
  name: string;
  finish: IsoDate;
}

export interface BaselineItemRow {
  projectId: string;
  itemId: string;
  start: IsoDate;
  end: IsoDate;
}

export interface ExportRow {
  id: string;
  projectId: string;
  format: 'csv' | 'pdf';
  filename: string;
  storedAt: Date | null;
  createdAt: Date;
}

export interface ProjectRow {
  id: string;
  workspaceId: string;
  name: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
}

function iso(d: Date | string | null): IsoDate | null {
  if (d === null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export async function personByEmail(pool: Pool, email: string): Promise<PersonRow | null> {
  const result = await pool.query('select id, name, email, password_hash as "passwordHash", capacity::float8 as capacity from people where email = $1', [email]);
  return result.rows[0] ?? null;
}

export async function personById(pool: Pool, id: string): Promise<PersonRow | null> {
  const result = await pool.query('select id, name, email, password_hash as "passwordHash", capacity::float8 as capacity from people where id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function insertPerson(pool: Pool, person: { name: string; email: string; passwordHash: string; capacity?: number }): Promise<PersonRow> {
  const id = newId('u_');
  await pool.query(
    'insert into people (id, name, email, password_hash, capacity) values ($1, $2, $3, $4, $5)',
    [id, person.name, person.email, person.passwordHash, person.capacity ?? 8],
  );
  return { id, name: person.name, email: person.email, passwordHash: person.passwordHash, capacity: person.capacity ?? 8 };
}

export async function updatePerson(pool: Pool, id: string, person: { name: string; passwordHash: string; capacity: number }): Promise<void> {
  await pool.query('update people set name = $2, password_hash = $3, capacity = $4 where id = $1', [id, person.name, person.passwordHash, person.capacity]);
}

export async function workspaceMembers(pool: Pool, workspaceId: string): Promise<{ userId: string; role: Role }[]> {
  const result = await pool.query('select user_id as "userId", role from members where workspace_id = $1 order by user_id', [workspaceId]);
  return result.rows;
}

export async function memberRole(pool: Pool, workspaceId: string, userId: string): Promise<Role | null> {
  const result = await pool.query('select role from members where workspace_id = $1 and user_id = $2', [workspaceId, userId]);
  return result.rows[0]?.role ?? null;
}

export async function insertMember(pool: Pool, workspaceId: string, userId: string, role: Role): Promise<void> {
  await pool.query('insert into members (workspace_id, user_id, role) values ($1, $2, $3) on conflict (workspace_id, user_id) do update set role = excluded.role', [workspaceId, userId, role]);
}

export async function myWorkspaces(pool: Pool, userId: string): Promise<{ id: string; name: string; role: Role }[]> {
  const result = await pool.query(
    `select w.id, w.name, m.role, m.joined_at from workspaces w join members m on m.workspace_id = w.id where m.user_id = $1 order by w.name`,
    [userId],
  );
  return result.rows.map((row: { id: string; name: string; role: Role }) => ({ id: row.id, name: row.name, role: row.role }));
}

export async function insertWorkspace(pool: Pool, name: string): Promise<WorkspaceRow> {
  const id = newId('w_');
  await pool.query('insert into workspaces (id, name) values ($1, $2)', [id, name]);
  return { id, name };
}

export async function insertProject(pool: Pool, workspaceId: string, name: string): Promise<ProjectRow> {
  const id = newId('p_');
  await pool.query('insert into projects (id, workspace_id, name) values ($1, $2, $3)', [id, workspaceId, name]);
  return { id, workspaceId, name };
}

export async function projectById(pool: Pool, id: string): Promise<ProjectRow | null> {
  const result = await pool.query('select id, workspace_id as "workspaceId", name from projects where id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function projectsForUser(pool: Pool, userId: string): Promise<{ id: string; name: string; workspaceId: string; workspaceName: string }[]> {
  const result = await pool.query(
    `select p.id, p.name, p.workspace_id as "workspaceId", w.name as "workspaceName"
     from projects p join workspaces w on w.id = p.workspace_id join members m on m.workspace_id = w.id
     where m.user_id = $1 order by p.name`,
    [userId],
  );
  return result.rows;
}

export async function projectItems(pool: Pool, projectId: string): Promise<ItemRow[]> {
  const result = await pool.query(
    'select id, project_id as "projectId", row, name, kind, group_id as "groupId", chosen_start::text as "chosenStart", duration, percent, version, version_by as "versionBy" from items where project_id = $1 order by row',
    [projectId],
  );
  return result.rows;
}

export async function itemById(pool: Pool, id: string): Promise<ItemRow | null> {
  const result = await pool.query(
    'select id, project_id as "projectId", row, name, kind, group_id as "groupId", chosen_start::text as "chosenStart", duration, percent, version, version_by as "versionBy" from items where id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function projectLinks(pool: Pool, projectId: string): Promise<LinkRow[]> {
  const result = await pool.query('select id, project_id as "projectId", from_id as "fromId", to_id as "toId", type, lag from links where project_id = $1 order by created_at, id', [projectId]);
  return result.rows;
}

export async function linkById(pool: Pool, id: string): Promise<LinkRow | null> {
  const result = await pool.query('select id, project_id as "projectId", from_id as "fromId", to_id as "toId", type, lag from links where id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function projectHolidays(pool: Pool, projectId: string): Promise<HolidayRow[]> {
  const result = await pool.query('select project_id as "projectId", date::text as date, name from holidays where project_id = $1 order by date', [projectId]);
  return result.rows;
}

export async function itemAssignments(pool: Pool, itemIds: string[]): Promise<AssignmentRow[]> {
  if (itemIds.length === 0) return [];
  const result = await pool.query(
    `select a.item_id as "itemId", a.user_id as "userId", a.hours::float8 as hours
     from assignments a join people p on p.id = a.user_id
     where a.item_id = any($1::text[]) order by p.name`,
    [itemIds],
  );
  return result.rows;
}

export async function workspaceAssignments(pool: Pool, workspaceId: string): Promise<(AssignmentRow & { projectName: string; itemName: string; itemRow: number; projectId: string })[]> {
  const result = await pool.query(
    `select a.item_id as "itemId", a.user_id as "userId", a.hours::float8 as hours,
            p.name as "projectName", i.name as "itemName", i.row as "itemRow", p.id as "projectId"
     from assignments a
     join items i on i.id = a.item_id
     join projects p on p.id = i.project_id
     where p.workspace_id = $1 and i.kind = 'task'
     order by p.name, i.row`,
    [workspaceId],
  );
  return result.rows;
}

export async function itemComments(pool: Pool, itemId: string): Promise<(CommentRow & { authorName: string })[]> {
  const result = await pool.query(
    `select c.id, c.item_id as "itemId", c.author_id as "authorId", c.text, c.created_at as "createdAt", p.name as "authorName"
     from comments c join people p on p.id = c.author_id
     where c.item_id = $1 order by c.created_at, c.id`,
    [itemId],
  );
  return result.rows;
}

export async function insertComment(pool: Pool, itemId: string, authorId: string, text: string): Promise<CommentRow> {
  const id = newId('c_');
  const result = await pool.query(
    'insert into comments (id, item_id, author_id, text) values ($1, $2, $3, $4) returning created_at as "createdAt"',
    [id, itemId, authorId, text],
  );
  return { id, itemId, authorId, text, createdAt: result.rows[0].createdAt };
}

export async function baselineOf(pool: Pool, projectId: string): Promise<BaselineRow | null> {
  const result = await pool.query('select project_id as "projectId", name, finish::text as finish from baselines where project_id = $1', [projectId]);
  return result.rows[0] ?? null;
}

export async function baselineItems(pool: Pool, projectId: string): Promise<BaselineItemRow[]> {
  const result = await pool.query('select project_id as "projectId", item_id as "itemId", start::text as start, "end"::text as "end" from baseline_items where project_id = $1', [projectId]);
  return result.rows;
}

export async function saveBaseline(pool: Pool, projectId: string, name: string, finish: IsoDate, items: { itemId: string; start: IsoDate; end: IsoDate }[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from baselines where project_id = $1', [projectId]);
    await client.query('delete from baseline_items where project_id = $1', [projectId]);
    await client.query('insert into baselines (project_id, name, finish) values ($1, $2, $3)', [projectId, name, finish]);
    for (const item of items) {
      await client.query('insert into baseline_items (project_id, item_id, start, "end") values ($1, $2, $3, $4)', [projectId, item.itemId, item.start, item.end]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function workspacePeople(pool: Pool, workspaceId: string, roles: Role[]): Promise<PersonRow[]> {
  const result = await pool.query(
    `select p.id, p.name, p.email, p.password_hash as "passwordHash", p.capacity::float8 as capacity
     from people p join members m on m.user_id = p.id
     where m.workspace_id = $1 and m.role = any($2::text[])
     order by p.name`,
    [workspaceId, roles],
  );
  return result.rows;
}

export async function insertItem(
  pool: Pool,
  item: { projectId: string; row: number; name: string; kind: ItemRow['kind']; groupId: string | null; chosenStart: IsoDate | null; duration: number; percent?: number; versionBy: string },
): Promise<ItemRow> {
  const id = newId('i_');
  const percent = item.percent ?? 0;
  await pool.query(
    'insert into items (id, project_id, row, name, kind, group_id, chosen_start, duration, percent, version, version_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)',
    [id, item.projectId, item.row, item.name, item.kind, item.groupId, item.chosenStart, item.duration, percent, item.versionBy],
  );
  return {
    id,
    projectId: item.projectId,
    row: item.row,
    name: item.name,
    kind: item.kind,
    groupId: item.groupId,
    chosenStart: item.chosenStart,
    duration: item.duration,
    percent,
    version: 1,
    versionBy: item.versionBy,
  };
}

export async function deleteItemRow(pool: Pool, id: string): Promise<void> {
  await pool.query('delete from items where id = $1', [id]);
}

export async function nextRow(pool: Pool, projectId: string): Promise<number> {
  const result = await pool.query('select coalesce(max(row), 0) + 1 as next from items where project_id = $1', [projectId]);
  return result.rows[0].next;
}

export async function shiftRowsAbove(pool: Pool, projectId: string, fromRow: number): Promise<void> {
  await pool.query('update items set row = row - 1 where project_id = $1 and row > $2', [projectId, fromRow]);
}

export async function workspaceOfProject(pool: Pool, projectId: string): Promise<WorkspaceRow | null> {
  const result = await pool.query(
    'select w.id, w.name from workspaces w join projects p on p.workspace_id = w.id where p.id = $1',
    [projectId],
  );
  return result.rows[0] ?? null;
}

export async function insertLink(pool: Pool, link: { projectId: string; fromId: string; toId: string; type: LinkRow['type']; lag: number }): Promise<LinkRow> {
  const id = newId('l_');
  await pool.query('insert into links (id, project_id, from_id, to_id, type, lag) values ($1, $2, $3, $4, $5, $6)', [id, link.projectId, link.fromId, link.toId, link.type, link.lag]);
  return { id, projectId: link.projectId, fromId: link.fromId, toId: link.toId, type: link.type, lag: link.lag };
}

export async function deleteLinkRow(pool: Pool, id: string): Promise<void> {
  await pool.query('delete from links where id = $1', [id]);
}

export async function insertHoliday(pool: Pool, projectId: string, date: IsoDate, name: string): Promise<void> {
  await pool.query('insert into holidays (project_id, date, name) values ($1, $2, $3)', [projectId, date, name]);
}

export async function deleteHoliday(pool: Pool, projectId: string, date: IsoDate): Promise<void> {
  await pool.query('delete from holidays where project_id = $1 and date = $2', [projectId, date]);
}

export async function insertAssignment(pool: Pool, itemId: string, userId: string, hours: number): Promise<void> {
  await pool.query('insert into assignments (item_id, user_id, hours) values ($1, $2, $3)', [itemId, userId, hours]);
}

export async function deleteAssignment(pool: Pool, itemId: string, userId: string): Promise<void> {
  await pool.query('delete from assignments where item_id = $1 and user_id = $2', [itemId, userId]);
}

export async function insertExport(pool: Pool, exportRow: { projectId: string; format: 'csv' | 'pdf'; filename: string }): Promise<ExportRow> {
  const id = newId('e_');
  await pool.query('insert into exports (id, project_id, format, filename) values ($1, $2, $3, $4)', [id, exportRow.projectId, exportRow.format, exportRow.filename]);
  return { id, projectId: exportRow.projectId, format: exportRow.format, filename: exportRow.filename, storedAt: null, createdAt: new Date() };
}

export async function markExportStored(pool: Pool, id: string): Promise<void> {
  await pool.query('update exports set stored_at = now() where id = $1', [id]);
}

export async function storedExports(pool: Pool, projectId: string): Promise<ExportRow[]> {
  const result = await pool.query(
    'select id, project_id as "projectId", format, filename, stored_at as "storedAt", created_at as "createdAt" from exports where project_id = $1 and stored_at is not null order by stored_at desc, id',
    [projectId],
  );
  return result.rows;
}

export async function exportById(pool: Pool, id: string): Promise<ExportRow | null> {
  const result = await queryExport(pool, id);
  return result;
}

async function queryExport(pool: Pool, id: string): Promise<ExportRow | null> {
  const result = await pool.query('select id, project_id as "projectId", format, filename, stored_at as "storedAt", created_at as "createdAt" from exports where id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function insertNotice(
  pool: Pool,
  notice: { assignerId: string; assigneeId: string; itemId: string; projectId: string; hours: number; dueAt: Date },
): Promise<string> {
  const id = newId('n_');
  await pool.query(
    'insert into notices (id, assigner_id, assignee_id, item_id, project_id, hours, due_at) values ($1, $2, $3, $4, $5, $6, $7)',
    [id, notice.assignerId, notice.assigneeId, notice.itemId, notice.projectId, notice.hours, notice.dueAt],
  );
  return id;
}

export async function cancelNoticesForAssignment(pool: Pool, itemId: string, userId: string): Promise<void> {
  await pool.query('delete from notices where item_id = $1 and assignee_id = $2 and sent_at is null', [itemId, userId]);
}

export async function cancelNoticesForItem(pool: Pool, itemId: string): Promise<void> {
  await pool.query('delete from notices where item_id = $1 and sent_at is null', [itemId]);
}

export async function dueNotices(pool: Pool, now: Date): Promise<{ id: string; assignerId: string; assigneeId: string; itemId: string; projectId: string; hours: number }[]> {
  const result = await pool.query(
    `select id, assigner_id as "assignerId", assignee_id as "assigneeId", item_id as "itemId", project_id as "projectId", hours::float8 as hours
     from notices where sent_at is null and due_at <= $1 order by due_at, id`,
    [now],
  );
  return result.rows;
}

export async function markNoticeSent(pool: Pool, id: string): Promise<void> {
  await pool.query('update notices set sent_at = now() where id = $1', [id]);
}

export { iso };
