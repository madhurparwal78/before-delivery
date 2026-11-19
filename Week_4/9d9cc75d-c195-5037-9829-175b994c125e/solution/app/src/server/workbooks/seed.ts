// The `workbooks` part of `POST /api/grading/seed`: each workbook with its parameters, sets, sheets (and their
// `calcs`), dashboards (sheets by name), state and certification, written through the same functions as the routes.
import { mapSheets, dashboardBody } from '../dashboards/body.ts';
import { saveDashboard } from '../dashboards/index.ts';
import type { SeedIds } from '../grading/seed.ts';
import type { App } from '../http/app.ts';
import { invalid } from '../http/errors.ts';
import { isObject, nonBlank } from '../http/validate.ts';
import type { JsonObject } from '../http/validate.ts';
import { normalizeUsername } from '../auth/accounts.ts';
import { createSheet, saveCalculation, saveSheet } from '../sheets/edit.ts';
import { calculationFields, parsed, sheetShape } from '../sheets/shape.ts';
import type { SheetAccess } from '../sheets/store.ts';
import { saveParameter, saveSet } from './params.ts';
import { certifyWorkbook, createWorkbook, publishWorkbook } from './store.ts';
import type { WorkbookRow } from './store.ts';

const SEED_TEXT = 'Each workbook needs a name, a project, a source and lists of its parts.';

function objects(value: unknown): JsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isObject)) throw invalid({ workbooks: SEED_TEXT });
  return value;
}

/** A project or source named in this seed call, or an earlier one (the newest of that name). */
async function resolve(app: App, table: 'projects' | 'sources', known: Record<string, string>, ref: unknown): Promise<string> {
  const name = nonBlank(ref);
  if (name === null) throw invalid({ workbooks: SEED_TEXT });
  const id =
    known[name] ??
    (await app.db.row<{ id: string }>(`SELECT id FROM ${table} WHERE name = $1 OR id = $1 ORDER BY created_at DESC LIMIT 1`, [name]))
      ?.id;
  if (id === undefined) throw invalid({ workbooks: `No ${table === 'projects' ? 'project' : 'source'} named ${name}.` });
  return id;
}

async function seedSheet(app: App, workbook: WorkbookRow, entry: JsonObject): Promise<{ id: string; name: string }> {
  const shape = parsed(() => sheetShape(entry));
  const sheet = await createSheet(app, workbook, shape, null);
  const calcs = objects(entry.calcs);
  if (calcs.length > 0) {
    const access: SheetAccess = { sheet, workbook, role: 'creator' };
    for (const calc of calcs) await saveCalculation(app, access, { id: null, ...calculationFields(calc) });
    await saveSheet(app, access, shape, null);
  }
  return { id: sheet.id, name: shape.name };
}

export async function seedWorkbooks(app: App, body: JsonObject, ids: SeedIds): Promise<void> {
  for (const entry of objects(body.workbooks)) {
    const name = nonBlank(entry.name);
    if (name === null) throw invalid({ workbooks: SEED_TEXT });
    const projectId = await resolve(app, 'projects', ids.projects, entry.project);
    const sourceId = await resolve(app, 'sources', ids.sources, entry.source);
    const workbook = await createWorkbook(app.db, projectId, sourceId, name);
    ids.workbooks[name] = workbook.id;
    for (const p of objects(entry.parameters)) {
      const saved = await saveParameter(app, workbook, null, p);
      ids.parameters[saved.name] = saved.id;
    }
    for (const s of objects(entry.sets)) {
      const saved = await saveSet(app, workbook, null, s);
      ids.sets[saved.name] = saved.id;
    }
    const sheetIds = new Map<string, string>();
    for (const s of objects(entry.sheets)) {
      const sheet = await seedSheet(app, workbook, s);
      sheetIds.set(sheet.name, sheet.id);
      ids.sheets[`${name}/${sheet.name}`] = sheet.id;
    }
    for (const d of objects(entry.dashboards)) {
      const dashboard = parsed(() => dashboardBody(d));
      const byId = mapSheets(dashboard, (sheet) => sheetIds.get(sheet) ?? sheet);
      ids.dashboards[`${name}/${dashboard.name}`] = await saveDashboard(app, workbook, null, byId, null);
    }
    if (entry.state === 'published') await publishWorkbook(app.db, workbook.id, projectId);
    const certifier = nonBlank(entry.certified_by);
    if (certifier !== null) await certifyWorkbook(app.db, workbook.id, normalizeUsername(certifier));
  }
}
