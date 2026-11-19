import { config } from '../config';
import { one, query } from '../db';
import { ApiError, badRequest, messages, notFound } from '../errors';
import { MailUnavailable, mailTexts, sendMail } from '../mail';
import { coerceValues, insertRow, listTables, loadTable, rowObjects, valuesFromJson } from '../tables';
import { fireRowAdded } from '../triggers';
import { workspaceNow } from '../time';
import { emailLooksValid, isObject, newId, token } from '../util';
import { checkName, type Ctx, type Reply, type Route } from '../http';
import type { JsonObject, Role } from '../../shared/types';
import type { TableColumn } from '../tables';

async function workspaceInfo(ctx: Ctx): Promise<Reply> {
  return {
    status: 200,
    json: {
      id: ctx.workspace.id,
      name: ctx.workspace.name,
      slug: ctx.workspace.slug,
      role: ctx.role,
      time_zone: config.timeZone,
      now: (await workspaceNow(ctx.workspace.id)).toISOString(),
    },
  };
}

async function members(ctx: Ctx): Promise<Reply> {
  const rows = await query<{ user_id: string; name: string; email: string; role: Role }>(
    `select m.user_id, u.name, u.email, m.role from members m join users u on u.id = m.user_id
       where m.workspace_id = $1 order by m.joined_at, u.name`,
    [ctx.workspace.id],
  );
  const invites = await query<{ id: string; email: string; role: Role }>(
    'select id, email, role from invites where workspace_id = $1 and used = false order by created_at',
    [ctx.workspace.id],
  );
  return { status: 200, json: { members: rows, invites } };
}

async function sendInvite(ctx: Ctx): Promise<Reply> {
  const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim() : '';
  const role = ctx.body.role;
  const member = await one(
    `select m.user_id from members m join users u on u.id = m.user_id
       where m.workspace_id = $1 and lower(u.email) = lower($2)`,
    [ctx.workspace.id, email],
  );
  if (member !== null) throw new ApiError(409, messages.alreadyMember);
  if (!emailLooksValid(email)) throw badRequest(messages.enterEmail, { field: 'email' });
  if (role !== 'editor' && role !== 'viewer') throw badRequest(messages.badRole, { field: 'role' });
  const inviteToken = token();
  try {
    await sendMail({
      to: email,
      subject: mailTexts.inviteSubject(ctx.user.name, ctx.workspace.name),
      text: mailTexts.inviteBody(ctx.user.name, ctx.workspace.name, inviteToken),
    });
  } catch (error) {
    if (error instanceof MailUnavailable) throw new ApiError(503, messages.mailUnavailable);
    throw error;
  }
  await query('delete from invites where workspace_id = $1 and lower(email) = lower($2) and used = false', [
    ctx.workspace.id,
    email,
  ]);
  const inviteId = `inv-${inviteToken.slice(0, 8)}`;
  await query(
    'insert into invites (id, workspace_id, email, role, token, inviter_name) values ($1, $2, $3, $4, $5, $6)',
    [inviteId, ctx.workspace.id, email, role, inviteToken, ctx.user.name],
  );
  return { status: 201, json: { invite_id: inviteId, email, role } };
}

async function tablesList(ctx: Ctx): Promise<Reply> {
  const tables = await listTables(ctx.workspace.id);
  return {
    status: 200,
    json: {
      tables: tables.map((table) => ({
        id: table.id,
        name: table.name,
        columns: table.cols,
        row_count: table.row_count,
      })),
    },
  };
}

function readColumns(value: unknown): TableColumn[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest(messages.atLeastOneColumn);
  const columns: TableColumn[] = [];
  for (const raw of value) {
    if (!isObject(raw) || typeof raw.name !== 'string' || raw.name.trim() === '') {
      throw badRequest(messages.atLeastOneColumn);
    }
    checkName(raw.name);
    if (raw.type !== 'text' && raw.type !== 'number') throw badRequest(messages.columnType);
    columns.push({ name: raw.name, type: raw.type });
  }
  const names = new Set(columns.map((column) => column.name));
  if (names.size !== columns.length) throw badRequest(messages.uniqueColumns);
  return columns;
}

async function createTable(ctx: Ctx): Promise<Reply> {
  const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
  checkName(name);
  if (name === '') throw badRequest(messages.tableNameRequired);
  const columns = readColumns(ctx.body.columns);
  const id = typeof ctx.body.id === 'string' ? ctx.body.id : newId('tb');
  await query('insert into data_tables (id, workspace_id, name, cols) values ($1, $2, $3, $4)', [
    id,
    ctx.workspace.id,
    name,
    JSON.stringify(columns),
  ]);
  return { status: 201, json: { id, name, columns, row_count: 0 } };
}

async function tableDetail(ctx: Ctx): Promise<Reply> {
  const table = await loadTable(ctx.workspace.id, ctx.params.tid);
  if (table === null) throw notFound();
  return {
    status: 200,
    json: { id: table.id, name: table.name, columns: table.cols, rows: await rowObjects(table.id) },
  };
}

async function addTableRow(ctx: Ctx): Promise<Reply> {
  const table = await loadTable(ctx.workspace.id, ctx.params.tid);
  if (table === null) throw notFound();
  const values: JsonObject = valuesFromJson(ctx.body.values);
  const coerced = coerceValues(table.cols, values, null);
  if (!coerced.ok) throw badRequest(messages.numberColumn(coerced.column));
  const row = await insertRow(table, coerced.cells);
  await fireRowAdded(ctx.workspace.id, table.id, row);
  return { status: 201, json: row };
}

export const workspaceRoutes: Route[] = [
  { method: 'GET', path: '/api/workspaces/:ws', auth: 'session', workspace: 'ws', handler: workspaceInfo },
  { method: 'GET', path: '/api/workspaces/:ws/members', auth: 'session', workspace: 'ws', handler: members },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/invites',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'owner',
    body: 'json',
    handler: sendInvite,
  },
  { method: 'GET', path: '/api/workspaces/:ws/tables', auth: 'session', workspace: 'ws', handler: tablesList },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/tables',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: createTable,
  },
  { method: 'GET', path: '/api/workspaces/:ws/tables/:tid', auth: 'session', workspace: 'ws', handler: tableDetail },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/tables/:tid/rows',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: addTableRow,
  },
];
