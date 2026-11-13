import { randomUUID } from 'node:crypto';
import { ApiError, errors, readJsonBody, readMultipartBody, sendBytes, sendJson } from './http';
import { MSG } from '../shared/messages';
import { config, clientConfig } from './config';
import { query, queryOne, resetDatabase, transaction } from './db';
import { advanceClock, resetClock, serverNow } from './clock';
import {
  loadDocument,
  persistDocument,
  projectRow,
  projectSummary,
  purgeExpired,
} from './repo';
import { openProject } from './access';
import type { Router } from './router';
import {
  assetRecord,
  clearedSessionCookie,
  hashPassword,
  sessionCookie,
  verifyPassword,
} from './api-shared';
import { loadAssets } from './repo';
import {
  completeDocument,
  createDocument,
  validateImportDocument,
} from '../shared/scene-doc';
import type { JsonValue, SceneDocument } from '../shared/types';
import {
  emptyBucket,
  getObject,
  putObject,
  confirmObject,
  storageKeys,
  storageHealthy,
  StorageUnavailable,
  resetBucketReady,
  ensureBucket,
} from './storage';
import { seedAll } from './seed';

function gradingKeyOk(headerValue: string | string[] | undefined): boolean {
  if (config.gradingKey === '') return false;
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return value === config.gradingKey;
}

