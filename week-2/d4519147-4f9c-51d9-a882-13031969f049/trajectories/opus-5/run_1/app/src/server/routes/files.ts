import { errors } from '../http/errors';
import { contentDisposition } from '../http/headers';
import type { AuthedCtx, Params, Reply, Route } from '../http/router';
import { isUuid, requireAccess, requireRole } from '../domain/access';
import {
  createExport,
  exportObjectKey,
  listExports,
  loadExport,
  readIdempotencyKey,
  readPageIds,
} from '../domain/exports';
import { createImport, listImports, loadImport } from '../domain/imports';
import { exportFileName, issueDownloadLink, resolveDownload } from '../domain/downloads';

async function postImport(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  requireRole(access, 'editor');
  if (!ctx.file) throw errors.validation({ file: 'missing' });
  const record = await createImport(ctx.session.user, access, {
    fileName: ctx.file.fileName,
    bytes: ctx.file.bytes,
  });
  return { status: 201, body: { import: record } };
}

async function getImports(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  return { status: 200, body: { imports: await listImports(access.diagramId) } };
}

async function getOriginal(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  const importId = params.importId ?? '';
  if (!isUuid(importId)) throw errors.notFound();
  const record = await loadImport(access.diagramId, importId);
  if (!record) throw errors.notFound();
  const token = await issueDownloadLink(ctx.session.user.id, access.diagramId, {
    objectKey: record.objectKey,
    fileName: record.fileName,
    contentType: 'application/octet-stream',
    sha256: record.sha256,
  });
  return { status: 303, redirect: `/api/downloads/${token}` };
}

async function postExport(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  requireRole(access, 'editor');
  const pageIds = readPageIds(ctx.json);
  const key = readIdempotencyKey(ctx.req.headers['idempotency-key']);
  const result = await createExport(ctx.session.user, access, pageIds, key);
  return {
    status: 201,
    body: { export: result.record },
    headers: result.replayed ? { 'Idempotent-Replayed': 'true' } : undefined,
  };
}

async function getExports(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  return { status: 200, body: { exports: await listExports(access.diagramId) } };
}

const FORMATS = new Set(['png', 'svg', 'json']);
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  json: 'application/json',
};

async function getExportFile(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  const exportId = params.exportId ?? '';
  const format = params.format ?? '';
  if (!isUuid(exportId)) throw errors.notFound();
  const record = await loadExport(access.diagramId, exportId);
  if (!record) throw errors.notFound();
  if (!FORMATS.has(format)) throw errors.notFound();
  if (record.status !== 'ready') throw errors.conflict('export_not_ready', 'That export is not ready.');
  const kind = format as 'png' | 'svg' | 'json';
  const file = record.files.find((entry) => entry.format === kind);
  const token = await issueDownloadLink(ctx.session.user.id, access.diagramId, {
    objectKey: exportObjectKey(access.diagramId, record.id, kind),
    fileName: exportFileName(access.title, new Date(record.createdAt), kind),
    contentType: CONTENT_TYPES[kind] ?? 'application/octet-stream',
    sha256: file?.sha256 ?? null,
  });
  return { status: 303, redirect: `/api/downloads/${token}` };
}

async function getDownload(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const resolved = await resolveDownload(params.token ?? '', ctx.session.user);
  const headers: Record<string, string> = {
    'Content-Disposition': contentDisposition(resolved.target.fileName),
  };
  if (resolved.target.contentType === 'application/octet-stream' && resolved.target.sha256) {
    headers['X-Content-SHA256'] = resolved.target.sha256;
  }
  return {
    status: 200,
    file: {
      bytes: resolved.bytes,
      contentType: resolved.target.contentType,
      fileName: resolved.target.fileName,
    },
    headers,
  };
}

export const fileRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/diagrams/:id/imports',
    auth: true,
    body: 'multipart',
    handler: postImport,
  },
  { method: 'GET', pattern: '/api/diagrams/:id/imports', auth: true, handler: getImports },
  {
    method: 'GET',
    pattern: '/api/diagrams/:id/imports/:importId/original',
    auth: true,
    handler: getOriginal,
  },
  { method: 'POST', pattern: '/api/diagrams/:id/exports', auth: true, body: 'json', handler: postExport },
  { method: 'GET', pattern: '/api/diagrams/:id/exports', auth: true, handler: getExports },
  {
    method: 'GET',
    pattern: '/api/diagrams/:id/exports/:exportId/files/:format',
    auth: true,
    handler: getExportFile,
  },
  { method: 'GET', pattern: '/api/downloads/:token', auth: true, handler: getDownload },
];
