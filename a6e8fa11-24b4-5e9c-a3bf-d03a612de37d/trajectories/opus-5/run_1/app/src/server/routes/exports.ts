import { roleCan } from '../../shared/roles';
import { query, queryOne } from '../db';
import { jsonBody, requireMember, sendJson } from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import { uuid } from '../secrets';
import { ExportRow, exportDto, exportFileName } from '../domain/exports';
import { processPendingExports } from '../domain/exports';
import { loadWorkbookState } from '../domain/state';
import { loadWorkbook } from '../domain/workbooks';
import { getObject } from '../services/storage';

export function registerExportRoutes(): void {
  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/exports',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'exports')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const body = jsonBody(ctx);
      const format = body.format;
      if (format !== 'xlsx' && format !== 'csv') {
        throw apiErrors.validation({ format: 'Pick xlsx or csv.' });
      }
      const { state, headSeq } = await loadWorkbookState(workbook.id);
      let sheetId: string | null = null;
      let sheetName: string | null = null;
      if (format === 'csv') {
        const sheet = state.sheets.find((candidate) => candidate.id === body.sheetId);
        if (!sheet) throw apiErrors.validation({ sheetId: 'Pick a sheet of this workbook.' });
        sheetId = sheet.id;
        sheetName = sheet.name;
      }
      const id = uuid();
      const fileName = exportFileName(workbook.name, sheetName, format);
      const row = await queryOne<ExportRow>(
        `insert into exports (id, workbook_id, member_id, format, sheet_id, file_name, status, seq, origin)
         values ($1,$2,$3,$4,$5,$6,'pending',$7,$8) returning *`,
        [id, workbook.id, member.id, format, sheetId, fileName, headSeq, ctx.origin],
      );
      void processPendingExports();
      sendJson(ctx.res, 202, { export: exportDto(row as ExportRow) });
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/workbooks/:id/exports',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'exports')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const rows = await query<ExportRow>(
        'select * from exports where workbook_id = $1 order by created_at desc limit 20',
        [workbook.id],
      );
      sendJson(ctx.res, 200, { exports: rows.map(exportDto) });
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/exports/:exportId/download',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'exports')) throw apiErrors.forbidden();
      const row = await queryOne<ExportRow>(
        `select e.* from exports e join workbooks w on w.id = e.workbook_id
         where e.id = $1 and w.station_id = $2`,
        [ctx.params.exportId, member.stationId],
      );
      if (!row) throw apiErrors.notFound();
      if (row.status !== 'ready' || !row.object_key) throw apiErrors.exportNotReady();
      const body = await getObject(row.object_key);
      ctx.res.writeHead(200, {
        'Content-Type':
          row.format === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': body.length,
        'Content-Disposition': `attachment; filename="${row.file_name}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      ctx.res.end(body);
    },
  });
}