export function registerCoreRoutes(router: Router): void {
  router.add('GET', '/api/health', async ({ response }) => {
    const healthy = await storageHealthy();
    sendJson(response, 200, { status: healthy ? 'ok' : 'unavailable' });
  });

  router.add('GET', '/api/config', async ({ response }) => {
    sendJson(response, 200, { config: clientConfig() });
  });

  router.add('POST', '/api/grading/reset', async ({ request, response }) => {
    if (!gradingKeyOk(request.headers['x-grading-key'])) throw errors.notFound();
    await resetDatabase();
    resetBucketReady();
    await emptyBucket();
    await resetClock();
    sendJson(response, 200, { status: 'reset' });
  });

  router.add('POST', '/api/grading/seed', async ({ request, response }) => {
    if (!gradingKeyOk(request.headers['x-grading-key'])) throw errors.notFound();
    try {
      await ensureBucket();
    } catch {
      throw errors.storageUnavailable(MSG.storageUploads);
    }
    const seeded = await seedAll();
    sendJson(response, 201, seeded);
  });

  router.add('POST', '/api/grading/clock', async ({ request, response }) => {
    if (!gradingKeyOk(request.headers['x-grading-key'])) throw errors.notFound();
    const body = await readJsonBody(request);
    const advanceMs = body.advanceMs;
    if (typeof advanceMs !== 'number' || !Number.isInteger(advanceMs) || advanceMs < 0) {
      throw errors.validation({ advanceMs: 'Must be between 0 and 31536000000.' });
    }
    const now = await advanceClock(advanceMs);
    sendJson(response, 200, { now: now.toISOString() });
  });

  router.add('POST', '/api/session', async ({ request, response }) => {
    const body = await readJsonBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const person = await queryOne<{ id: string; name: string; email: string; password_hash: string }>(
      `SELECT id, name, email, password_hash FROM people WHERE lower(email) = $1`,
      [email],
    );
    if (!person || !verifyPassword(password, person.password_hash)) {
      throw new ApiError(401, 'bad_credentials', MSG.badCredentials);
    }
    const sessionId = randomUUID();
    const now = await serverNow();
    await query(`INSERT INTO sessions (id, person_id, created_at) VALUES ($1,$2,$3)`, [
      sessionId,
      person.id,
      now.toISOString(),
    ]);
    sendJson(
      response,
      200,
      { user: { id: person.id, name: person.name, email: person.email } },
      { 'set-cookie': sessionCookie(sessionId) },
    );
  });

  router.add('DELETE', '/api/session', async ({ response, sessionId }) => {
    if (sessionId) await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    response.writeHead(204, { 'set-cookie': clearedSessionCookie() });
    response.end();
  });

  router.add('GET', '/api/me', async ({ response, person }) => {
    if (!person) throw errors.unauthenticated();
    sendJson(response, 200, await mePayload(person));
  });

  router.add('GET', '/api/projects', async ({ response, person, url }) => {
    if (!person) throw errors.unauthenticated();
    await purgeExpired();
    const status = url.searchParams.get('status') ?? 'active';
    if (status !== 'active' && status !== 'trashed') {
      throw errors.validation({ status: 'Choose active or trashed.' });
    }
    const rows = await query<{
      id: string;
      workspace_id: string;
      name: string;
      status: string;
      trashed_at: string | null;
      purge_at: string | null;
      imported: boolean;
      role: string;
    }>(
      `SELECT p.id, p.workspace_id, p.name, p.status, p.trashed_at, p.purge_at, p.imported, m.role
       FROM projects p JOIN members m ON m.project_id = p.id
       WHERE m.person_id = $1 AND p.status = $2
       ORDER BY p.created_at`,
      [person.id, status],
    );
    const projects = [];
    for (const row of rows) {
      projects.push(await projectSummary(row, row.role as 'Owner' | 'Editor' | 'Viewer'));
    }
    sendJson(response, 200, { projects });
  });

  router.add('POST', '/api/projects', async ({ request, response, person }) => {
    if (!person) throw errors.unauthenticated();
    const body = await readJsonBody(request);
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const workspace = await queryOne<{ id: string; owner_person_id: string }>(
      `SELECT id, owner_person_id FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (!workspace) throw errors.notFound();
    if (workspace.owner_person_id !== person.id) throw errors.forbidden(MSG.ownerOnlyMembers);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length === 0 || name.length > 60) throw errors.validation({ name: MSG.enterName });
    const projectId = randomUUID();
    const sceneId = randomUUID();
    const now = await serverNow();
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, status, imported, created_at)
         VALUES ($1,$2,$3,'active',false,$4)`,
        [projectId, workspaceId, name, now.toISOString()],
      );
      await client.query(
        `INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,'Owner')`,
        [projectId, person.id],
      );
      await persistDocument(client, projectId, createDocument(name, sceneId));
    });
    const row = await projectRow(projectId);
    sendJson(response, 201, { project: await projectSummary(row!, 'Owner') });
  });

  router.add('GET', '/api/projects/:id', async ({ response, person, params }) => {
    const access = await openProject(person, params.id, 'view');
    const document = await loadDocument(params.id);
    const assets = await loadAssets(params.id);
    sendJson(response, 200, {
      project: await projectSummary(access.row, access.role),
      document: completeDocument(document),
      assets: assets.map(assetRecord),
    });
  });

  router.add('DELETE', '/api/projects/:id', async ({ response, person, params }) => {
    const access = await openProject(person, params.id, 'manage');
    if (access.row.status === 'trashed') {
      throw errors.conflict('already_trashed', MSG.alreadyTrashed);
    }
    const now = await serverNow();
    const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await query(
      `UPDATE projects SET status = 'trashed', trashed_at = $2, purge_at = $3 WHERE id = $1`,
      [params.id, now.toISOString(), purgeAt.toISOString()],
    );
    const row = await projectRow(params.id);
    sendJson(response, 200, { project: await projectSummary(row!, access.role) });
  });

  router.add('POST', '/api/projects/:id/restore', async ({ response, person, params }) => {
    const access = await openProject(person, params.id, 'manage');
    if (access.row.status !== 'trashed') throw errors.conflict('not_trashed', MSG.notTrashed);
    await query(
      `UPDATE projects SET status = 'active', trashed_at = NULL, purge_at = NULL WHERE id = $1`,
      [params.id],
    );
    const row = await projectRow(params.id);
    sendJson(response, 200, { project: await projectSummary(row!, access.role) });
  });

  router.add('GET', '/api/projects/:id/export', async ({ response, person, params }) => {
    await openProject(person, params.id, 'view');
    const document = await loadDocument(params.id);
    sendBytes(
      response,
      200,
      Buffer.from(JSON.stringify(completeDocument(document)), 'utf8'),
      'application/json',
    );
  });

  router.add('GET', '/api/projects/:id/import/original', async ({ response, person, params }) => {
    const access = await openProject(person, params.id, 'view');
    if (!access.row.imported) throw errors.notFound();
    const object = await getObject(storageKeys.importOriginal(params.id));
    if (!object) throw errors.notFound();
    sendBytes(response, 200, object.body, 'application/json');
  });

  router.add('POST', '/api/imports', async ({ request, response, person }) => {
    if (!person) throw errors.unauthenticated();
    const body = await readMultipartBody(request);
    const workspaceId = body.fields.workspaceId ?? '';
    const workspace = await queryOne<{ id: string; owner_person_id: string }>(
      `SELECT id, owner_person_id FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (!workspace) throw errors.notFound();
    if (workspace.owner_person_id !== person.id) throw errors.forbidden(MSG.ownerOnlyMembers);
    const file = body.files.file;
    if (!file) throw errors.validation({ file: MSG.importNotJson });
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(file.data.toString('utf8')) as JsonValue;
    } catch {
      throw errors.validation({ file: MSG.importNotJson });
    }
    const problem = validateImportDocument(parsed);
    if (problem) throw errors.validation({ file: problem.message });
    const source = parsed as unknown as SceneDocument;
    const projectId = randomUUID();
    const name = `${source.name} (imported)`;
    try {
      const key = storageKeys.importOriginal(projectId);
      await putObject(key, file.data, 'application/json');
      const confirmed = await confirmObject(key, file.data.byteLength);
      if (!confirmed) throw new StorageUnavailable('import not confirmed');
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw errors.storageUnavailable(MSG.storageUploads);
      }
      throw error;
    }
    const now = await serverNow();
    const document = completeDocument({ ...source, name });
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, status, imported, created_at)
         VALUES ($1,$2,$3,'active',true,$4)`,
        [projectId, workspaceId, name, now.toISOString()],
      );
      await client.query(
        `INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,'Owner')`,
        [projectId, person.id],
      );
      await persistDocument(client, projectId, document);
    });
    const row = await projectRow(projectId);
    sendJson(response, 201, { project: await projectSummary(row!, 'Owner') });
  });
}

export async function mePayload(person: { id: string; name: string; email: string }): Promise<{
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; role: string }[];
}> {
  const workspaces = await query<{ id: string; name: string; owner_person_id: string }>(
    `SELECT DISTINCT w.id, w.name, w.owner_person_id FROM workspaces w
     LEFT JOIN projects pr ON pr.workspace_id = w.id
     LEFT JOIN members m ON m.project_id = pr.id
     WHERE w.owner_person_id = $1 OR m.person_id = $1`,
    [person.id],
  );
  return {
    user: { id: person.id, name: person.name, email: person.email },
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      role: workspace.owner_person_id === person.id ? 'Owner' : 'Member',
    })),
  };
}

export async function createPerson(
  name: string,
  email: string,
  password: string,
): Promise<{ id: string }> {
  const id = randomUUID();
  const now = await serverNow();
  await query(
    `INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [id, name, email, hashPassword(password), now.toISOString()],
  );
  return { id };
}

export async function startSession(personId: string): Promise<string> {
  const sessionId = randomUUID();
  const now = await serverNow();
  await query(`INSERT INTO sessions (id, person_id, created_at) VALUES ($1,$2,$3)`, [
    sessionId,
    personId,
    now.toISOString(),
  ]);
  return sessionId;
}
