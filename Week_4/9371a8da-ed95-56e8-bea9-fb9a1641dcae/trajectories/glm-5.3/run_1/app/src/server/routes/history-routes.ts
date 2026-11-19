import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireMember, person } from './session-routes.js';
import { ApiError, labelTaken, notFound, invalid } from '../errors.js';
import { readJson, hasUnstorable } from '../validation.js';
import { json, type Queryable } from '../db.js';
import { newId, sha256Hex } from '../ids.js';
import { appendLedger, currentText, spanOfChange, applyAnchorRules, recordProjectRevision, type FileRow } from '../domain.js';
import { scanCitations } from '../citations.js';
import type { CitationReport } from '../../shared/types.js';

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}


export function registerHistoryRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql, storage, config } = svc;

  app.get('/api/projects/:pid/history', wrap(async (req, res) => {
    await requireMember(svc, req, param(req, "pid"));
    const rows = await sql<{
      revision: number; kind: string; summary: string; actor_id: string; actor_name: string; actor_handle: string;
      at: Date; labels: string[] | null;
    }>`
      SELECT e.*, array_agg(l.name) FILTER (WHERE l.name IS NOT NULL) AS labels
      FROM ledger_entries e
      LEFT JOIN labels l ON l.project_id = e.project_id AND l.revision = e.revision
      WHERE e.project_id = ${param(req, "pid")}
      GROUP BY e.project_id, e.revision, e.kind, e.summary, e.actor_id, e.actor_name, e.actor_handle, e.at
      ORDER BY e.revision DESC`;
    const sorted = [...rows].sort((a, b) => b.revision - a.revision);
    res.json({ entries: sorted.map((r) => ({
      projectRevision: r.revision,
      kind: r.kind,
      summary: r.summary,
      actor: { id: r.actor_id, displayName: r.actor_name, handle: r.actor_handle },
      at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
      labels: (r.labels ?? []) as string[],
    })) });
  }));

  app.get('/api/projects/:pid/labels', wrap(async (req, res) => {
    await requireMember(svc, req, param(req, "pid"));
    const rows = await sql`
      SELECT * FROM labels WHERE project_id = ${param(req, "pid")} ORDER BY created_at DESC, id`;
    res.json({ labels: rows.map((r) => ({
      id: r.id, name: r.name, projectRevision: r.revision,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      createdBy: { id: r.created_by_id, displayName: r.created_by_name, handle: r.created_by_handle },
    })) });
  }));

  app.post('/api/projects/:pid/labels', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['name', 'projectRevision']);
    const name = typeof body.name === 'string' ? body.name : '';
    const errors: Record<string, string> = {};
    if (name.trim().length < 1 || name.length > 60 || hasUnstorable(name)) errors.name = 'length';
    if (body.projectRevision !== undefined && (typeof body.projectRevision !== 'number' || !Number.isInteger(body.projectRevision))) {
      errors.projectRevision = 'required';
    }
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const target = typeof body.projectRevision === 'number' ? body.projectRevision : null;
    const label = await sql.begin(async (tx) => {
      const prows = await tx`SELECT revision FROM projects WHERE id = ${param(req, "pid")} FOR UPDATE`;
      const projectRevision = target ?? prows[0].revision;
      const exists = await tx`
        SELECT 1 FROM project_revisions WHERE project_id = ${param(req, "pid")} AND revision = ${projectRevision}`;
      if (exists.length === 0) throw notFound();
      const taken = await tx`
        SELECT 1 FROM labels WHERE project_id = ${param(req, "pid")} AND name_lower = ${name.toLowerCase()}`;
      if (taken.length > 0) throw labelTaken();
      const id = newId('l');
      await tx`
        INSERT INTO labels (id, project_id, name, name_lower, revision, created_by_id, created_by_name, created_by_handle)
        VALUES (${id}, ${param(req, "pid")}, ${name}, ${name.toLowerCase()}, ${projectRevision}, ${user.id}, ${user.displayName}, ${user.handle})`;
      return { id, projectRevision };
    });
    const rows = await sql`SELECT * FROM labels WHERE id = ${label.id}`;
    const r = rows[0];
    res.status(201).json({ label: {
      id: r.id, name: r.name, projectRevision: r.revision,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      createdBy: { id: r.created_by_id, displayName: r.created_by_name, handle: r.created_by_handle },
    }});
  }));

  app.all('/api/projects/:pid/labels/:lid', wrap(async (req, res) => {
    await requireMember(svc, req, param(req, "pid"));
    res.status(405).json({ error: 'method_not_allowed' });
  }));

  // ---- Restore ----
  app.post('/api/projects/:pid/labels/:lid/restore', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    await readJson(req, []);
    const result = await sql.begin(async (tx) => {
      const lrows = await tx<{ id: string; name: string; revision: number }>`SELECT * FROM labels WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "lid")} FOR UPDATE`;
      if (!lrows[0]) throw notFound();
      const label = lrows[0];
      const target = await tx<{ file_id: string; path: string; kind: string; size: number; sha256: string }>`
        SELECT * FROM project_revisions WHERE project_id = ${param(req, "pid")} AND revision = ${label.revision}`;
      if (target.length === 0) throw notFound();
      const targetByPath = new Map(target.map((t) => [t.path, t]));
      const current = await tx<FileRow>`
        SELECT * FROM files WHERE project_id = ${param(req, "pid")} AND deleted_at IS NULL`;
      const currentPaths = new Set(current.map((c) => c.path));
      const changed: { path: string; oldText: string | null }[] = [];

      // Remove files added since the label.
      for (const c of current) {
        if (!targetByPath.has(c.path)) {
          await tx`UPDATE files SET deleted_at = now() WHERE id = ${c.id}`;
          await tx`
            UPDATE suggestions SET status = 'orphaned', from_pos = NULL, to_pos = NULL, orphaned_at = now()
            WHERE file_id = ${c.id} AND status = 'open'`;
          await tx`
            UPDATE threads SET orphaned = true, from_pos = NULL, to_pos = NULL, orphaned_at = now()
            WHERE file_id = ${c.id} AND orphaned = false`;
        }
      }
      // Bring back or update files in the target set.
      for (const t of target) {
        const existing: FileRow | undefined = current.find((c) => c.path === t.path);
        if (existing && existing.id === t.file_id) {
          const oldText = await currentText(tx, existing);
          const newText = await textOfRevision(tx, t.file_id, t.sha256);
          if (oldText !== newText) {
            const span = spanOfChange(oldText, newText);
            const buf = Buffer.from(newText, 'utf8');
            const nextRev = existing.revision + 1;
            await tx`
              INSERT INTO file_versions (file_id, revision, content, sha256)
              VALUES (${t.file_id}, ${nextRev}, ${buf}, ${sha256Hex(buf)})
              ON CONFLICT (file_id, revision) DO UPDATE SET content = ${buf}, sha256 = ${sha256Hex(buf)}`;
            await tx`UPDATE files SET revision = ${nextRev}, size = ${buf.length} WHERE id = ${t.file_id}`;
            await applyAnchorRules(tx, param(req, "pid"), { ...existing, revision: nextRev }, span);
            changed.push({ path: t.path, oldText });
          }
          continue;
        }
        if (existing && existing.id !== t.file_id) {
          // A different file currently sits at that path: remove it.
          await tx`UPDATE files SET deleted_at = now() WHERE id = ${existing.id}`;
          await tx`
            UPDATE suggestions SET status = 'orphaned', from_pos = NULL, to_pos = NULL, orphaned_at = now()
            WHERE file_id = ${existing.id} AND status = 'open'`;
          await tx`
            UPDATE threads SET orphaned = true, from_pos = NULL, to_pos = NULL, orphaned_at = now()
            WHERE file_id = ${existing.id} AND orphaned = false`;
        }
        // Restore the target file: it may be deleted or missing.
        const targetFile = await tx<FileRow>`SELECT * FROM files WHERE id = ${t.file_id}`;
        if (targetFile[0]) {
          await tx`
            UPDATE files SET deleted_at = NULL, path = ${t.path} WHERE id = ${t.file_id}`;
        } else {
          const buf = await textOfRevisionRaw(tx, t.file_id, t.sha256);
          await tx`
            INSERT INTO files (id, project_id, path, kind, revision, size, content_type, sha256)
            VALUES (${t.file_id}, ${param(req, "pid")}, ${t.path}, ${t.kind}, 1, ${buf.length},
              ${t.kind === 'text' ? 'text/plain' : 'application/octet-stream'}, ${t.sha256})`;
          await tx`
            INSERT INTO file_versions (file_id, revision, content, sha256)
            VALUES (${t.file_id}, 1, ${buf}, ${t.sha256})`;
        }
      }
      const revision = await appendLedger(tx, param(req, "pid"), 'restore', `Restored label ${label.name}`, person(user));
      await recordProjectRevision(tx, param(req, "pid"), revision, target.map((t) => ({
        id: t.file_id, path: t.path, kind: t.kind, size: t.size, sha256: t.sha256,
      })));
      return { revision, label, target };
    });
    const rows = await sql<{ revision: number; kind: string; summary: string; actor_id: string; actor_name: string; actor_handle: string; at: Date }>`
      SELECT e.* FROM ledger_entries e WHERE e.project_id = ${param(req, "pid")} AND e.revision = ${result.revision}`;
    const r = rows[0];
    res.status(201).json({
      projectRevision: result.revision,
      entry: {
        projectRevision: r.revision,
        kind: r.kind,
        summary: r.summary,
        actor: { id: r.actor_id, displayName: r.actor_name, handle: r.actor_handle },
        at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
        labels: [],
      },
    });
    void storage; void config;
  }));

  // ---- Citations ----
  app.get('/api/projects/:pid/citations', wrap(async (req, res) => {
    await requireMember(svc, req, param(req, "pid"));
    const report = await citationReportFor(svc, param(req, "pid"));
    res.json(report);
  }));
}

