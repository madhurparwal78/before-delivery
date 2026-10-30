import { LIMITS, MAX_WORKBOOK_NAME_CHARS } from '../../shared/limits';
import { SEASON_WORDS, SeasonAction, nextSeasonState } from '../../shared/season';
import { roleCan } from '../../shared/roles';
import { query, transaction } from '../db';
import { jsonBody, requireMember, sendJson } from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import { uuid } from '../secrets';
import { withRequestKey } from '../domain/requestKeys';
import { insertOp, loadWorkbookState, touchWorkbook } from '../domain/state';
import { lockWorkbook, resolveCutoff } from '../domain/season';
import {
  WorkbookRow,
  loadWorkbook,
  loadWorkbookForUpdate,
  summaryFor,
  workbookSnapshot,
  workbookSummary,
} from '../domain/workbooks';

const WORKBOOK_COLUMNS = `id, station_id, name, state, closes_at_local, closes_at_utc, original_key,
  head_seq, created_by, created_at, updated_at`;

function validName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > MAX_WORKBOOK_NAME_CHARS) {
    throw apiErrors.validation({ name: 'Give the workbook a name of 1 to 80 characters.' });
  }
  return value.trim();
}

export async function createWorkbookRecord(
  stationId: string,
  memberId: string,
  name: string,
): Promise<WorkbookRow> {
  return transaction(async (client) => {
    const id = uuid();
    const inserted = (
      await client.query(
        `insert into workbooks (id, station_id, name, state, head_seq, created_by)
         values ($1,$2,$3,'draft',0,$4) returning ${WORKBOOK_COLUMNS}`,
        [id, stationId, name, memberId],
      )
    ).rows[0] as WorkbookRow;
    await insertOp(client, id, 1, memberId, {
      opId: `create-${id}`,
      type: 'addSheet',
      sheetId: uuid(),
      name: 'Plots',
    });
    await touchWorkbook(client, id, 1);
    return { ...inserted, head_seq: 1 };
  });
}

export function registerWorkbookRoutes(): void {
  addRoute({
    method: 'GET',
    pattern: '/api/workbooks',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const search = ctx.searchParams.get('q');
      if (search !== null && search.length > LIMITS.maxSearchChars) {
        throw apiErrors.validation({ q: 'Search text can be at most 100 characters.' });
      }
      const rows = await query<WorkbookRow>(
        `select ${WORKBOOK_COLUMNS} from workbooks
         where station_id = $1 and ($2::text is null or name ilike '%' || $2 || '%')
         order by updated_at desc`,
        [member.stationId, search],
      );
      const workbooks = [];
      for (const row of rows) workbooks.push(await summaryFor(row));
      sendJson(ctx.res, 200, { workbooks });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/workbooks',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'createWorkbooks')) throw apiErrors.forbidden();
      const stored = await withRequestKey(
        {
          memberId: member.id,
          endpoint: 'create-workbook',
          key: ctx.req.headers['idempotency-key'] as string | undefined,
          body: ctx.rawBody,
        },
        async () => {
          const name = validName(jsonBody(ctx).name);
          const row = await createWorkbookRecord(member.stationId, member.id, name);
          return { status: 201, text: JSON.stringify({ workbook: workbookSummary(row, 1) }) };
        },
      );
      ctx.res.writeHead(stored.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      ctx.res.end(stored.text);
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/workbooks/:id',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const row = await loadWorkbook(ctx.params.id, member.stationId);
      sendJson(ctx.res, 200, { workbook: await workbookSnapshot(row, member) });
    },
  });

  addRoute({
    method: 'PATCH',
    pattern: '/api/workbooks/:id',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'seasonManage')) throw apiErrors.forbidden();
      const body = jsonBody(ctx);
      const summary = await transaction(async (client) => {
        const row = await loadWorkbookForUpdate(client, ctx.params.id, member.stationId);
        if (row.state === 'archived') throw apiErrors.seasonArchived();
        if (row.state === 'locked') throw apiErrors.seasonLocked();
        let name = row.name;
        if ('name' in body) {
          name = validName(body.name);
          await client.query('update workbooks set name = $2, updated_at = now() where id = $1', [row.id, name]);
        }
        let closesAtLocal = row.closes_at_local;
        let closesAtUtc = row.closes_at_utc;
        if ('closesAt' in body) {
          const cutoff = resolveCutoff(body.closesAt, member.timeZone);
          closesAtLocal = cutoff ? cutoff.local : null;
          closesAtUtc = cutoff ? cutoff.utc : null;
          await client.query(
            'update workbooks set closes_at_local = $2, closes_at_utc = $3, updated_at = now() where id = $1',
            [row.id, closesAtLocal, closesAtUtc],
          );
        }
        const { state } = await loadWorkbookState(row.id, client);
        return workbookSummary(
          { ...row, name, closes_at_local: closesAtLocal, closes_at_utc: closesAtUtc, updated_at: new Date() },
          state.sheets.length,
        );
      });
      sendJson(ctx.res, 200, { workbook: summary });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/season',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const body = jsonBody(ctx);
      const action = body.action;
      if (action !== 'start' && action !== 'close' && action !== 'reopen' && action !== 'archive') {
        throw apiErrors.validation({ action: 'Pick a season action.' });
      }
      const seasonAction = action as SeasonAction;
      if (!roleCan(member.role, seasonAction === 'archive' ? 'archive' : 'seasonManage')) {
        throw apiErrors.forbidden();
      }
      const summary = await transaction(async (client) => {
        const row = await loadWorkbookForUpdate(client, ctx.params.id, member.stationId);
        const target = nextSeasonState(row.state, seasonAction);
        if (!target) throw apiErrors.illegalTransition(seasonAction, SEASON_WORDS[row.state]);
        let closesAtLocal: string | null = row.closes_at_local;
        let closesAtUtc: Date | null = row.closes_at_utc;
        if (seasonAction === 'reopen') {
          const cutoff = resolveCutoff('closesAt' in body ? body.closesAt : null, member.timeZone);
          closesAtLocal = cutoff ? cutoff.local : null;
          closesAtUtc = cutoff ? cutoff.utc : null;
        }
        if (seasonAction === 'close') {
          await lockWorkbook(client, row, Date.now(), member.timeZone);
        } else {
          await client.query(
            'update workbooks set state = $2, closes_at_local = $3, closes_at_utc = $4, updated_at = now() where id = $1',
            [row.id, target, closesAtLocal, closesAtUtc],
          );
        }
        const { state } = await loadWorkbookState(row.id, client);
        return workbookSummary(
          {
            ...row,
            state: target,
            closes_at_local: closesAtLocal,
            closes_at_utc: closesAtUtc,
            updated_at: new Date(),
          },
          state.sheets.length,
        );
      });
      sendJson(ctx.res, 200, { workbook: summary });
    },
  });
}
