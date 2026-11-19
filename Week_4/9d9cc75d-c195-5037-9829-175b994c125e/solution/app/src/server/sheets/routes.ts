import { checkFormula, listMembers } from '../engine/index.ts';
import type { App, AuthUser, Context, RateRule } from '../http/app.ts';
import { invalid, notFound } from '../http/errors.ts';
import { json } from '../http/reply.ts';
import { isObject, nonBlank } from '../http/validate.ts';
import { requireRole } from '../projects/access.ts';
import { openWorkbook, requireVersion } from '../workbooks/store.ts';
import { copySheet, createSheet, saveCalculation, saveSheet, sheetDetail } from './edit.ts';
import { queryInput, runSheet } from './query.ts';
import { sheetScope } from './scope.ts';
import {
  Malformed,
  STEPS,
  calculationFields,
  filters,
  oneOf,
  parameterValues,
  parsed,
  queryRequest,
  sheetShape,
} from './shape.ts';
import { openSheet, requireSheetWrite, sheetVersion } from './store.ts';
import type { SheetAccess } from './store.ts';

function perUser(limiter: RateRule['limiter']): RateRule {
  return { limiter, key: (ctx) => ctx.user?.id ?? null };
}

/** Sheet, calculation, formula check, members and query routes (mounted by the workbooks module). */
export function mountSheets(app: App): void {
  async function answer(user: AuthUser, sheetId: string, status: number) {
    const access = await openSheet(app, user, sheetId);
    return json(status, sheetDetail(access, await sheetScope(app, access.workbook, access.sheet)));
  }

  app.route({
    method: 'POST',
    path: '/api/workbooks/:id/sheets',
    body: 'json',
    handler: async (ctx) => {
      const { workbook, role } = await openWorkbook(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      const expected = requireVersion(ctx, workbook.version);
      const shape = parsed(() => sheetShape(ctx.object()));
      return answer(ctx.user, (await createSheet(app, workbook, shape, expected)).id, 201);
    },
  });

  app.route({
    method: 'GET',
    path: '/api/sheets/:id',
    handler: (ctx) => answer(ctx.user, ctx.params.id ?? '', 200),
  });

  app.route({
    method: 'PUT',
    path: '/api/sheets/:id',
    body: 'json',
    handler: async (ctx) => {
      const access = await openSheet(app, ctx.user, ctx.params.id ?? '');
      requireSheetWrite(access);
      const expected = requireVersion(ctx, sheetVersion(access));
      const shape = parsed(() => sheetShape(ctx.object()));
      await saveSheet(app, access, shape, expected);
      return answer(ctx.user, access.sheet.id, 200);
    },
  });

  app.route({
    method: 'POST',
    path: '/api/sheets/:id/copy',
    handler: async (ctx) => {
      const access = await openSheet(app, ctx.user, ctx.params.id ?? '');
      requireRole(access.role, 'explorer');
      return answer(ctx.user, await copySheet(app, ctx.user, access), 201);
    },
  });

  app.route({
    method: 'POST',
    path: '/api/sheets/:id/query',
    body: 'json',
    rate: perUser(app.limiters.query),
    handler: async (ctx) => {
      const access = await openSheet(app, ctx.user, ctx.params.id ?? '');
      const genText = ctx.url.searchParams.get('gen') ?? '';
      if (!/^\d+$/.test(genText)) throw invalid({ gen: 'gen must be a whole number.' });
      const request = parsed(() => queryRequest(ctx.object()));
      const { outcome } = await runSheet(app, ctx.user, access, request);
      if (!outcome.ok) return json(422, { error: 'view_refused', message: outcome.message });
      return json(200, { gen: Number(genText), ...outcome.result });
    },
  });

  app.route({
    method: 'POST',
    path: '/api/sheets/:id/members',
    body: 'json',
    handler: async (ctx) => {
      const access = await openSheet(app, ctx.user, ctx.params.id ?? '');
      const body = ctx.object();
      const { field, step, request } = parsed(() => {
        const name = nonBlank(body.field);
        if (name === null) throw new Malformed('field', 'Field is required.');
        const at = oneOf(STEPS, body.step);
        if (at === null) throw new Malformed('step', `Step must be one of ${STEPS.join(', ')}.`);
        return { field: name, step: at, request: { filters: filters(body.filters), parameters: parameterValues(body.parameters), sets: {} } };
      });
      const loaded = await sheetScope(app, access.workbook, access.sheet);
      const members = await listMembers(queryInput(app, ctx.user, loaded, loaded.shape, request), field, step);
      return json(200, { members });
    },
  });

  async function writableSheet(ctx: Context, sheetId: string): Promise<SheetAccess> {
    const access = await openSheet(app, ctx.user, sheetId);
    requireSheetWrite(access);
    return access;
  }

  app.route({
    method: 'POST',
    path: '/api/sheets/:id/calculations',
    body: 'json',
    handler: async (ctx) => {
      const access = await writableSheet(ctx, ctx.params.id ?? '');
      return json(201, await saveCalculation(app, access, { id: null, ...calculationFields(ctx.object()) }));
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/calculations/:id',
    body: 'json',
    handler: async (ctx) => {
      const id = ctx.params.id ?? '';
      const found = await app.db.row<{ sheet_id: string }>(`SELECT sheet_id FROM calculations WHERE id = $1`, [id]);
      if (!found) throw notFound();
      const access = await writableSheet(ctx, found.sheet_id);
      return json(200, await saveCalculation(app, access, { id, ...calculationFields(ctx.object()) }));
    },
  });

  app.route({
    method: 'POST',
    path: '/api/formula/check',
    body: 'json',
    rate: perUser(app.limiters.formula),
    handler: async (ctx) => {
      const peeked = ctx.peek();
      const sheetId = isObject(peeked) && typeof peeked.sheet === 'string' ? peeked.sheet : null;
      const access = sheetId === null ? null : await openSheet(app, ctx.user, sheetId);
      const body = ctx.object();
      if (access === null) throw invalid({ sheet: 'Sheet is required.' });
      if (typeof body.formula !== 'string') throw invalid({ formula: 'Formula must be text.' });
      const loaded = await sheetScope(app, access.workbook, access.sheet);
      return json(200, checkFormula(body.formula, loaded.scope, app.config));
    },
  });
}
