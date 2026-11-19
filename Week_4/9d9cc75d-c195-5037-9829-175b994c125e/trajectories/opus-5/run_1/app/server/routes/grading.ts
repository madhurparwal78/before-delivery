import { advanceClock, now, nowIso, setClock } from '../clock.js';
import { createSession, createUser, cookieFor, userByName } from '../auth.js';
import { id as newId, q1 } from '../db.js';
import { broadcastClock } from '../events.js';
import { arr, asObject, fail, int, sendJson, str, type Router } from '../http.js';
import { setStorageDown } from '../storage.js';
import { createGeneratedSource, createSampleSource, setRelation, storeTable } from '../domain/ingest.js';
import { parseCsv } from '../domain/csv.js';
import { injectRefreshFailures, runDueRefreshes } from '../domain/extract.js';
import { setExportsPaused } from '../domain/exportjobs.js';
import { invalidateSource } from '../domain/source.js';
import { parseActions, parseFloating, parseLayout, parseMeasurePill, parseSheetSpec } from '../domain/parse.js';
import type { LayoutNode } from '../../shared/types.js';

interface SeedIds {
  users: Record<string, string>;
  projects: Record<string, string>;
  sources: Record<string, string>;
  workbooks: Record<string, string>;
  sheets: Record<string, string>;
  dashboards: Record<string, string>;
  parameters: Record<string, string>;
  sets: Record<string, string>;
  alerts: Record<string, string>;
}

function mapLayout(node: LayoutNode, sheetIds: Map<string, string>): LayoutNode {
  if (node.sheet !== undefined) {
    return { sheet: sheetIds.get(node.sheet) ?? node.sheet, fixed: node.fixed ?? null };
  }
  return {
    type: node.type,
    children: (node.children ?? []).map((child) => mapLayout(child, sheetIds)),
    fixed: node.fixed ?? null,
  };
}

