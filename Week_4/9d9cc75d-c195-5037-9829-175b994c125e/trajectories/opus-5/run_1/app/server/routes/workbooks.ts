import { SAMPLE_SHEET_ID, sheetAccess, workbookAccess } from '../access.js';
import { atLeast, projectAccess, roleIn } from '../auth.js';
import { config } from '../config.js';
import { id as newId, q, q1 } from '../db.js';
import {
  asObject,
  fail,
  forbidden,
  int,
  rateLimit,
  requireUser,
  sendJson,
  str,
  type Ctx,
  type Router,
} from '../http.js';
import { checkFormula, findCycle, type CheckEnv } from '../../shared/check.js';
import { parseFilters, parseMeasurePill, parseParameterOverrides, parseSetOverrides, parseSheetSpec } from '../domain/parse.js';
import {
  loadParameters,
  loadSets,
  loadSheetBundle,
  queryInputFor,
  runSheetQuery,
  toQueryResult,
} from '../domain/sheetquery.js';
import { memberList } from '../domain/query.js';
import { ViewRefused } from '../domain/query.js';


function ifMatch(ctx: Ctx): number | null {
  const header = ctx.req.headers['if-match'];
  if (typeof header !== 'string') return null;
  const value = Number(header.replace(/"/g, ''));
  return Number.isFinite(value) ? value : null;
}

function requireMatch(ctx: Ctx, current: number): void {
  if (ifMatch(ctx) !== current) fail(409, 'stale_version', undefined, { version: current });
}

async function bumpWorkbook(workbookId: string): Promise<number> {
  const row = await q1<{ version: number }>('UPDATE workbooks SET version = version + 1 WHERE id = $1 RETURNING version', [
    workbookId,
  ]);
  return row?.version ?? 1;
}

async function checkEnvFor(sheetId: string): Promise<CheckEnv | null> {
  const bundle = await loadSheetBundle(sheetId);
  if (bundle === null) return null;
  return {
    fields: bundle.source.fields.map((f) => ({ name: f.name, type: f.type, kind: f.kind })),
    calcs: bundle.calcs.map((c) => ({ name: c.name, formula: c.formula })),
    parameters: bundle.parameters.map((p) => ({ name: p.name, type: p.type })),
    sets: bundle.sets.map((s) => ({ name: s.name })),
    maxChars: config.formulaMaxChars,
    maxDepth: config.formulaMaxDepth,
  };
}

export function registerWorkbooks(router: Router): void {
  router.get('/api/workbooks', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await q<{
      id: string;
      name: string;
      project: string;
      project_name: string;
      state: string;
      certified_by: string | null;
    }>(
      `SELECT w.id, w.name, w.project_id AS project, p.name AS project_name, w.state, w.certified_by
       FROM workbooks w
       JOIN projects p ON p.id = w.project_id
       JOIN members m ON m.project_id = w.project_id AND m.user_id = $1
       WHERE w.state = 'published' OR m.role = 'creator'
       ORDER BY w.created_at`,
      [user.id],
    );
    sendJson(ctx.res, 200, rows);
  });

  router.post('/api/projects/:id/workbooks', async (ctx) => {
    await projectAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const sourceId = str(body.source) ?? '';
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    const source = await q1<{ id: string; project_id: string }>('SELECT id, project_id FROM sources WHERE id = $1', [
      sourceId,
    ]);
    if (source === null) fail(404, 'not_found');
    const user = requireUser(ctx);
    if ((await roleIn(source.project_id, user.id)) === null) fail(404, 'not_found');
    const workbookId = newId();
    await q1('INSERT INTO workbooks (id, project_id, source_id, name) VALUES ($1, $2, $3, $4)', [
      workbookId,
      ctx.params.id,
      sourceId,
      name,
    ]);
    sendJson(ctx.res, 201, {
      id: workbookId,
      name,
      project: ctx.params.id,
      source: sourceId,
      state: 'draft',
      version: 1,
      certified_by: null,
      sheets: [],
      dashboards: [],
    });
  });

  router.get('/api/workbooks/:id', async (ctx) => {
    const { workbook } = await workbookAccess(ctx, ctx.params.id);
    const sheets = await q<{ id: string; name: string }>(
      'SELECT id, name FROM sheets WHERE workbook_id = $1 AND owner_id IS NULL ORDER BY ord, created_at',
      [workbook.id],
    );
    const dashboards = await q<{ id: string; name: string }>(
      'SELECT id, name FROM dashboards WHERE workbook_id = $1 ORDER BY ord',
      [workbook.id],
    );
    const project = await q1<{ name: string }>('SELECT name FROM projects WHERE id = $1', [workbook.project_id]);
    sendJson(ctx.res, 200, {
      id: workbook.id,
      name: workbook.name,
      project: workbook.project_id,
      project_name: project?.name ?? '',
      source: workbook.source_id,
      state: workbook.state,
      version: workbook.version,
      certified_by: workbook.certified_by,
      sheets,
      dashboards,
      parameters: await loadParameters(workbook.id),
      sets: await loadSets(workbook.id),
    });
  });

  router.post('/api/workbooks/:id/publish', async (ctx) => {
    const { workbook, user } = await workbookAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const projectId = str(body.project) ?? workbook.project_id;
    requireMatch(ctx, workbook.version);
    const role = await roleIn(projectId, user.id);
    if (role === null) fail(404, 'not_found');
    if (!atLeast(role, 'creator')) forbidden();
    const version = await bumpWorkbook(workbook.id);
    await q1("UPDATE workbooks SET state = 'published', project_id = $2, certified_by = NULL WHERE id = $1", [
      workbook.id,
      projectId,
    ]);
    sendJson(ctx.res, 200, { state: 'published', project: projectId, version, certified_by: null });
  });

  router.post('/api/workbooks/:id/certify', async (ctx) => {
    const { workbook, user } = await workbookAccess(ctx, ctx.params.id, 'creator');
    if (workbook.state !== 'published') fail(409, 'not_published');
    await q1('UPDATE workbooks SET certified_by = $2 WHERE id = $1', [workbook.id, user.username]);
    sendJson(ctx.res, 200, { certified_by: user.username });
  });

  router.post('/api/workbooks/:id/sheets', async (ctx) => {
    const { workbook } = await workbookAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    requireMatch(ctx, workbook.version);
    const spec = parseSheetSpec(body);
    if (spec.name === '') fail(422, 'invalid', { name: 'Name is required.' });
    const sheetId = newId();
    const ord = await q1<{ max: number | null }>('SELECT MAX(ord) AS max FROM sheets WHERE workbook_id = $1', [
      workbook.id,
    ]);
    await q1('INSERT INTO sheets (id, workbook_id, name, spec, version, ord) VALUES ($1, $2, $3, $4, 1, $5)', [
      sheetId,
      workbook.id,
      spec.name,
      JSON.stringify(spec),
      (ord?.max ?? -1) + 1,
    ]);
    const version = await bumpWorkbook(workbook.id);
    sendJson(ctx.res, 201, { id: sheetId, version, ...spec });
  });

  router.get('/api/sheets/:id', async (ctx) => {
    if (ctx.params.id !== SAMPLE_SHEET_ID) await sheetAccess(ctx, ctx.params.id);
    const bundle = await loadSheetBundle(ctx.params.id);
    if (bundle === null) fail(404, 'not_found');
    sendJson(ctx.res, 200, {
      id: bundle.sheet.id,
      workbook: bundle.sheet.workbook_id,
      version: bundle.sheet.version,
      owner: bundle.sheet.owner_id,
      source: bundle.workbook.source_id,
      ...bundle.sheet.spec,
      calculations: bundle.calcs,
    });
  });

  router.put('/api/sheets/:id', async (ctx) => {
    const { sheet, workbook, role } = await sheetAccess(ctx, ctx.params.id, 'explorer');
    if (sheet.owner_id === null && !atLeast(role, 'creator')) forbidden();
    const body = asObject(await ctx.body());
    const current = sheet.owner_id === null ? workbook.version : sheet.version;
    requireMatch(ctx, current);
    const spec = parseSheetSpec({ ...body, name: str(body.name) ?? sheet.name });
    if (spec.name === '') fail(422, 'invalid', { name: 'Name is required.' });
    let version: number;
    if (sheet.owner_id === null) {
      version = await bumpWorkbook(workbook.id);
      await q1('UPDATE sheets SET name = $2, spec = $3 WHERE id = $1', [sheet.id, spec.name, JSON.stringify(spec)]);
    } else {
      const row = await q1<{ version: number }>(
        'UPDATE sheets SET name = $2, spec = $3, version = version + 1 WHERE id = $1 RETURNING version',
        [sheet.id, spec.name, JSON.stringify(spec)],
      );
      version = row?.version ?? 1;
    }
    sendJson(ctx.res, 200, { id: sheet.id, version, ...spec });
  });

  router.post('/api/sheets/:id/copy', async (ctx) => {
    const { sheet, user } = await sheetAccess(ctx, ctx.params.id, 'explorer');
    const copyId = newId();
    await q1(
      'INSERT INTO sheets (id, workbook_id, name, spec, version, owner_id, copy_of) VALUES ($1, $2, $3, $4, 1, $5, $6)',
      [copyId, sheet.workbook_id, sheet.name, JSON.stringify(sheet.spec), user.id, sheet.id],
    );
    const calcs = await q<{ name: string; formula: string; ord: number }>(
      'SELECT name, formula, ord FROM calculations WHERE sheet_id = $1 ORDER BY ord',
      [sheet.id],
    );
    for (const calc of calcs) {
      await q1('INSERT INTO calculations (id, sheet_id, name, formula, ord) VALUES ($1, $2, $3, $4, $5)', [
        newId(),
        copyId,
        calc.name,
        calc.formula,
        calc.ord,
      ]);
    }
    sendJson(ctx.res, 201, { id: copyId, version: 1, owner: user.id, ...sheet.spec, calculations: calcs });
  });

  router.post('/api/sheets/:id/query', async (ctx) => {
    if (ctx.user !== null) rateLimit(`query:${ctx.user.id}`, config.queryRate);
    if (ctx.params.id !== SAMPLE_SHEET_ID) await sheetAccess(ctx, ctx.params.id);
    const body = asObject(await ctx.body());
    const gen = Number(ctx.url.searchParams.get('gen') ?? '1');
    const bundle = await loadSheetBundle(ctx.params.id);
    if (bundle === null) fail(404, 'not_found');
    const request = {
      filters: parseFilters(body.filters),
      parameters: parseParameterOverrides(body.parameters),
      sets: parseSetOverrides(body.sets),
      highlight: null,
    };
    try {
      const output = runSheetQuery(bundle, ctx.user, request);
      sendJson(ctx.res, 200, toQueryResult(output, Number.isFinite(gen) ? gen : 1));
    } catch (err) {
      if (err instanceof ViewRefused) fail(422, 'view_refused', undefined, { message: err.notice });
      throw err;
    }
  });

  router.post('/api/sheets/:id/members', async (ctx) => {
    if (ctx.params.id !== SAMPLE_SHEET_ID) await sheetAccess(ctx, ctx.params.id);
    const body = asObject(await ctx.body());
    const bundle = await loadSheetBundle(ctx.params.id);
    if (bundle === null) fail(404, 'not_found');
    const field = str(body.field) ?? '';
    const step = str(body.step) ?? 'dimension';
    const input = queryInputFor(bundle, ctx.user, {
      filters: parseFilters(body.filters),
      parameters: parseParameterOverrides(body.parameters),
      sets: {},
    });
    const members = memberList(input, field, step as 'source' | 'context' | 'dimension' | 'top' | 'measure' | 'table_calc');
    sendJson(ctx.res, 200, { members });
  });

  router.post('/api/sheets/:id/calculations', async (ctx) => {
    const { sheet, workbook, role } = await sheetAccess(ctx, ctx.params.id, 'explorer');
    if (sheet.owner_id === null && !atLeast(role, 'creator')) forbidden();
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const formula = str(body.formula) ?? '';
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    const env = await checkEnvFor(sheet.id);
    if (env === null) fail(404, 'not_found');
    if (env.fields.some((f) => f.name === name) || env.calcs.some((c) => c.name === name)) {
      fail(422, 'invalid', { name: `A field named ${name} already exists.` });
    }
    const check = checkFormula(formula, { ...env, calcs: [...env.calcs, { name, formula }] });
    if (!check.valid) fail(422, 'invalid', { formula: check.message });
    const cycle = findCycle(name, formula, env);
    if (cycle !== null) fail(422, 'invalid', { formula: `Cycle: ${cycle.join(' -> ')}.` });
    const calcId = newId();
    const ord = await q1<{ max: number | null }>('SELECT MAX(ord) AS max FROM calculations WHERE sheet_id = $1', [
      sheet.id,
    ]);
    await q1('INSERT INTO calculations (id, sheet_id, name, formula, ord) VALUES ($1, $2, $3, $4, $5)', [
      calcId,
      sheet.id,
      name,
      formula,
      (ord?.max ?? -1) + 1,
    ]);
    if (sheet.owner_id === null) await bumpWorkbook(workbook.id);
    else await q1('UPDATE sheets SET version = version + 1 WHERE id = $1', [sheet.id]);
    sendJson(ctx.res, 201, { id: calcId, name, formula });
  });

  router.put('/api/calculations/:id', async (ctx) => {
    const calc = await q1<{ id: string; sheet_id: string; name: string }>(
      'SELECT id, sheet_id, name FROM calculations WHERE id = $1',
      [ctx.params.id],
    );
    if (calc === null) fail(404, 'not_found');
    const { sheet, workbook, role } = await sheetAccess(ctx, calc.sheet_id, 'explorer');
    if (sheet.owner_id === null && !atLeast(role, 'creator')) forbidden();
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const formula = str(body.formula) ?? '';
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    const env = await checkEnvFor(sheet.id);
    if (env === null) fail(404, 'not_found');
    if (
      env.fields.some((f) => f.name === name) ||
      env.calcs.some((c) => c.name === name && c.name !== calc.name)
    ) {
      fail(422, 'invalid', { name: `A field named ${name} already exists.` });
    }
    const others = env.calcs.filter((c) => c.name !== calc.name);
    const check = checkFormula(formula, { ...env, calcs: [...others, { name, formula }] });
    if (!check.valid) fail(422, 'invalid', { formula: check.message });
    const cycle = findCycle(name, formula, { ...env, calcs: others });
    if (cycle !== null) fail(422, 'invalid', { formula: `Cycle: ${cycle.join(' -> ')}.` });
    await q1('UPDATE calculations SET name = $2, formula = $3 WHERE id = $1', [calc.id, name, formula]);
    if (sheet.owner_id === null) await bumpWorkbook(workbook.id);
    else await q1('UPDATE sheets SET version = version + 1 WHERE id = $1', [sheet.id]);
    sendJson(ctx.res, 200, { id: calc.id, name, formula });
  });

  router.post('/api/formula/check', async (ctx) => {
    if (ctx.user !== null) rateLimit(`formula:${ctx.user.id}`, config.formulaRate);
    requireUser(ctx);
    const body = asObject(await ctx.body());
    const sheetId = str(body.sheet) ?? '';
    const formula = str(body.formula) ?? '';
    await sheetAccess(ctx, sheetId);
    const env = await checkEnvFor(sheetId);
    if (env === null) fail(404, 'not_found');
    const check = checkFormula(formula, env);
    if (check.valid) {
      sendJson(ctx.res, 200, { valid: true, type: check.type, aggregate: check.aggregate });
      return;
    }
    sendJson(ctx.res, 200, { valid: false, message: check.message, line: check.line, column: check.column });
  });

  router.post('/api/workbooks/:id/parameters', async (ctx) => {
    const { workbook } = await workbookAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const type = str(body.type);
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    if (type !== 'number' && type !== 'text' && type !== 'list') fail(422, 'invalid');
    const values = Array.isArray(body.values) ? body.values.filter((v): v is string => typeof v === 'string') : [];
    const parameterId = newId();
    const ord = await q1<{ max: number | null }>('SELECT MAX(ord) AS max FROM parameters WHERE workbook_id = $1', [
      workbook.id,
    ]);
    await q1(
      'INSERT INTO parameters (id, workbook_id, name, type, value, values_list, ord) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [parameterId, workbook.id, name, type, JSON.stringify(body.value ?? null), JSON.stringify(values), (ord?.max ?? -1) + 1],
    );
    await bumpWorkbook(workbook.id);
    sendJson(ctx.res, 201, { id: parameterId, name, type, value: body.value ?? null, values });
  });

  router.put('/api/parameters/:id', async (ctx) => {
    const parameter = await q1<{ id: string; workbook_id: string; type: string }>(
      'SELECT id, workbook_id, type FROM parameters WHERE id = $1',
      [ctx.params.id],
    );
    if (parameter === null) fail(404, 'not_found');
    const { workbook } = await workbookAccess(ctx, parameter.workbook_id, 'creator');
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    const values = Array.isArray(body.values) ? body.values.filter((v): v is string => typeof v === 'string') : [];
    await q1('UPDATE parameters SET name = $2, value = $3, values_list = $4 WHERE id = $1', [
      parameter.id,
      name,
      JSON.stringify(body.value ?? null),
      JSON.stringify(values),
    ]);
    await bumpWorkbook(workbook.id);
    sendJson(ctx.res, 200, { id: parameter.id, name, type: parameter.type, value: body.value ?? null, values });
  });

  router.post('/api/workbooks/:id/sets', async (ctx) => {
    const { workbook } = await workbookAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const field = str(body.field) ?? '';
    if (name === '' || field === '') fail(422, 'invalid', { name: 'Name is required.' });
    const top = asObject(body.top);
    const hasTop = 'n' in top;
    const setId = newId();
    const ord = await q1<{ max: number | null }>('SELECT MAX(ord) AS max FROM sets WHERE workbook_id = $1', [
      workbook.id,
    ]);
    const topSpec = hasTop
      ? { n: typeof top.n === 'string' ? top.n : int(top.n) ?? 0, by: parseMeasurePill(top.by) }
      : null;
    const members = Array.isArray(body.members) ? body.members : null;
    await q1('INSERT INTO sets (id, workbook_id, name, field, members, top, ord) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      setId,
      workbook.id,
      name,
      field,
      members === null ? null : JSON.stringify(members),
      topSpec === null ? null : JSON.stringify(topSpec),
      (ord?.max ?? -1) + 1,
    ]);
    await bumpWorkbook(workbook.id);
    sendJson(ctx.res, 201, { id: setId, name, field, members, top: topSpec });
  });

  router.put('/api/sets/:id', async (ctx) => {
    const set = await q1<{ id: string; workbook_id: string }>('SELECT id, workbook_id FROM sets WHERE id = $1', [
      ctx.params.id,
    ]);
    if (set === null) fail(404, 'not_found');
    const { workbook } = await workbookAccess(ctx, set.workbook_id, 'creator');
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const field = str(body.field) ?? '';
    if (name === '' || field === '') fail(422, 'invalid', { name: 'Name is required.' });
    const top = asObject(body.top);
    const topSpec = 'n' in top ? { n: typeof top.n === 'string' ? top.n : int(top.n) ?? 0, by: parseMeasurePill(top.by) } : null;
    const members = Array.isArray(body.members) ? body.members : null;
    await q1('UPDATE sets SET name = $2, field = $3, members = $4, top = $5 WHERE id = $1', [
      set.id,
      name,
      field,
      members === null ? null : JSON.stringify(members),
      topSpec === null ? null : JSON.stringify(topSpec),
    ]);
    await bumpWorkbook(workbook.id);
    sendJson(ctx.res, 200, { id: set.id, name, field, members, top: topSpec });
  });

  router.post('/api/sheets/:id/alerts', async (ctx) => {
    const { sheet, user } = await sheetAccess(ctx, ctx.params.id);
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const above = int(body.above);
    const measure = parseMeasurePill(body.measure);
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    if (above === null) fail(422, 'invalid', { above: 'Above must be a number.' });
    if (measure === null) fail(422, 'invalid', { measure: 'Name is required.' });
    const alertId = newId();
    await q1('INSERT INTO alerts (id, sheet_id, user_id, name, measure, above) VALUES ($1, $2, $3, $4, $5, $6)', [
      alertId,
      sheet.id,
      user.id,
      name,
      JSON.stringify(measure),
      above,
    ]);
    sendJson(ctx.res, 201, { id: alertId, name, above, armed: true });
  });

}
