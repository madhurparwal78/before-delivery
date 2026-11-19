import type { ProjectKind } from '../../shared/types.js';
import { FIELD_COPY, UI_COPY } from '../../shared/copy.js';
import { ApiError, conflict, emailUnverified, forbidden, storageUnavailable, validation } from '../errors.js';
import { query } from '../db.js';
import { requireAccount, type Caller } from '../sessions.js';
import { sendJson, type RequestContext } from '../http.js';
import { getObject } from '../storage.js';
import {
  PROJECT_COLUMNS,
  bodyHash,
  classroomIsClosed,
  classroomOf,
  createProject,
  findIdempotency,
  handInProject,
  latestSnapshotKey,
  loadVisibleProject,
  projectView,
  rememberIdempotency,
  saveRevision,
  validateProjectName,
  validateSnapshot,
  type ProjectRow,
} from '../projects.js';
import { emitProjectHandedIn, emitProjectSaved } from '../stream.js';

const KINDS: ProjectKind[] = ['3d', 'circuit', 'blocks'];

export const listProjects = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  const account = requireAccount(caller);
  const rows = await query<ProjectRow>(
    `select ${PROJECT_COLUMNS} from projects where owner_id = $1 order by saved_at desc`,
    [account.id],
  );
  const classroom = await classroomOf(account.classroom_id);
  const closed = classroomIsClosed(classroom);
  sendJson(ctx, 200, { projects: rows.map((row) => projectView(row, closed)) });
};

export const postProject = async (
  ctx: RequestContext,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<void> => {
  const account = requireAccount(caller);
  if (!account.email_verified) throw emailUnverified(UI_COPY.verifyToSave);
  const classroom = await classroomOf(account.classroom_id);
  if (classroomIsClosed(classroom)) throw conflict('classroom_handed_in');
  const kind = body.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as ProjectKind)) {
    throw validation({ kind: FIELD_COPY.name });
  }
  const name = validateProjectName(body.name, '');
  const snapshot = validateSnapshot(body.snapshot, kind as ProjectKind);
  const project = await createProject({
    ownerId: account.id,
    classroomId: account.classroom_id,
    kind: kind as ProjectKind,
    name,
    snapshot,
  });
  emitProjectSaved({
    projectId: project.id,
    ownerId: project.owner_id,
    classroomId: project.classroom_id,
    revision: project.revision,
    savedAt: project.saved_at.toISOString(),
    kind: project.kind,
    name: project.name,
  });
  sendJson(ctx, 201, { project: projectView(project, false) });
};

export const getProject = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const account = requireAccount(caller);
  const { project, classroom } = await loadVisibleProject(account, params.id);
  const key = await latestSnapshotKey(project.id, project.revision);
  if (!key) throw storageUnavailable();
  const object = await getObject(key);
  if (!object) throw storageUnavailable();
  sendJson(ctx, 200, {
    project: projectView(project, classroomIsClosed(classroom)),
    snapshot: JSON.parse(object.toString('utf8')) as unknown,
  });
};

export const putProject = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
  raw: Buffer,
): Promise<void> => {
  const account = requireAccount(caller);
  const { project, isOwner } = await loadVisibleProject(account, params.id);

  const idempotencyKey = ctx.req.headers['idempotency-key'];
  const key = typeof idempotencyKey === 'string' && idempotencyKey !== '' ? idempotencyKey : null;
  if (key) {
    const stored = await findIdempotency(project.id, account.id, key);
    if (stored) {
      if (stored.body_hash === bodyHash(raw)) {
        sendJson(ctx, 200, JSON.parse(stored.response_json) as unknown);
        return;
      }
      throw conflict('idempotency_conflict');
    }
  }

  if (!isOwner) throw forbidden();
  if (!account.email_verified) throw emailUnverified(UI_COPY.verifyToSave);

  const type = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError(415, 'unsupported_media');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw validation({ snapshot: FIELD_COPY.name });
  }

  const saved = await saveRevision({
    projectId: project.id,
    baseRevision: body.baseRevision,
    snapshotRaw: body.snapshot,
    nameRaw: body.name,
  });
  const response = { project: projectView(saved, false) };
  if (key) await rememberIdempotency(project.id, account.id, key, bodyHash(raw), response);
  emitProjectSaved({
    projectId: saved.id,
    ownerId: saved.owner_id,
    classroomId: saved.classroom_id,
    revision: saved.revision,
    savedAt: saved.saved_at.toISOString(),
    kind: saved.kind,
    name: saved.name,
  });
  sendJson(ctx, 200, response);
};

export const postHandIn = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const account = requireAccount(caller);
  const { project, classroom, isOwner } = await loadVisibleProject(account, params.id);
  if (!isOwner) throw forbidden();
  if (!project.classroom_id) throw conflict('not_a_classroom_project');
  if (classroomIsClosed(classroom)) throw conflict('classroom_handed_in');
  if (project.handed_in) throw conflict('project_handed_in');
  const handed = await handInProject(project.id);
  emitProjectHandedIn({
    projectId: handed.id,
    ownerId: handed.owner_id,
    classroomId: project.classroom_id,
  });
  sendJson(ctx, 200, { project: projectView(handed, false) });
};