export function registerGrading(router: Router): void {
  router.post('/api/grading/seed', async (ctx) => {
    const body = asObject(await ctx.body());
    const ids: SeedIds = {
      users: {},
      projects: {},
      sources: {},
      workbooks: {},
      sheets: {},
      dashboards: {},
      parameters: {},
      sets: {},
      alerts: {},
    };

    for (const entry of arr(body.users)) {
      const user = asObject(entry);
      const username = (str(user.username) ?? '').toLowerCase();
      const password = str(user.password) ?? 'password';
      const existing = await userByName(username);
      if (existing !== null) {
        ids.users[username] = existing.id;
        continue;
      }
      const created = await createUser(username, password);
      ids.users[username] = created.id;
    }

    for (const entry of arr(body.projects)) {
      const project = asObject(entry);
      const name = str(project.name) ?? '';
      let projectId: string;
      const existing = await q1<{ id: string }>('SELECT id FROM projects WHERE name = $1', [name]);
      if (existing !== null) {
        projectId = existing.id;
      } else {
        projectId = newId();
        await q1('INSERT INTO projects (id, name, explorers_schedule) VALUES ($1, $2, $3)', [
          projectId,
          name,
          project.explorers_schedule === true,
        ]);
      }
      if ('explorers_schedule' in project) {
        await q1('UPDATE projects SET explorers_schedule = $2 WHERE id = $1', [
          projectId,
          project.explorers_schedule === true,
        ]);
      }
      ids.projects[name] = projectId;
      for (const [username, role] of Object.entries(asObject(project.members))) {
        const user = await userByName(username.toLowerCase());
        if (user === null) continue;
        await q1(
          `INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3`,
          [projectId, user.id, String(role)],
        );
      }
    }

    const projectIdFor = async (name: string): Promise<string> => {
      if (ids.projects[name] !== undefined) return ids.projects[name];
      const row = await q1<{ id: string }>('SELECT id FROM projects WHERE name = $1', [name]);
      if (row === null) fail(422, 'invalid', { project: 'Name is required.' });
      return row.id;
    };

    const sourceIdFor = async (name: string): Promise<string> => {
      if (ids.sources[name] !== undefined) return ids.sources[name];
      const row = await q1<{ id: string }>('SELECT id FROM sources WHERE name = $1 ORDER BY created_at DESC LIMIT 1', [
        name,
      ]);
      if (row === null) fail(422, 'invalid', { source: 'Name is required.' });
      return row.id;
    };

    for (const entry of arr(body.sources)) {
      const source = asObject(entry);
      const name = str(source.name) ?? '';
      const projectId = await projectIdFor(str(source.project) ?? '');
      if (str(source.sample) === 'fernhollow') {
        ids.sources[name] = await createSampleSource(projectId, name);
        continue;
      }
      const rows = int(source.rows);
      if (rows !== null) {
        ids.sources[name] = await createGeneratedSource(projectId, name, rows);
        continue;
      }
      const sourceId = newId();
      let first = true;
      for (const tableEntry of arr(source.tables)) {
        const table = asObject(tableEntry);
        const tableName = str(table.name) ?? 'data';
        const csv = str(table.csv) ?? '';
        const bytes = Buffer.from(csv, 'utf8');
        await storeTable({
          sourceId,
          projectId,
          sourceName: name,
          tableName,
          bytes,
          parsed: parseCsv(bytes),
          newSource: first,
        });
        first = false;
      }
      const relation = asObject(source.relation);
      if ('left_table' in relation) {
        await setRelation(sourceId, {
          left_table: str(relation.left_table) ?? '',
          left_key: str(relation.left_key) ?? '',
          right_table: str(relation.right_table) ?? '',
          right_key: str(relation.right_key) ?? '',
        });
      }
      ids.sources[name] = sourceId;
    }

    for (const entry of arr(body.entitlements)) {
      const record = asObject(entry);
      const sourceId = await sourceIdFor(str(record.source) ?? '');
      const users: Record<string, unknown[]> = {};
      for (const [username, values] of Object.entries(asObject(record.users))) {
        users[username.toLowerCase()] = arr(values);
      }
      await q1('UPDATE sources SET entitlements = $2 WHERE id = $1', [
        sourceId,
        JSON.stringify({ field: str(record.field), users }),
      ]);
      invalidateSource(sourceId);
    }

    for (const entry of arr(body.workbooks)) {
      const workbook = asObject(entry);
      const name = str(workbook.name) ?? '';
      const projectId = await projectIdFor(str(workbook.project) ?? '');
      const sourceId = await sourceIdFor(str(workbook.source) ?? '');
      const workbookId = newId();
      await q1(
        'INSERT INTO workbooks (id, project_id, source_id, name, state, certified_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [workbookId, projectId, sourceId, name, str(workbook.state) ?? 'draft', str(workbook.certified_by)],
      );
      ids.workbooks[name] = workbookId;

      for (const paramEntry of arr(workbook.parameters)) {
        const parameter = asObject(paramEntry);
        const parameterId = newId();
        await q1(
          'INSERT INTO parameters (id, workbook_id, name, type, value, values_list, ord) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            parameterId,
            workbookId,
            str(parameter.name) ?? '',
            str(parameter.type) ?? 'number',
            JSON.stringify(parameter.value ?? null),
            JSON.stringify(arr(parameter.values)),
            arr(workbook.parameters).indexOf(paramEntry),
          ],
        );
        ids.parameters[`${name}/${str(parameter.name) ?? ''}`] = parameterId;
      }

      for (const setEntry of arr(workbook.sets)) {
        const set = asObject(setEntry);
        const setId = newId();
        const top = asObject(set.top);
        await q1('INSERT INTO sets (id, workbook_id, name, field, members, top, ord) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          setId,
          workbookId,
          str(set.name) ?? '',
          str(set.field) ?? '',
          Array.isArray(set.members) ? JSON.stringify(set.members) : null,
          'n' in top
            ? JSON.stringify({ n: typeof top.n === 'string' ? top.n : int(top.n) ?? 0, by: parseMeasurePill(top.by) })
            : null,
          arr(workbook.sets).indexOf(setEntry),
        ]);
        ids.sets[`${name}/${str(set.name) ?? ''}`] = setId;
      }

      const sheetIds = new Map<string, string>();
      let ord = 0;
      for (const sheetEntry of arr(workbook.sheets)) {
        const sheetBody = asObject(sheetEntry);
        const spec = parseSheetSpec(sheetBody);
        const sheetId = newId();
        await q1('INSERT INTO sheets (id, workbook_id, name, spec, version, ord) VALUES ($1, $2, $3, $4, 1, $5)', [
          sheetId,
          workbookId,
          spec.name,
          JSON.stringify(spec),
          ord,
        ]);
        ord += 1;
        sheetIds.set(spec.name, sheetId);
        ids.sheets[`${name}/${spec.name}`] = sheetId;
        let calcOrd = 0;
        for (const calcEntry of arr(sheetBody.calcs)) {
          const calc = asObject(calcEntry);
          await q1('INSERT INTO calculations (id, sheet_id, name, formula, ord) VALUES ($1, $2, $3, $4, $5)', [
            newId(),
            sheetId,
            str(calc.name) ?? '',
            str(calc.formula) ?? '',
            calcOrd,
          ]);
          calcOrd += 1;
        }
      }

      let dashOrd = 0;
      for (const dashEntry of arr(workbook.dashboards)) {
        const dashboard = asObject(dashEntry);
        const spec = {
          layout: mapLayout(parseLayout(dashboard.layout), sheetIds),
          floating: parseFloating(dashboard.floating).map((f) => ({ ...f, sheet: sheetIds.get(f.sheet) ?? f.sheet })),
          phone_order: arr(dashboard.phone_order)
            .filter((s): s is string => typeof s === 'string')
            .map((s) => sheetIds.get(s) ?? s),
          phone_heights: Object.fromEntries(
            Object.entries(asObject(dashboard.phone_heights)).map(([sheetName, height]) => [
              sheetIds.get(sheetName) ?? sheetName,
              int(height) ?? 0,
            ]),
          ),
          actions: parseActions(dashboard.actions).map((action) => ({
            ...action,
            source: sheetIds.get(action.source) ?? action.source,
            targets: action.targets.map((t) => sheetIds.get(t) ?? t),
          })),
        };
        const dashboardId = newId();
        await q1('INSERT INTO dashboards (id, workbook_id, name, spec, ord) VALUES ($1, $2, $3, $4, $5)', [
          dashboardId,
          workbookId,
          str(dashboard.name) ?? '',
          JSON.stringify(spec),
          dashOrd,
        ]);
        dashOrd += 1;
        ids.dashboards[`${name}/${str(dashboard.name) ?? ''}`] = dashboardId;
      }
    }

    for (const entry of arr(body.schedules)) {
      const schedule = asObject(entry);
      const sourceId = await sourceIdFor(str(schedule.source) ?? '');
      await q1('UPDATE sources SET schedule = $2 WHERE id = $1', [
        sourceId,
        JSON.stringify({
          every_minutes: int(schedule.every_minutes) ?? 60,
          kind: str(schedule.kind) ?? 'full',
          key: str(schedule.key),
        }),
      ]);
      await q1(
        `INSERT INTO extracts (source_id, state, last_run_at, last_success_at) VALUES ($1, 'live', $2, $2)
         ON CONFLICT (source_id) DO UPDATE SET last_run_at = $2`,
        [sourceId, now()],
      );
    }

    for (const entry of arr(body.alerts)) {
      const alert = asObject(entry);
      const user = await userByName((str(alert.username) ?? '').toLowerCase());
      const workbookName = str(alert.workbook) ?? '';
      const sheetName = str(alert.sheet) ?? '';
      const sheetId = ids.sheets[`${workbookName}/${sheetName}`];
      if (user === null || sheetId === undefined) continue;
      const alertId = newId();
      await q1('INSERT INTO alerts (id, sheet_id, user_id, name, measure, above) VALUES ($1, $2, $3, $4, $5, $6)', [
        alertId,
        sheetId,
        user.id,
        str(alert.name) ?? '',
        JSON.stringify(parseMeasurePill(alert.measure)),
        int(alert.above) ?? 0,
      ]);
      ids.alerts[str(alert.name) ?? ''] = alertId;
    }

    for (const entry of arr(body.extracts)) {
      const extract = asObject(entry);
      const sourceId = await sourceIdFor(str(extract.source) ?? '');
      await q1(
        `INSERT INTO extracts (source_id, state, last_success_at, last_failure_at, last_run_at)
         VALUES ($1, $2, $3, $4, COALESCE($3, $4))
         ON CONFLICT (source_id) DO UPDATE SET state = $2, last_success_at = $3, last_failure_at = $4`,
        [
          sourceId,
          str(extract.state) ?? 'live',
          str(extract.last_success_at),
          str(extract.last_failure_at),
        ],
      );
    }

    sendJson(ctx.res, 201, ids);
  });

  router.post('/api/grading/session', async (ctx) => {
    const body = asObject(await ctx.body());
    const username = (str(body.username) ?? '').toLowerCase();
    const user = await userByName(username);
    if (user === null) fail(422, 'invalid', { username: 'No such user.' });
    const session = await createSession(user.id);
    ctx.setCookie(cookieFor(session));
    sendJson(ctx.res, 200, { user: { id: user.id, username: user.username } });
  });

  router.post('/api/grading/clock', async (ctx) => {
    const body = asObject(await ctx.body());
    const set = str(body.set);
    const advance = int(body.advance_ms);
    if (set !== null) setClock(set);
    else if (advance !== null) advanceClock(advance);
    await runDueRefreshes();
    broadcastClock();
    sendJson(ctx.res, 200, { now: nowIso() });
  });

  router.post('/api/grading/storage', async (ctx) => {
    const body = asObject(await ctx.body());
    const down = body.down === true;
    setStorageDown(down);
    sendJson(ctx.res, 200, { down });
  });

  router.post('/api/grading/source-file', async (ctx) => {
    const body = asObject(await ctx.body());
    const sourceName = str(body.source) ?? '';
    const tableName = str(body.table) ?? '';
    const csv = str(body.csv) ?? '';
    const source = await q1<{ id: string; project_id: string; name: string }>(
      'SELECT id, project_id, name FROM sources WHERE id = $1 OR name = $1 ORDER BY created_at DESC LIMIT 1',
      [sourceName],
    );
    if (source === null) fail(404, 'not_found');
    const bytes = Buffer.from(csv, 'utf8');
    await storeTable({
      sourceId: source.id,
      projectId: source.project_id,
      sourceName: source.name,
      tableName,
      bytes,
      parsed: parseCsv(bytes),
      newSource: false,
    });
    sendJson(ctx.res, 200, { source: source.id, table: tableName });
  });

  router.post('/api/grading/refresh-failure', async (ctx) => {
    const body = asObject(await ctx.body());
    const sourceName = str(body.source) ?? '';
    const source = await q1<{ id: string }>(
      'SELECT id FROM sources WHERE id = $1 OR name = $1 ORDER BY created_at DESC LIMIT 1',
      [sourceName],
    );
    if (source === null) fail(404, 'not_found');
    injectRefreshFailures(source.id, int(body.times) ?? 1);
    sendJson(ctx.res, 200, { source: source.id, times: int(body.times) ?? 1 });
  });

  router.post('/api/grading/exports', async (ctx) => {
    const body = asObject(await ctx.body());
    const paused = body.paused === true;
    setExportsPaused(paused);
    sendJson(ctx.res, 200, { paused });
  });
}
