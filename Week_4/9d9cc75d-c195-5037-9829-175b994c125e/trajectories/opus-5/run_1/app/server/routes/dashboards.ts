import { workbookAccess } from '../access.js';
import { id as newId, q1 } from '../db.js';
import { asObject, fail, int, sendJson, str, type Ctx, type Router } from '../http.js';
import { parseActions, parseFloating, parseLayout } from '../domain/parse.js';
import { dashboardDoc, dashboardSheetIds, loadDashboardRecord, type DashboardSpec } from '../domain/dashboards.js';
import { nestingDepth } from '../../shared/dashboard.js';
import { loadSheetRecord } from '../domain/sheetquery.js';
import { isMeasurePill } from '../../shared/chart.js';
import { normalizeDim } from '../../shared/viewplan.js';
import type { DimensionPill } from '../../shared/types.js';

async function validate(spec: DashboardSpec, workbookId: string): Promise<void> {
  const sheets = dashboardSheetIds(spec);
  if (sheets.length < 2 || sheets.length > 4) {
    fail(422, 'invalid', { sheets: 'A dashboard holds 2 to 4 sheets.' });
  }
  for (const sheetId of sheets) {
    const sheet = await loadSheetRecord(sheetId);
    if (sheet === null || sheet.workbook_id !== workbookId) fail(404, 'not_found');
  }
  if (nestingDepth(spec.layout) > 2) {
    fail(422, 'invalid', { layout: 'Containers nest at most one level.' });
  }
  for (const action of spec.actions) {
    if (action.type !== 'highlight') continue;
    for (const target of action.targets) {
      const sheet = await loadSheetRecord(target);
      if (sheet === null) fail(404, 'not_found');
      const pills = [
        ...sheet.spec.rows,
        ...sheet.spec.columns,
        ...sheet.spec.detail,
        ...(sheet.spec.color === null ? [] : [sheet.spec.color]),
      ];
      const dims = pills
        .filter((p): p is DimensionPill => !isMeasurePill(p))
        .map((p) => normalizeDim(p).field);
      if (!dims.includes(action.field)) {
        fail(422, 'invalid', { actions: `Highlight needs ${action.field} in every target view.` });
      }
    }
  }
}

function parseSpec(body: Record<string, unknown>): DashboardSpec {
  const heights: Record<string, number> = {};
  for (const [sheetId, value] of Object.entries(asObject(body.phone_heights))) {
    const height = int(value);
    if (height !== null) heights[sheetId] = height;
  }
  return {
    layout: parseLayout(body.layout),
    floating: parseFloating(body.floating),
    phone_order: Array.isArray(body.phone_order)
      ? body.phone_order.filter((s): s is string => typeof s === 'string')
      : [],
    phone_heights: heights,
    actions: parseActions(body.actions),
  };
}

function ifMatch(ctx: Ctx): number | null {
  const header = ctx.req.headers['if-match'];
  if (typeof header !== 'string') return null;
  const value = Number(header.replace(/"/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function registerDashboards(router: Router): void {
  router.post('/api/workbooks/:id/dashboards', async (ctx) => {
    const { workbook } = await workbookAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    const spec = parseSpec(body);
    await validate(spec, workbook.id);
    const dashboardId = newId();
    const ord = await q1<{ max: number | null }>('SELECT MAX(ord) AS max FROM dashboards WHERE workbook_id = $1', [
      workbook.id,
    ]);
    await q1('INSERT INTO dashboards (id, workbook_id, name, spec, ord) VALUES ($1, $2, $3, $4, $5)', [
      dashboardId,
      workbook.id,
      name,
      JSON.stringify(spec),
      (ord?.max ?? -1) + 1,
    ]);
    await q1('UPDATE workbooks SET version = version + 1 WHERE id = $1', [workbook.id]);
    const record = await loadDashboardRecord(dashboardId);
    if (record === null) fail(404, 'not_found');
    sendJson(ctx.res, 201, await dashboardDoc(record));
  });

  router.get('/api/dashboards/:id', async (ctx) => {
    const record = await loadDashboardRecord(ctx.params.id);
    if (record === null) fail(404, 'not_found');
    await workbookAccess(ctx, record.workbook_id);
    sendJson(ctx.res, 200, await dashboardDoc(record));
  });

  router.put('/api/dashboards/:id', async (ctx) => {
    const record = await loadDashboardRecord(ctx.params.id);
    if (record === null) fail(404, 'not_found');
    const { workbook } = await workbookAccess(ctx, record.workbook_id, 'creator');
    const body = asObject(await ctx.body());
    if (ifMatch(ctx) !== workbook.version) {
      fail(409, 'stale_version', undefined, { version: workbook.version });
    }
    const name = (str(body.name) ?? record.name).trim();
    const spec = parseSpec(body);
    await validate(spec, workbook.id);
    await q1('UPDATE dashboards SET name = $2, spec = $3 WHERE id = $1', [record.id, name, JSON.stringify(spec)]);
    await q1('UPDATE workbooks SET version = version + 1 WHERE id = $1', [workbook.id]);
    const updated = await loadDashboardRecord(record.id);
    if (updated === null) fail(404, 'not_found');
    sendJson(ctx.res, 200, await dashboardDoc(updated));
  });

}
