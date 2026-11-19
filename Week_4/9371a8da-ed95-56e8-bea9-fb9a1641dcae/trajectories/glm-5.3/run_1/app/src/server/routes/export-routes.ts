import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireMember } from './session-routes.js';
import { ApiError, notReady, notFound, storageUnavailable } from '../errors.js';
import { readJson } from '../validation.js';
import { newId, sha256Hex } from '../ids.js';
import { loadReview } from './review-routes.js';
import { citationReportFor } from './history-routes.js';
import { currentText, type FileRow } from '../domain.js';
import { buildZip } from '../zip.js';

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}

/** The one place where export readiness and its four counts are decided. */
async function readinessFor(svc: RouteCtx['svc'], projectId: string): Promise<{
  openSuggestions: number; openThreads: number; undefinedCitations: number; duplicateKeys: number;
}> {
  const review = await loadReview(svc.sql, projectId, false);
  const report = await citationReportFor(svc, projectId);
  return {
    openSuggestions: review.openSuggestions,
    openThreads: review.threads.filter((t) => t.status === 'open').length,
    undefinedCitations: report.undefined.length,
    duplicateKeys: report.duplicate.length,
  };
}

async function buildProjectZip(
  sql: RouteCtx['svc']['sql'],
  storage: RouteCtx['svc']['storage'],
  projectId: string,
  files: FileRow[],
): Promise<{ data: Buffer; size: number; sha256: string }> {
  const entries: { path: string; data: Buffer }[] = [];
  for (const f of files) {
    if (f.kind === 'text') {
      entries.push({ path: f.path, data: Buffer.from(await currentText(sql, f), 'utf8') });
    } else {
      const object = await storage.get(`projects/${projectId}/assets/${f.id}`);
      entries.push({ path: f.path, data: object ?? Buffer.alloc(0) });
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const zip = buildZip(entries);
  return { data: zip, size: zip.length, sha256: sha256Hex(zip) };
}

export function registerExportRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql, storage } = svc;

  app.post('/api/projects/:pid/exports', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    await readJson(req, []);
    const pid = param(req, 'pid');

    const readiness = await readinessFor(svc, pid);
    const blocked =
      readiness.openSuggestions > 0 || readiness.openThreads > 0 ||
      readiness.undefinedCitations > 0 || readiness.duplicateKeys > 0;
    if (blocked) throw notReady(readiness);

    const prows = await sql<{ revision: number; title: string }>`SELECT revision, title FROM projects WHERE id = ${pid}`;
    const revision = prows[0].revision;
    const projectTitle = prows[0].title;
    const files = await sql<FileRow>`
      SELECT * FROM files WHERE project_id = ${pid} AND deleted_at IS NULL ORDER BY path`;

    // Every current asset object must be present before any export answer.
    for (const f of files) {
      if (f.kind !== 'asset') continue;
      const head = await storage.head(`projects/${pid}/assets/${f.id}`).catch(() => null);
      if (head === null || !head.exists) throw storageUnavailable();
    }

    const existing = await sql<ExportRow>`SELECT * FROM exports WHERE project_id = ${pid} AND revision = ${revision}`;
    if (existing[0]) {
      const zipKey = `projects/${pid}/exports/${existing[0].id}.zip`;
      const head = await storage.head(zipKey).catch(() => null);
      if (head === null) throw storageUnavailable();
      if (head.exists) {
        res.json({ export: exportShape(existing[0], projectTitle) });
        return;
      }
      // Missing zip: rewrite it with the same id and digest.
      const zip = await buildProjectZip(sql, storage, pid, files);
      await storage.put(zipKey, zip.data, 'application/zip').catch(() => { throw storageUnavailable(); });
      res.json({ export: exportShape(existing[0], projectTitle) });
      return;
    }

    // Serialize creation per project revision: one export row, exactly one 201.
    const created = await sql.begin(async (tx) => {
      const again = await tx<ExportRow>`SELECT * FROM exports WHERE project_id = ${pid} AND revision = ${revision} FOR UPDATE`;
      if (again[0]) return { existing: again[0] as { id: string } | null, id: null };
      const id = newId('e');
      await tx`
        INSERT INTO exports (id, project_id, revision, size, sha256)
        VALUES (${id}, ${pid}, ${revision}, 0, '')
        ON CONFLICT (project_id, revision) DO NOTHING`;
      return { existing: null, id };
    });
    if (created.existing) {
      const zipKey = `projects/${pid}/exports/${created.existing.id}.zip`;
      const head = await storage.head(zipKey).catch(() => null);
      if (head === null) throw storageUnavailable();
      if (head.exists) {
        const rows = await sql<ExportRow>`SELECT * FROM exports WHERE id = ${created.existing!.id}`;
        res.json({ export: exportShape(rows[0], projectTitle) });
        return;
      }
      const zip = await buildProjectZip(sql, storage, pid, files);
      await storage.put(zipKey, zip.data, 'application/zip').catch(() => { throw storageUnavailable(); });
      const rows = await sql<ExportRow>`SELECT * FROM exports WHERE id = ${created.existing!.id}`;
      res.json({ export: exportShape(rows[0], projectTitle) });
      return;
    }
    const id = created.id as string;
    const zip = await buildProjectZip(sql, storage, pid, files);
    const zipKey = `projects/${pid}/exports/${id}.zip`;
    await storage.put(zipKey, zip.data, 'application/zip').catch(() => {
      void sql`DELETE FROM exports WHERE id = ${id}`;
      throw storageUnavailable();
    });
    await sql`UPDATE exports SET size = ${zip.size}, sha256 = ${zip.sha256} WHERE id = ${id}`;
    const rows = await sql<ExportRow>`SELECT * FROM exports WHERE id = ${id}`;
    if (!rows[0]) throw notFound();
    res.status(201).json({ export: exportShape(rows[0], projectTitle) });
  }));

  app.get('/api/projects/:pid/exports/:eid/download', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    const pid = param(req, 'pid');
    const eid = param(req, 'eid');
    const rows = await sql<ExportRow>`SELECT * FROM exports WHERE project_id = ${pid} AND id = ${eid}`;
    if (!rows[0]) throw notFound();
    const zip = await storage.get(`projects/${pid}/exports/${eid}.zip`).catch(() => undefined);
    if (zip === undefined || zip === null) throw storageUnavailable();
    const title = (await sql<{ title: string }>`SELECT title FROM projects WHERE id = ${pid}`)[0].title;
    const filename = `${slugify(title)}-r${rows[0].revision}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zip);
  }));
}

interface ExportRow {
  id: string;
  project_id: string;
  revision: number;
  size: number;
  sha256: string;
}

function exportShape(row: ExportRow, projectTitle: string): Record<string, unknown> {
  return {
    id: row.id,
    projectRevision: row.revision,
    size: row.size,
    sha256: row.sha256,
    downloadUrl: `/api/projects/${row.project_id}/exports/${row.id}/download`,
    filename: `${slugify(projectTitle)}-r${row.revision}.zip`,
  };
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
