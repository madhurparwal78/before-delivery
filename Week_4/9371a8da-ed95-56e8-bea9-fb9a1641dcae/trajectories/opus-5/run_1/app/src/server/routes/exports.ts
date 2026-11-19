import { one, query, transaction } from '../db.js';
import { exportReadiness, isReady } from '../domain/citationReport.js';
import { newId, sha256Hex } from '../domain/ids.js';
import { ExportShape, FileRow } from '../domain/shapes.js';
import { allowedKeys } from '../domain/validation.js';
import { buildZip, exportFilename, ZipEntry } from '../domain/zip.js';
import { assetObjectKey, exportObjectKey, storage } from '../infra/storage.js';
import { Ctx, Reply, requireProject } from '../http/context.js';
import { ApiError, notFound } from '../http/errors.js';
import { Route } from '../http/router.js';

interface ExportRow {
  id: string;
  project_id: string;
  project_revision: number;
  size: number;
  sha256: string;
  object_key: string;
  filename: string;
}

function exportShape(row: ExportRow): ExportShape {
  return {
    id: row.id,
    projectRevision: row.project_revision,
    size: row.size,
    sha256: row.sha256,
    downloadUrl: `/api/projects/${row.project_id}/exports/${row.id}/download`,
    filename: row.filename,
  };
}

async function zipEntriesOf(projectId: string): Promise<ZipEntry[]> {
  const files = await query<FileRow>(
    `select * from files where project_id = $1 and deleted = false order by path`,
    [projectId],
  );
  const entries: ZipEntry[] = [];
  for (const file of files) {
    if (file.kind === 'text') {
      entries.push({ path: file.path, bytes: Buffer.from(file.content ?? '', 'utf8') });
      continue;
    }
    const bytes = await storage.get(assetObjectKey(projectId, file.id));
    if (bytes === null) throw new ApiError(503, 'storage_unavailable');
    entries.push({ path: file.path, bytes });
  }
  return entries;
}

/** Every export first confirms that each current asset's object is present. */
async function confirmAssets(projectId: string): Promise<void> {
  const assets = await query<{ id: string }>(
    `select id from files where project_id = $1 and deleted = false and kind = 'asset'`,
    [projectId],
  );
  for (const asset of assets) {
    const head = await storage.head(assetObjectKey(projectId, asset.id));
    if (head === null) throw new ApiError(503, 'storage_unavailable');
  }
}

async function createExport(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'export');
  allowedKeys(ctx.body, []);
  const projectRevision = access.project.project_revision;
  const readiness = await exportReadiness(access.project.id, projectRevision);
  if (!isReady(readiness)) {
    throw new ApiError(409, 'not_ready', { readiness });
  }

  await confirmAssets(access.project.id);

  const existing = await one<ExportRow>(
    `select * from exports where project_id = $1 and project_revision = $2`,
    [access.project.id, projectRevision],
  );
  if (existing !== null) {
    const head = await storage.head(existing.object_key);
    if (head !== null && head.size === existing.size) {
      return { status: 200, body: { export: exportShape(existing) } };
    }
    const bytes = buildZip(await zipEntriesOf(access.project.id));
    await storage.put(existing.object_key, bytes, 'application/zip');
    return { status: 200, body: { export: exportShape(existing) } };
  }

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const current = await tx.one<ExportRow>(
      `select * from exports where project_id = $1 and project_revision = $2`,
      [access.project.id, projectRevision],
    );
    if (current !== null) {
      return { status: 200, body: { export: exportShape(current) } };
    }
    const exportId = newId('x');
    const objectKey = exportObjectKey(access.project.id, exportId);
    const bytes = buildZip(await zipEntriesOf(access.project.id));
    await storage.put(objectKey, bytes, 'application/zip');
    const row = (await tx.one<ExportRow>(
      `insert into exports
         (id, project_id, project_revision, size, sha256, object_key, filename)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [
        exportId,
        access.project.id,
        projectRevision,
        bytes.length,
        sha256Hex(bytes),
        objectKey,
        exportFilename(access.project.title, projectRevision),
      ],
    )) as ExportRow;
    return { status: 201, body: { export: exportShape(row) } };
  });
}

async function downloadExport(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'export');
  const row = await one<ExportRow>(
    `select * from exports where project_id = $1 and id = $2`,
    [access.project.id, ctx.params.eid],
  );
  if (row === null) throw notFound();
  const bytes = await storage.get(row.object_key);
  if (bytes === null) throw new ApiError(503, 'storage_unavailable');
  return {
    status: 200,
    bytes,
    contentType: 'application/zip',
    headers: { 'Content-Disposition': `attachment; filename="${row.filename}"` },
  };
}

export const exportRoutes: Route[] = [
  { method: 'POST', path: '/api/projects/:pid/exports', keys: [], handler: createExport },
  {
    method: 'GET',
    path: '/api/projects/:pid/exports/:eid/download',
    keys: [],
    handler: downloadExport,
  },
];
