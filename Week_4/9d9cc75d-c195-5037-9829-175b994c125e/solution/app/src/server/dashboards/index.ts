import { placeObjects } from '../../shared/layout.ts';
import type { Dashboard, DashboardBody, LayoutContainer, Pill, Role } from '../../shared/model.ts';
import { newId } from '../db/ids.ts';
import type { App, AuthUser, Context, Module } from '../http/app.ts';
import { invalid, notFound } from '../http/errors.ts';
import { json } from '../http/reply.ts';
import { isObject } from '../http/validate.ts';
import { requireRole } from '../projects/access.ts';
import { mapAction } from '../sheets/refs.ts';
import { sheetScope, workbookScope } from '../sheets/scope.ts';
import { Malformed, parsed } from '../sheets/shape.ts';
import { workbookSheets } from '../sheets/store.ts';
import type { SheetRow } from '../sheets/store.ts';
import { bumpWorkbook, openWorkbook, requireVersion } from '../workbooks/store.ts';
import type { WorkbookRow } from '../workbooks/store.ts';
import { dashboardBody, namedSheets } from './body.ts';

const dashboardSchema = [
  `CREATE TABLE IF NOT EXISTS dashboards (
     id text PRIMARY KEY,
     workbook_id text NOT NULL REFERENCES workbooks(id),
     name text NOT NULL,
     body jsonb NOT NULL,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS dashboards_workbook ON dashboards (workbook_id)`,
];

const SHEETS_TEXT = 'A dashboard holds 2 to 4 sheets.';
const NESTING_TEXT = 'Containers nest at most one level.';
const highlightText = (field: string): string => `Highlight needs ${field} in every target view.`;

type WorkbookSheet = SheetRow & { name: string };

/** Stored with sheets by id and action fields, parameters and sets by id (see sheets/refs.ts). */
interface DashboardRow {
  id: string;
  workbook_id: string;
  body: DashboardBody;
}

function tiledSheets(c: LayoutContainer): string[] {
  return c.children.flatMap((ch) => ('children' in ch ? tiledSheets(ch) : [ch.sheet]));
}

function dimensionFields(pills: readonly (Pill | null)[]): Set<string> {
  const out = new Set<string>();
  for (const p of pills) {
    if (typeof p === 'string') out.add(p);
    else if (p !== null && !('agg' in p)) out.add(p.field);
  }
  return out;
}

/** 404 when the body names a sheet that is not one of the workbook's own sheets. */
function requireKnownSheets(body: DashboardBody, sheets: ReadonlyMap<string, WorkbookSheet>): void {
  for (const id of namedSheets(body)) if (!sheets.has(id)) throw notFound();
}

/** The 422 field errors of a dashboard: sheet count, nesting, phone order and actions. */
async function ruleErrors(
  app: App,
  workbook: WorkbookRow,
  body: DashboardBody,
  sheets: ReadonlyMap<string, WorkbookSheet>,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const placed = [...tiledSheets(body.layout), ...body.floating.map((f) => f.sheet)];
  const onBoard = new Set(placed);
  if (onBoard.size < 2 || onBoard.size > 4) errors.sheets = SHEETS_TEXT;
  if (body.layout.children.some((ch) => 'children' in ch && ch.children.some((g) => 'children' in g))) {
    errors.layout = NESTING_TEXT;
  } else if (placed.length !== onBoard.size) {
    errors.layout = 'Each sheet appears once on a dashboard.';
  }
  if (body.phone_order.some((id) => !onBoard.has(id)) || Object.keys(body.phone_heights).some((id) => !onBoard.has(id))) {
    errors.phone_order = 'The phone layout lists only sheets of this dashboard.';
  }
  const ws = await workbookScope(app, workbook);
  for (const action of body.actions) {
    let problem: string | null = null;
    if (!onBoard.has(action.source) || action.targets.length === 0 || action.targets.some((t) => !onBoard.has(t))) {
      problem = 'Actions link sheets of this dashboard.';
    } else if (action.type === 'set_parameter' && !ws.parameters.some((p) => p.name === action.parameter)) {
      problem = `${action.name} needs a parameter.`;
    } else if (action.type === 'change_set' && !ws.sets.some((s) => s.name === action.set)) {
      problem = `${action.name} needs a set.`;
    } else if (action.type === 'highlight') {
      for (const sheet of action.targets.flatMap((t) => sheets.get(t) ?? [])) {
        const { shape } = await sheetScope(app, workbook, sheet);
        const fields = dimensionFields([...shape.rows, ...shape.columns, shape.color, shape.size, ...shape.label, ...shape.detail]);
        if (!fields.has(action.field)) problem = highlightText(action.field);
      }
    }
    if (problem !== null) {
      errors.actions = problem;
      break;
    }
  }
  return errors;
}

