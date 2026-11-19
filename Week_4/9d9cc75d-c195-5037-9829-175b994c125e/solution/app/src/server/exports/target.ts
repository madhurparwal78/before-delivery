// The sheet or dashboard an export is about: opened for the requesting user (404 when they cannot see it).
import type { QueryRequest } from '../../shared/model.ts';
import { openDashboard } from '../dashboards/index.ts';
import type { App, AuthUser } from '../http/app.ts';
import { openSheet } from '../sheets/store.ts';
import type { ExportDocument } from './document.ts';
import type { ExportTarget } from './jobs.ts';
import { runSheetBlock } from './render.ts';
import type { RanSheet } from './render.ts';

interface OpenTarget {
  /** the sheet's or dashboard's name, which names the downloaded file */
  name: string;
  document(request: QueryRequest): Promise<ExportDocument>;
}

function documentOf(name: string, dashboard: boolean, request: QueryRequest, ran: readonly RanSheet[]): ExportDocument {
  const hidden = new Set(ran.flatMap((sheet) => [...sheet.hidden]));
  return {
    name,
    dashboard,
    filters: request.filters.filter((filter) => !hidden.has(filter.field)),
    parameters: Object.assign({}, ...ran.map((sheet) => sheet.parameters)),
    blocks: ran.map((sheet) => sheet.block),
  };
}

export async function openTarget(app: App, user: AuthUser, target: ExportTarget): Promise<OpenTarget> {
  if ('sheet' in target) {
    const access = await openSheet(app, user, target.sheet);
    const name = access.sheet.shape.name;
    return { name, document: async (request) => documentOf(name, false, request, [await runSheetBlock(app, user, access, request, null)]) };
  }
  const { dashboard } = await openDashboard(app, user, target.dashboard);
  return {
    name: dashboard.name,
    document: async (request) => {
      const ran: RanSheet[] = [];
      for (const object of dashboard.objects) {
        const frame = { x: object.x, y: object.y, width: object.w, height: object.h };
        ran.push(await runSheetBlock(app, user, await openSheet(app, user, object.sheet), request, frame));
      }
      return documentOf(dashboard.name, true, request, ran);
    },
  };
}
