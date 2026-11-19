// Exports: rendered, stored in MinIO, listed and downloaded through the app.
import * as q from "../store/queries.js";
import { sendJson } from "./plumbing.js";
import { ApiError, invalidField, notFound } from "./errors.js";
import { requireSession, asRecord } from "./routes.js";
import { readProject } from "../services/projects.js";
import { renderCsv } from "../exports/csv.js";
import { renderPdf } from "../exports/pdf.js";
export async function createExport(deps, ctx, projectId) {
    requireSession(ctx);
    const { project } = await deps.requireProject(ctx, projectId);
    const record = asRecord(ctx.body);
    const format = record.format;
    if (format !== 'csv' && format !== 'pdf')
        throw invalidField('format');
    const snapshot = await readProject(deps.pool, project.id, deps.today());
    if (snapshot === null)
        throw notFound();
    const bytes = format === 'csv' ? new TextEncoder().encode(renderCsv(snapshot.project)) : renderPdf(snapshot.project);
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf';
    const filename = `${slug(snapshot.project.name)}-${deps.today()}.${format}`;
    const exportRow = await q.insertExport(deps.pool, { projectId: project.id, format, filename });
    const key = `exports/${project.id}/${exportRow.id}/${filename}`;
    try {
        await deps.storage.put(key, bytes, contentType);
        await deps.storage.head(key);
    }
    catch {
        await deps.pool.query('delete from exports where id = $1', [exportRow.id]);
        throw new ApiError(503, 'storage_unavailable');
    }
    await q.markExportStored(deps.pool, exportRow.id);
    await deps.afterExport(project.id);
    sendJson(ctx.res, 201, { id: exportRow.id, format, filename, downloadUrl: `/api/exports/${exportRow.id}/download` });
}
export async function listExports(deps, ctx, projectId) {
    requireSession(ctx);
    await deps.requireProject(ctx, projectId);
    const rows = await q.storedExports(deps.pool, projectId);
    sendJson(ctx.res, 200, {
        exports: rows.map((row) => ({
            id: row.id,
            format: row.format,
            filename: row.filename,
            downloadUrl: `/api/exports/${row.id}/download`,
            createdAt: (row.storedAt ?? row.createdAt).toISOString(),
        })),
    });
}
export async function downloadExport(deps, ctx, exportId) {
    requireSession(ctx);
    const row = await q.exportById(deps.pool, exportId);
    if (row === null || row.storedAt === null)
        throw notFound();
    await deps.requireProject(ctx, row.projectId);
    const key = `exports/${row.projectId}/${row.id}/${row.filename}`;
    let stream;
    try {
        stream = await deps.storage.get(key);
    }
    catch {
        throw new ApiError(503, 'storage_unavailable');
    }
    if (stream === null)
        throw notFound();
    const contentType = row.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf';
    ctx.res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${row.filename}"`,
        'Cache-Control': 'no-store',
    });
    for await (const chunk of stream)
        ctx.res.write(chunk);
    ctx.res.end();
}
function slug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
