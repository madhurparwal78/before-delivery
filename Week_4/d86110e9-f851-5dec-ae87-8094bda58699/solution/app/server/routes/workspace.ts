import { inviteMember } from '../accounts.js';
import { iso, workspaceNow } from '../clock.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { checkName } from '../draft.js';
import { refuse } from '../errors.js';
import { publish } from '../events.js';
import type { Ctx, Route } from '../http.js';
import { newId } from '../ids.js';
import { isObject, type Json, type JsonObject } from '../json.js';
import { msg } from '../messages.js';
import { startRun } from '../engine.js';
import { findAutomation } from '../automations.js';
import { findTable, insertRow, listRows, NumberColumnError, type Column } from '../tables.js';

async function requireTable(ctx: Ctx): Promise<void> {
  if ((await findTable(db, ctx.workspaceId, ctx.params.tid ?? '')) === null) throw refuse.notFound();
}

async function tableView(ctx: Ctx, tableId: string): Promise<JsonObject> {
  const table = (await findTable(db, ctx.workspaceId, tableId)) as NonNullable<Awaited<ReturnType<typeof findTable>>>;
  const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM table_rows WHERE table_id = $1', [tableId]);
  return { id: table.id, name: table.name, columns: table.columns as unknown as Json[], row_count: rows[0]?.count ?? 0 };
}

function checkColumns(input: JsonObject): Column[] {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name === '') throw refuse.invalid(msg.tableNameRequired);
  checkName(name);
  const given = Array.isArray(input.columns) ? input.columns : [];
  if (given.length === 0) throw refuse.invalid(msg.addColumn);
  const columns = given.map((entry) => (isObject(entry) ? entry : {}));
  if (columns.some((column) => typeof column.name !== 'string' || column.name.trim() === '')) throw refuse.invalid(msg.columnNamesRequired);
  const names = columns.map((column) => String(column.name).trim());
  if (new Set(names).size !== names.length) throw refuse.invalid(msg.columnNamesUnique);
  if (columns.some((column) => column.type !== 'text' && column.type !== 'number')) throw refuse.invalid(msg.columnType);
  return columns.map((column, index) => ({ name: names[index] as string, type: column.type as Column['type'] }));
}

export const workspaceRoutes: Route[] = [
  {
    method: 'GET', path: '/api/workspaces/:ws',
    async handle(ctx) {
      const { rows } = await db.query<{ id: string; name: string; slug: string }>('SELECT id, name, slug FROM workspaces WHERE id = $1', [ctx.workspaceId]);
      return { status: 200, body: { ...rows[0], role: ctx.role, time_zone: config.timeZone, now: iso(await workspaceNow(ctx.workspaceId)) } };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/members',
    async handle(ctx) {
      const members = await db.query(
        'SELECT u.id AS user_id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.seq',
        [ctx.workspaceId],
      );
      const invites = await db.query('SELECT id, email, role FROM invites WHERE workspace_id = $1 ORDER BY seq', [ctx.workspaceId]);
      return { status: 200, body: { members: members.rows, invites: invites.rows } };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/invites', access: 'owner', body: 'json',
    async handle(ctx) {
      return { status: 201, body: await inviteMember(ctx.workspaceId, ctx.user, ctx.body) };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/tables',
    async handle(ctx) {
      const { rows } = await db.query<{ id: string }>('SELECT id FROM data_tables WHERE workspace_id = $1 ORDER BY seq', [ctx.workspaceId]);
      return { status: 200, body: { tables: await Promise.all(rows.map((row) => tableView(ctx, row.id))) } };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/tables', access: 'write', body: 'json',
    async handle(ctx) {
      const columns = checkColumns(ctx.body);
      const id = newId('tb');
      await db.query('INSERT INTO data_tables (id, workspace_id, name, columns) VALUES ($1, $2, $3, $4)', [id, ctx.workspaceId, String(ctx.body.name).trim(), JSON.stringify(columns)]);
      publish(ctx.workspaceId, { type: 'table', table_id: id });
      return { status: 201, body: await tableView(ctx, id) };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/tables/:tid', check: requireTable,
    async handle(ctx) {
      const view = await tableView(ctx, ctx.params.tid ?? '');
      return { status: 200, body: { id: view.id, name: view.name, columns: view.columns, rows: await listRows(db, ctx.params.tid ?? '') } };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/tables/:tid/rows', check: requireTable, access: 'write', body: 'json',
    async handle(ctx) {
      const table = (await findTable(db, ctx.workspaceId, ctx.params.tid ?? '')) as NonNullable<Awaited<ReturnType<typeof findTable>>>;
      const values = isObject(ctx.body.values) ? ctx.body.values : {};
      let row: JsonObject;
      try {
        row = await insertRow(db, table, values);
      } catch (error) {
        if (error instanceof NumberColumnError) throw refuse.invalid(msg.mustBeNumber(error.column));
        throw error;
      }
      publish(ctx.workspaceId, { type: 'table', table_id: table.id });
      await startRowAddedRuns(ctx.workspaceId, table.id, row);
      return { status: 201, body: row };
    },
  },
];

/** A person adding a row fires every live automation that triggers on that table. */
async function startRowAddedRuns(workspaceId: string, tableId: string, row: JsonObject): Promise<void> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM automations WHERE workspace_id = $1 AND live_table = $2 AND live_version IS NOT NULL', [workspaceId, tableId]);
  const at = await workspaceNow(workspaceId);
  for (const found of rows) {
    const automation = await findAutomation(db, workspaceId, found.id);
    if (automation !== null) await startRun({ workspaceId, automation, test: false, triggerOutput: row, at });
  }
}