async function sheetsOf(app: App, workbookId: string): Promise<Map<string, WorkbookSheet>> {
  return new Map((await workbookSheets(app.db, workbookId)).map((s) => [s.id, s]));
}

/**
 * Adds (`id` null) or replaces a dashboard of the workbook. The body names sheets by id. `expected` is the `If-Match`
 * version the route already checked. The routes and the grading seed both write through here.
 */
export async function saveDashboard(
  app: App,
  workbook: WorkbookRow,
  id: string | null,
  body: DashboardBody,
  expected: number | null,
): Promise<string> {
  const sheets = await sheetsOf(app, workbook.id);
  requireKnownSheets(body, sheets);
  const errors = await ruleErrors(app, workbook, body, sheets);
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const { maps } = await workbookScope(app, workbook);
  const stored: DashboardBody = { ...body, actions: body.actions.map((a) => mapAction(a, maps.stored)) };
  const dashboardId = id ?? newId();
  await app.db.transaction(async (tx) => {
    if (id === null) {
      await tx.exec(`INSERT INTO dashboards (id, workbook_id, name, body) VALUES ($1, $2, $3, $4)`, [
        dashboardId,
        workbook.id,
        body.name,
        JSON.stringify(stored),
      ]);
    } else {
      await tx.exec(`UPDATE dashboards SET name = $2, body = $3 WHERE id = $1`, [dashboardId, body.name, JSON.stringify(stored)]);
    }
    await bumpWorkbook(tx, workbook.id, expected);
  });
  return dashboardId;
}

async function dashboardView(app: App, workbook: WorkbookRow, row: DashboardRow): Promise<Dashboard> {
  const [sheets, { maps }] = await Promise.all([sheetsOf(app, workbook.id), workbookScope(app, workbook)]);
  const body = { ...row.body, actions: row.body.actions.map((a) => mapAction(a, maps.display)) };
  return {
    id: row.id,
    workbook: workbook.id,
    ...body,
    objects: placeObjects(body.layout, body.floating).map((o) => ({ ...o, name: sheets.get(o.sheet)?.name ?? o.sheet })),
    version: workbook.version,
  };
}

/** The dashboard and its workbook for `user`: 404 when they cannot open the workbook. Exports read dashboards here. */
export async function openDashboard(
  app: App,
  user: AuthUser,
  dashboardId: string,
): Promise<{ dashboard: Dashboard; workbook: WorkbookRow; role: Role }> {
  const row = await app.db.row<DashboardRow>(`SELECT id, workbook_id, body FROM dashboards WHERE id = $1`, [dashboardId]);
  if (!row) throw notFound();
  const { workbook, role } = await openWorkbook(app, user, row.workbook_id);
  return { dashboard: await dashboardView(app, workbook, row), workbook, role };
}

/** A dashboard body from a request: the sheets it names are checked (404) before the role, the shape after. */
async function writeRequest(
  app: App,
  ctx: Context,
  workbook: WorkbookRow,
  role: Role,
  version: boolean,
): Promise<{ body: DashboardBody; expected: number | null }> {
  const peeked = ctx.peek();
  if (isObject(peeked)) {
    try {
      requireKnownSheets(dashboardBody(peeked), await sheetsOf(app, workbook.id));
    } catch (error) {
      if (!(error instanceof Malformed)) throw error;
    }
  }
  requireRole(role, 'creator');
  const expected = version ? requireVersion(ctx, workbook.version) : null;
  return { body: parsed(() => dashboardBody(ctx.object())), expected };
}

export const mountDashboards: Module = (app) => {
  app.schema(dashboardSchema);

  async function answer(user: AuthUser, id: string, status: number) {
    return json(status, (await openDashboard(app, user, id)).dashboard);
  }

  app.route({
    method: 'POST',
    path: '/api/workbooks/:id/dashboards',
    body: 'json',
    handler: async (ctx) => {
      const { workbook, role } = await openWorkbook(app, ctx.user, ctx.params.id ?? '');
      const { body } = await writeRequest(app, ctx, workbook, role, false);
      return answer(ctx.user, await saveDashboard(app, workbook, null, body, null), 201);
    },
  });

  app.route({
    method: 'GET',
    path: '/api/dashboards/:id',
    handler: (ctx) => answer(ctx.user, ctx.params.id ?? '', 200),
  });

  app.route({
    method: 'PUT',
    path: '/api/dashboards/:id',
    body: 'json',
    handler: async (ctx) => {
      const { dashboard, workbook, role } = await openDashboard(app, ctx.user, ctx.params.id ?? '');
      const { body, expected } = await writeRequest(app, ctx, workbook, role, true);
      return answer(ctx.user, await saveDashboard(app, workbook, dashboard.id, body, expected), 200);
    },
  });
};

