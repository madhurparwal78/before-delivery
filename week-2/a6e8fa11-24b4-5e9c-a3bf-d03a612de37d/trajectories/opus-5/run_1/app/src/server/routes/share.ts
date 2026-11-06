import { ShareLinkDto, ShareViewDto } from '../../shared/api';
import { MAX_SHARE_SECONDS, MIN_SHARE_SECONDS } from '../../shared/limits';
import { roleCan } from '../../shared/roles';
import { query, queryOne } from '../db';
import { jsonBody, requireMember, sendEmpty, sendJson } from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import { shareToken, uuid } from '../secrets';
import { chartDtos, loadWorkbook, sheetDtos } from '../domain/workbooks';
import { evaluate, loadWorkbookState } from '../domain/state';
import { SeasonState } from '../../shared/workbook';

interface ShareLinkRow {
  id: string;
  workbook_id: string;
  token: string;
  lifetime_seconds: number;
  expires_at: Date;
  status: 'active' | 'expired' | 'revoked';
}

function linkDto(row: ShareLinkRow): ShareLinkDto {
  const expired = row.status === 'active' && Date.now() >= row.expires_at.getTime();
  return {
    id: row.id,
    url: `/s/${row.token}`,
    expiresAt: row.expires_at.toISOString(),
    status: expired ? 'expired' : row.status,
  };
}

async function createLink(workbookId: string, lifetimeSeconds: number): Promise<ShareLinkRow> {
  const row = await queryOne<ShareLinkRow>(
    `insert into share_links (id, workbook_id, token, lifetime_seconds, expires_at, status)
     values ($1,$2,$3,$4::int, now() + ($4::int * interval '1 second'), 'active') returning *`,
    [uuid(), workbookId, shareToken(), lifetimeSeconds],
  );
  return row as ShareLinkRow;
}

export function registerShareRoutes(): void {
  addRoute({
    method: 'GET',
    pattern: '/api/workbooks/:id/share-links',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'shareLinks')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const rows = await query<ShareLinkRow>(
        'select * from share_links where workbook_id = $1 order by created_at desc',
        [workbook.id],
      );
      sendJson(ctx.res, 200, { links: rows.map(linkDto) });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/share-links',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'shareLinks')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const seconds = jsonBody(ctx).expiresInSeconds;
      if (
        typeof seconds !== 'number' ||
        !Number.isInteger(seconds) ||
        seconds < MIN_SHARE_SECONDS ||
        seconds > MAX_SHARE_SECONDS
      ) {
        throw apiErrors.validation({ expiresInSeconds: 'Pick how long the link should last.' });
      }
      sendJson(ctx.res, 201, { link: linkDto(await createLink(workbook.id, seconds)) });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/share-links/:linkId/regenerate',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'shareLinks')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const existing = await queryOne<ShareLinkRow>(
        'select * from share_links where id = $1 and workbook_id = $2',
        [ctx.params.linkId, workbook.id],
      );
      if (!existing) throw apiErrors.notFound();
      if (linkDto(existing).status !== 'active') throw apiErrors.linkInactive();
      await query("update share_links set status = 'revoked' where id = $1", [existing.id]);
      sendJson(ctx.res, 201, { link: linkDto(await createLink(workbook.id, existing.lifetime_seconds)) });
    },
  });

  addRoute({
    method: 'DELETE',
    pattern: '/api/workbooks/:id/share-links/:linkId',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'shareLinks')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const existing = await queryOne<ShareLinkRow>(
        'select * from share_links where id = $1 and workbook_id = $2',
        [ctx.params.linkId, workbook.id],
      );
      if (!existing) throw apiErrors.notFound();
      await query("update share_links set status = 'revoked' where id = $1", [existing.id]);
      sendEmpty(ctx.res, 204);
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/share/:token',
    auth: false,
    handler: async (ctx) => {
      const link = await queryOne<{
        workbook_id: string;
        expires_at: Date;
        status: string;
        name: string;
        state: SeasonState;
        station_name: string;
        time_zone: string;
      }>(
        `select l.workbook_id, l.expires_at, l.status, w.name, w.state, s.name as station_name, s.time_zone
         from share_links l join workbooks w on w.id = l.workbook_id join stations s on s.id = w.station_id
         where l.token = $1`,
        [ctx.params.token],
      );
      if (!link || link.status !== 'active' || Date.now() >= link.expires_at.getTime()) throw apiErrors.notFound();
      const { state } = await loadWorkbookState(link.workbook_id);
      const evaluation = evaluate(state, link.time_zone);
      const sheets = sheetDtos(state, evaluation).map((sheet) => ({
        name: sheet.name,
        position: sheet.position,
        cells: Object.fromEntries(
          Object.entries(sheet.cells).map(([ref, cell]) => {
            const { input, ...rest } = cell;
            void input;
            return [ref, rest];
          }),
        ),
      }));
      const charts = chartDtos(state, evaluation).map((chart) => {
        const sheet = state.sheets.find((candidate) => candidate.id === chart.sheetId);
        return {
          sheetName: sheet ? sheet.name : '',
          type: chart.type,
          title: chart.title,
          categories: chart.categories,
          series: chart.series,
        };
      });
      const payload: ShareViewDto = {
        workbook: {
          name: link.name,
          stationName: link.station_name,
          state: link.state,
          expiresAt: link.expires_at.toISOString(),
          sheets,
          charts,
        },
      };
      sendJson(ctx.res, 200, payload, { 'Cache-Control': 'no-store' });
    },
  });
}
