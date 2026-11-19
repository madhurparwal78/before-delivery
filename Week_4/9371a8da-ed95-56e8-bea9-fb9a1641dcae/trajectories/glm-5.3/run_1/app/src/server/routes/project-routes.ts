import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireUser } from './session-routes.js';
import { ApiError } from '../errors.js';
import { readJson, hasUnstorable } from '../validation.js';
import { newId } from '../ids.js';
import { createProjectFromTemplate } from '../templates.js';
import type { LedgerEntry, PersonShape } from '../../shared/types.js';

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}


export function registerProjectRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql } = svc;

  app.get('/api/templates', wrap(async (_req, res) => {
    res.json({ templates: [
      { id: 'thesis-numbered', name: 'Thesis, numbered chapters' },
      { id: 'article-single', name: 'Article, single file' },
    ]});
  }));

  app.get('/api/projects', wrap(async (req, res) => {
    const user = await requireUser(svc, req);
    const rows = await sql`
      SELECT p.id, p.title, p.template, p.revision, m.role
      FROM memberships m JOIN projects p ON p.id = m.project_id
      WHERE m.user_id = ${user.id} ORDER BY p.title`;
    res.json({ projects: rows.map((r) => ({
      id: r.id, title: r.title, template: r.template, role: r.role, projectRevision: r.revision,
    })) });
  }));

  app.post('/api/projects', wrap(async (req, res) => {
    const user = await requireUser(svc, req);
    const body = await readJson(req, ['title', 'template']);
    const title = typeof body.title === 'string' ? body.title : '';
    const template = typeof body.template === 'string' ? body.template : '';
    if (title.trim().length < 1 || title.length > 120 || /[\r\n]/.test(title) || hasUnstorable(title)) {
      throw new ApiError(422, 'invalid', { title: 'Enter a title of 1 to 120 characters.' });
    }
    if (template !== 'thesis-numbered' && template !== 'article-single') {
      throw new ApiError(422, 'invalid', { template: 'unknown template' });
    }
    const ws = await sql`
      SELECT w.id FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ${user.id} AND m.role = 'owner'
      ORDER BY w.name LIMIT 1`;
    if (!ws[0]) throw new ApiError(403, 'forbidden');
    const projectId = newId('p');
    const actor: PersonShape = { id: user.id, displayName: user.displayName, handle: user.handle };
    await sql.begin(async (tx) => {
      await tx`INSERT INTO projects (id, workspace_id, title, template, revision) VALUES (${projectId}, ${ws[0].id}, ${title}, ${template}, 0)`;
      await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${projectId}, ${user.id}, 'owner')`;
      await createProjectFromTemplate(tx, projectId, template, actor);
      await tx`UPDATE projects SET revision = 1 WHERE id = ${projectId}`;
    });
    const rows = await sql`SELECT title, template, revision FROM projects WHERE id = ${projectId}`;
    res.status(201).json({ project: {
      id: projectId, title: rows[0].title, template: rows[0].template,
      role: 'owner', projectRevision: rows[0].revision,
    }});
  }));

  app.get('/api/projects/:pid', wrap(async (req, res) => {
    const user = await requireUser(svc, req);
    const pid = param(req, "pid");
    const mrows = await sql`SELECT role FROM memberships WHERE project_id = ${pid} AND user_id = ${user.id}`;
    if (!mrows[0]) throw new ApiError(404, 'not_found');
    const prows = await sql`SELECT title, template, revision FROM projects WHERE id = ${pid}`;
    if (!prows[0]) throw new ApiError(404, 'not_found');
    const frows = await sql`
      SELECT id, path, kind, revision, size, content_type, sha256 FROM files
      WHERE project_id = ${pid} AND deleted_at IS NULL ORDER BY path`;
    res.json({
      project: {
        id: pid, title: prows[0].title, template: prows[0].template,
        role: mrows[0].role, projectRevision: prows[0].revision,
      },
      files: frows.map((f) => f.kind === 'text'
        ? { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size }
        : { id: f.id, path: f.path, kind: 'asset', size: f.size, contentType: f.content_type, sha256: f.sha256 }),
    });
  }));
}

export type { LedgerEntry };
