import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireMember } from './session-routes.js';
import { ApiError, notFound, readOnly } from '../errors.js';
import { readJson } from '../validation.js';
import { newToken } from '../ids.js';
import { loadReview, loadThread } from './review-routes.js';
import { citationReportFor } from './history-routes.js';
import { currentText } from '../domain.js';
import type { FileRow } from '../domain.js';

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}

interface ShareState {
  token: string;
  projectId: string;
  expiresAt: Date;
  status: string;
}

async function findShare(svc: RouteCtx['svc'], token: string): Promise<ShareState | null> {
  const rows = await svc.sql<{ project_id: string; token: string; created_at: Date; expires_at: Date; status: string }>`SELECT * FROM share_links WHERE token = ${token}`;
  if (!rows[0]) return null;
  const link = rows[0];
  const expired = new Date() >= new Date(link.expires_at);
  if (link.status !== 'active' || expired) return null;
  return { token, projectId: link.project_id, expiresAt: link.expires_at, status: link.status };
}

export function registerShareRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql, config } = svc;

  app.get('/api/projects/:pid/share-link', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    const rows = await sql<{ token: string; created_at: Date; expires_at: Date; status: string }>`SELECT * FROM share_links WHERE project_id = ${param(req, 'pid')}`;
    if (!rows[0]) { res.json({ shareLink: null }); return; }
    const link = rows[0];
    const active = link.status === 'active' && new Date() < new Date(link.expires_at);
    res.json({ shareLink: {
      token: link.token,
      url: `${config.appBaseUrl}/s/${link.token}`,
      createdAt: link.created_at instanceof Date ? link.created_at.toISOString() : String(link.created_at),
      expiresAt: link.expires_at instanceof Date ? link.expires_at.toISOString() : String(link.expires_at),
      active,
    }});
  }));

  app.post('/api/projects/:pid/share-link', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    await readJson(req, []);
    const pid = param(req, 'pid');
    const created = await sql.begin(async (tx) => {
      const existing = await tx<{ token: string }>`SELECT * FROM share_links WHERE project_id = ${pid} FOR UPDATE`;
      if (existing[0]) {
        await tx`UPDATE share_links SET status = 'replaced' WHERE project_id = ${pid}`;
      }
      const token = newToken(32);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + config.shareLinkTtlSeconds * 1000);
      if (existing[0]) {
        await tx`
          UPDATE share_links SET token = ${token}, created_at = ${now}, expires_at = ${expiresAt}, status = 'active'
          WHERE project_id = ${pid}`;
      } else {
        await tx`
          INSERT INTO share_links (project_id, token, created_at, expires_at, status)
          VALUES (${pid}, ${token}, ${now}, ${expiresAt}, 'active')`;
      }
      return { token, now, expiresAt };
    });
    res.status(201).json({ shareLink: {
      token: created.token,
      url: `${config.appBaseUrl}/s/${created.token}`,
      createdAt: created.now.toISOString(),
      expiresAt: created.expiresAt.toISOString(),
      active: true,
    }});
  }));

  app.delete('/api/projects/:pid/share-link', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    await sql`UPDATE share_links SET status = 'revoked' WHERE project_id = ${param(req, 'pid')}`;
    res.status(204).end();
  }));

  // ---- Share token routes ----
  app.get('/api/share/:token', wrap(async (req, res) => {
    const share = await findShare(svc, param(req, 'token'));
    if (!share) throw notFound();
    const prows = await sql<{ title: string; revision: number }>`SELECT title, revision FROM projects WHERE id = ${share.projectId}`;
    const frows = await sql<FileRow>`
      SELECT id, path, kind, revision, size, content_type, sha256 FROM files
      WHERE project_id = ${share.projectId} AND deleted_at IS NULL ORDER BY path`;
    res.json({
      project: { title: prows[0].title, projectRevision: prows[0].revision },
      files: frows.map((f) => f.kind === 'text'
        ? { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size }
        : { id: f.id, path: f.path, kind: 'asset', size: f.size, contentType: f.content_type, sha256: f.sha256 }),
    });
  }));

  app.get('/api/share/:token/files/:fid', wrap(async (req, res) => {
    const share = await findShare(svc, param(req, 'token'));
    if (!share) throw notFound();
    const fid = param(req, 'fid');
    const rows = await sql<FileRow>`
      SELECT * FROM files
      WHERE project_id = ${share.projectId} AND id = ${fid} AND deleted_at IS NULL`;
    if (!rows[0]) throw notFound();
    const f = rows[0];
    if (f.kind === 'text') {
      const content = await currentText(sql, f);
      res.json({ file: { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size, content } });
    } else {
      res.json({ file: { id: f.id, path: f.path, kind: 'asset', size: f.size, contentType: f.content_type, sha256: f.sha256 } });
    }
  }));

  app.get('/api/share/:token/files/:fid/raw', wrap(async (req, res) => {
    const share = await findShare(svc, param(req, 'token'));
    if (!share) throw notFound();
    const fid = param(req, 'fid');
    const rows = await sql<FileRow>`
      SELECT * FROM files
      WHERE project_id = ${share.projectId} AND id = ${fid} AND deleted_at IS NULL`;
    if (!rows[0]) throw notFound();
    const f = rows[0];
    if (f.kind === 'asset') {
      const object = await svc.storage.get(`projects/${share.projectId}/assets/${f.id}`).catch(() => undefined);
      if (object === undefined || object === null) {
        throw new ApiError(503, 'storage_unavailable');
      }
      res.setHeader('Content-Type', f.content_type ?? 'application/octet-stream');
      res.send(object);
      return;
    }
    const content = await currentText(sql, f);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  }));

  app.get('/api/share/:token/review', wrap(async (req, res) => {
    const share = await findShare(svc, param(req, 'token'));
    if (!share) throw notFound();
    const data = await loadReview(sql, share.projectId, true);
    res.json(data);
  }));

  app.get('/api/share/:token/citations', wrap(async (req, res) => {
    const share = await findShare(svc, param(req, 'token'));
    if (!share) throw notFound();
    const report = await citationReportFor(svc, share.projectId);
    res.json(report);
  }));

  // Any other method on /api/share/... answers read_only.
  app.all('/api/share/:token', wrap(async (_req, res) => {
    throw readOnly();
  }));
  app.all('/api/share/:token/*splat', wrap(async (_req, res) => {
    throw readOnly();
  }));

  void loadThread;
}
