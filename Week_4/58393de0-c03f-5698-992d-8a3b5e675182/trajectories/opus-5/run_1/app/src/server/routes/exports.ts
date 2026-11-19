import { UI_COPY, FIELD_COPY } from '../../shared/copy.js';
import { emailUnverified, notFound, storageUnavailable, validation } from '../errors.js';
import { query } from '../db.js';
import { requireAccount, type Caller } from '../sessions.js';
import { sendJson, type RequestContext } from '../http.js';
import { getObject } from '../storage.js';
import {
  EXPORT_COLUMNS,
  contentTypeFor,
  exportView,
  inspectExportFile,
  loadExport,
  parseExportQuery,
  storeExport,
  type ExportRow,
} from '../exports.js';
import { educatorRoleIn } from '../classrooms.js';
import { loadProject } from '../projects.js';
import type { AccountRow } from '../accounts.js';
import { findAccount } from '../accounts.js';

export const listExports = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  const account = requireAccount(caller);
  const rows = await query<ExportRow>(
    `select ${EXPORT_COLUMNS} from exports where owner_id = $1 order by created_at desc`,
    [account.id],
  );
  sendJson(ctx, 200, { exports: rows.map(exportView) });
};

export const postExport = async (ctx: RequestContext, caller: Caller, raw: Buffer): Promise<void> => {
  const account = requireAccount(caller);
  const projectIdParam = ctx.url.searchParams.get('projectId');
  let projectKind: string | null = null;
  if (projectIdParam !== null) {
    const project = await loadProject(projectIdParam);
    if (!project || project.owner_id !== account.id) throw notFound();
    projectKind = project.kind;
  }
  if (!account.email_verified) throw emailUnverified(UI_COPY.verifyToExport);
  const parsed = parseExportQuery(ctx.url.searchParams);
  if (projectKind === 'circuit' && (parsed.format !== 'svg' || parsed.unit !== 'mm')) {
    throw validation({ format: FIELD_COPY.name });
  }
  const facts = inspectExportFile(raw, parsed.format);
  const stored = await storeExport({
    ownerId: account.id,
    projectId: projectIdParam,
    fileName: parsed.name,
    format: parsed.format,
    unit: parsed.unit,
    body: raw,
    facts: projectKind === 'circuit' ? { triangleCount: null, bbox: null } : facts,
  });
  sendJson(ctx, 201, exportView(stored));
};

const maySeeExport = async (account: AccountRow, row: ExportRow): Promise<boolean> => {
  if (row.owner_id === account.id) return true;
  if (account.kind !== 'educator') return false;
  const owner = await findAccount(row.owner_id);
  if (!owner || owner.kind !== 'student' || !owner.classroom_id) return false;
  return (await educatorRoleIn(owner.classroom_id, account.id)) !== null;
};

export const downloadExport = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const account = requireAccount(caller);
  const row = await loadExport(params.id);
  if (!row || !(await maySeeExport(account, row))) throw notFound();
  const object = await getObject(row.object_key);
  if (!object) throw storageUnavailable();
  ctx.res.writeHead(200, {
    'content-type': contentTypeFor(row.format),
    'content-length': object.length,
    'content-disposition': `attachment; filename="${row.file_name}"`,
    'cache-control': 'no-store',
  });
  ctx.res.end(object);
};