async function textOfRevision(sql: Queryable, fileId: string, sha: string): Promise<string> {
  const rows = await sql<{ content: Buffer }>`
    SELECT content, revision FROM file_versions WHERE file_id = ${fileId} AND sha256 = ${sha}
    ORDER BY revision DESC LIMIT 1`;
  if (rows[0]) return rows[0].content.toString('utf8');
  return '';
}

async function textOfRevisionRaw(sql: Queryable, fileId: string, sha: string): Promise<Buffer> {
  const rows = await sql<{ content: Buffer }>`
    SELECT content, revision FROM file_versions WHERE file_id = ${fileId} AND sha256 = ${sha}
    ORDER BY revision DESC LIMIT 1`;
  if (rows[0]) return rows[0].content;
  return Buffer.alloc(0);
}

/** The one place where the citation report is computed and stored per revision. */
export async function citationReportFor(svc: RouteCtx['svc'], projectId: string): Promise<CitationReport> {
  const { sql } = svc;
  const prows = await sql<{ revision: number }>`SELECT revision FROM projects WHERE id = ${projectId}`;
  const revision = prows[0].revision;
  const stored = await sql<{ report: CitationReport }>`
    SELECT * FROM citation_reports WHERE project_id = ${projectId} AND revision = ${revision}`;
  if (stored[0]) {
    const report = stored[0].report as CitationReport;
    return { ...report, projectRevision: revision };
  }
  const frows = await sql<{ id: string; path: string; kind: string; revision: number }>`
    SELECT id, path, kind, revision FROM files WHERE project_id = ${projectId} AND deleted_at IS NULL`;
  const map: Record<string, string> = {};
  for (const f of frows) {
    if (f.kind !== 'text') continue;
    const rows = await sql<{ content: Buffer }>`SELECT content FROM file_versions WHERE file_id = ${f.id} AND revision = ${f.revision}`;
    map[f.path] = rows[0].content.toString('utf8');
  }
  const scan = scanCitations(map);
  const checkId = `chk_${revision}_${projectId.slice(0, 8)}`;
  const report: CitationReport = {
    projectRevision: revision,
    checkId,
    undefined: scan.undefined,
    unused: scan.unused,
    duplicate: scan.duplicate,
  };
  await sql`
    INSERT INTO citation_reports (project_id, revision, check_id, report)
    VALUES (${projectId}, ${revision}, ${checkId}, ${json(report)})
    ON CONFLICT (project_id, revision) DO NOTHING`;
  return report;
}
