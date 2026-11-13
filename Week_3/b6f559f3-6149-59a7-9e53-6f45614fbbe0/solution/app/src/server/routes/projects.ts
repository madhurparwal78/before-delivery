import { completeDocument } from '../../shared/document';
import { MESSAGES, mustBeBetween } from '../../shared/messages';
import type { ProjectResponse } from '../../shared/protocol';
import type { SceneDocument } from '../../shared/types';
import { findProject, listProjects, lockProject, openProject, requireOwner } from '../access';
import { addMs, now } from '../clock';
import { config, PURGE_DAYS } from '../config';
import { pool, query, snapshot, transaction, type Queryable } from '../db';
import { insertDocument, loadAssets, loadDocument, projectSeq } from '../documents';
import { depths } from '../history';
import { fail, forbidden, invalid, json, newId, notFound, router, type Reply } from '../http';
import { dropConnections } from '../hub';
import { activeLocks } from '../locks';
import { storage } from '../services';

const NAME_LIMIT = 60;

/** The project name rule (shared by create and import): trimmed, 1 to 60 characters. */
function checkProjectName(value: unknown, path = 'name'): string {
  if (typeof value !== 'string' || value.trim().length === 0) return invalid(path, MESSAGES.enterName);
  if (value.trim().length > NAME_LIMIT) return invalid(path, mustBeBetween(1, NAME_LIMIT));
  return value.trim();
}

interface NewProject {
  workspaceId: string;
  name: string;
  ownerId: string;
  document: SceneDocument;
  imported: boolean;
  at: Date;
  id?: string;
}

/** Inserts a project row, its owner membership and its document. Returns the project id. */
export async function createProject(client: Queryable, input: NewProject): Promise<string> {
  const id = input.id ?? newId('p');
  await client.query(
    `INSERT INTO projects (id, workspace_id, name, imported, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.workspaceId, input.name, input.imported, input.ownerId, input.at],
  );
  await client.query(`INSERT INTO members (project_id, person_id, role, added_at) VALUES ($1, $2, 'Owner', $3)`, [id, input.ownerId, input.at]);
  await insertDocument(client, id, input.document);
  return id;
}

export const emptyDocument = (name: string): SceneDocument =>
  completeDocument({ name, scenes: [{ id: newId('s'), name: 'Main', layers: [] }] }, config.seeds);

router.get('/api/projects', async (ctx) => {
  const person = await ctx.requirePerson();
  const status = ctx.q('status') ?? 'active';
  if (status !== 'active' && status !== 'trashed') return invalid('status', MESSAGES.invalidValue);
  return json(200, { projects: await listProjects(person.id, status) });
});

router.post('/api/projects', async (ctx) => {
  const person = await ctx.requirePerson();
  const body = await ctx.jsonObject();
  if (typeof body['workspaceId'] !== 'string') invalid('workspaceId', MESSAGES.invalidValue);
  const workspace = (
    await query<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND person_id = $2', [body['workspaceId'], person.id])
  )[0];
  if (!workspace) return notFound();
  if (workspace.role !== 'Owner') return forbidden(MESSAGES.memberRefusal);
  const name = checkProjectName(body['name']);
  const id = await transaction(async (client) =>
    createProject(client, { workspaceId: body['workspaceId'] as string, name, ownerId: person.id, document: emptyDocument(name), imported: false, at: await now(client) }),
  );
  const project = await findProject(person.id, id);
  return json(201, { project });
});

router.get('/api/projects/:id', async (ctx) => {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  const body = await snapshot(
    async (client): Promise<ProjectResponse> => ({
      project: (await findProject(person.id, project.id, client)) ?? notFound(),
      document: (await loadDocument(client, project.id)).document,
      assets: await loadAssets(client, project.id),
      locks: await activeLocks(project.id, client),
      seq: await projectSeq(client, project.id),
      ...(await depths(client, project.id, person.id)),
    }),
  );
  return json(200, body);
});

router.get('/api/projects/:id/export', async (ctx) => {
  const { project } = await openProject(ctx, ctx.param('id'));
  const { document } = await loadDocument(pool, project.id);
  return { status: 200, raw: JSON.stringify(document), contentType: 'application/json' } satisfies Reply;
});

router.delete('/api/projects/:id', async (ctx) => {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  requireOwner(project, MESSAGES.memberRefusal);
  await transaction(async (client) => {
    if ((await lockProject(client, project.id, 'update')) === 'trashed') return fail(409, 'already_trashed', MESSAGES.alreadyTrashed);
    const at = await now(client);
    await client.query(`UPDATE projects SET status = 'trashed', trashed_at = $2, purge_at = $3 WHERE id = $1`, [project.id, at, addMs(at, PURGE_DAYS * 86_400_000)]);
  });
  return json(200, { project: await findProject(person.id, project.id) });
});

router.post('/api/projects/:id/restore', async (ctx) => {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  requireOwner(project, MESSAGES.memberRefusal);
  await transaction(async (client) => {
    if ((await lockProject(client, project.id, 'update')) !== 'trashed') return fail(409, 'not_trashed', MESSAGES.notTrashed);
    await client.query(`UPDATE projects SET status = 'active', trashed_at = NULL, purge_at = NULL WHERE id = $1`, [project.id]);
  });
  return json(200, { project: await findProject(person.id, project.id) });
});

/** Removes projects whose purge date has passed in server time: objects first, then every row. */
export async function purgeExpired(): Promise<void> {
  const at = await now();
  const due = await query<{ id: string }>(`SELECT id FROM projects WHERE purge_at IS NOT NULL AND purge_at <= $1`, [at]);
  for (const { id } of due) {
    try {
      await storage.deletePrefix(`projects/${id}/`);
    } catch {
      continue;
    }
    await query('DELETE FROM projects WHERE id = $1 AND purge_at <= $2', [id, at]);
    dropConnections(id);
  }
}
