import { MAX_VERSION_LABEL_CHARS } from '../../shared/limits';
import { roleCan } from '../../shared/roles';
import { query, transaction } from '../db';
import { jsonBody, requireMember, sendJson } from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import {
  VERSION_SQL,
  VersionRow,
  discardStoredVersions,
  restoreVersion,
  saveVersion,
  versionDto,
} from '../domain/versions';
import { loadWorkbook, loadWorkbookForUpdate } from '../domain/workbooks';

export function registerVersionRoutes(): void {
  addRoute({
    method: 'GET',
    pattern: '/api/workbooks/:id/versions',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'versions')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const rows = await query<VersionRow>(`${VERSION_SQL} where v.workbook_id = $1 order by v.number desc`, [
        workbook.id,
      ]);
      sendJson(ctx.res, 200, { versions: rows.map(versionDto) });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/versions',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'versions')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const label = jsonBody(ctx).label;
      if (typeof label !== 'string' || label.trim().length < 1 || label.trim().length > MAX_VERSION_LABEL_CHARS) {
        throw apiErrors.validation({ label: 'Give the version a label of 1 to 60 characters.' });
      }
      const storedKeys: string[] = [];
      try {
        const version = await transaction(async (client) => {
          const row = await loadWorkbookForUpdate(client, workbook.id, member.stationId);
          return saveVersion(client, row, member, label.trim(), storedKeys);
        });
        sendJson(ctx.res, 201, { version });
      } catch (failure) {
        await discardStoredVersions(storedKeys);
        throw failure;
      }
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/versions/:versionId/restore',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'restoreVersion')) throw apiErrors.forbidden();
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const storedKeys: string[] = [];
      try {
        const outcome = await transaction(async (client) => {
          const row = await loadWorkbookForUpdate(client, workbook.id, member.stationId);
          if (row.state === 'archived') throw apiErrors.seasonArchived();
          if (row.state === 'locked') throw apiErrors.seasonLocked();
          return restoreVersion(client, row, member, ctx.params.versionId, storedKeys);
        });
        sendJson(ctx.res, 201, outcome);
      } catch (failure) {
        await discardStoredVersions(storedKeys);
        throw failure;
      }
    },
  });
}
