import { createHash, randomUUID } from 'node:crypto';
import type { Project, ProjectKind, ProjectState } from '../shared/types.js';
import { FIELD_COPY, PROJECT_NOT_FOUND } from '../shared/copy.js';
import { query, queryOne, withTransaction } from './db.js';
import { ApiError, conflict, notFound, validation } from './errors.js';
import { serverNow } from './clock.js';
import { classroomState, educatorRoleIn, isUuid, type ClassroomRow, CLASSROOM_COLUMNS } from './classrooms.js';
import { putObject, snapshotKey } from './storage.js';
import type { AccountRow } from './accounts.js';

export interface ProjectRow {
  id: string;
  owner_id: string;
  classroom_id: string | null;
  kind: ProjectKind;
  name: string;
  revision: number;
  saved_at: Date;
  handed_in: boolean;
}

export const PROJECT_COLUMNS = 'id, owner_id, classroom_id, kind, name, revision, saved_at, handed_in';

export const projectNotFound = (): never => {
  throw notFound(PROJECT_NOT_FOUND);
};

export const projectStateOf = (row: ProjectRow, classroomClosed: boolean): ProjectState =>
  row.handed_in || classroomClosed ? 'handed_in' : 'editing';

export const projectView = (row: ProjectRow, classroomClosed: boolean): Project => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  ownerId: row.owner_id,
  classroomId: row.classroom_id,
  revision: row.revision,
  savedAt: row.saved_at.toISOString(),
  state: projectStateOf(row, classroomClosed),
});

export const loadProject = async (id: string): Promise<ProjectRow | null> => {
  if (!isUuid(id)) return null;
  return queryOne<ProjectRow>(`select ${PROJECT_COLUMNS} from projects where id = $1`, [id]);
};

export const classroomOf = async (classroomId: string | null): Promise<ClassroomRow | null> => {
  if (!classroomId) return null;
  return queryOne<ClassroomRow>(`select ${CLASSROOM_COLUMNS} from classrooms where id = $1`, [classroomId]);
};

export const classroomIsClosed = (classroom: ClassroomRow | null): boolean => {
  if (!classroom) return false;
  const state = classroomState(classroom);
  return state === 'handed_in' || state === 'archived';
};

/** A project is visible to its owner and to the Educators of its Student's classroom. */
export const loadVisibleProject = async (
  account: AccountRow,
  id: string,
): Promise<{ project: ProjectRow; classroom: ClassroomRow | null; isOwner: boolean }> => {
  const project = await loadProject(id);
  if (!project) return projectNotFound();
  const classroom = await classroomOf(project.classroom_id);
  if (project.owner_id === account.id) return { project, classroom, isOwner: true };
  if (account.kind === 'educator' && project.classroom_id) {
    const role = await educatorRoleIn(project.classroom_id, account.id);
    if (role) return { project, classroom, isOwner: false };
  }
  return projectNotFound();
};

export const validateProjectName = (raw: unknown, fallback: string): string => {
  if (raw === undefined) return fallback;
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length < 1 || name.length > 60) throw validation({ name: FIELD_COPY.name });
  return name;
};

export const validateSnapshot = (raw: unknown, kind: ProjectKind): Record<string, unknown> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw validation({ snapshot: FIELD_COPY.name });
  const snapshot = raw as Record<string, unknown>;
  if (snapshot.kind !== kind) throw validation({ snapshot: FIELD_COPY.name });
  return snapshot;
};

export const createProject = async (input: {
  ownerId: string;
  classroomId: string | null;
  kind: ProjectKind;
  name: string;
  snapshot: Record<string, unknown>;
}): Promise<ProjectRow> => {
  const id = randomUUID();
  const now = serverNow();
  const key = snapshotKey(id, 1);
  await putObject(key, Buffer.from(JSON.stringify(input.snapshot), 'utf8'), 'application/json');
  const rows = await query<ProjectRow>(
    `insert into projects (id, owner_id, classroom_id, kind, name, revision, saved_at)
     values ($1,$2,$3,$4,$5,1,$6)
     returning ${PROJECT_COLUMNS}`,
    [id, input.ownerId, input.classroomId, input.kind, input.name, now],
  );
  await query('insert into project_revisions (project_id, revision, object_key) values ($1, 1, $2)', [id, key]);
  return rows[0];
};

export const bodyHash = (body: Buffer): string => createHash('sha256').update(body).digest('hex');

export interface StoredIdempotency {
  body_hash: string;
  response_json: string;
}

export const findIdempotency = async (
  projectId: string,
  accountId: string,
  key: string,
): Promise<StoredIdempotency | null> =>
  queryOne<StoredIdempotency>(
    `select body_hash, response_json from idempotency_keys
      where project_id = $1 and account_id = $2 and key = $3 and created_at > now() - interval '24 hours'`,
    [projectId, accountId, key],
  );

export const rememberIdempotency = async (
  projectId: string,
  accountId: string,
  key: string,
  hash: string,
  response: unknown,
): Promise<void> => {
  await query(
    `insert into idempotency_keys (project_id, account_id, key, body_hash, response_json)
     values ($1,$2,$3,$4,$5)
     on conflict (project_id, account_id, key) do update set body_hash = excluded.body_hash, response_json = excluded.response_json`,
    [projectId, accountId, key, hash, JSON.stringify(response)],
  );
};

/**
 * Stores one revision. The row lock serialises simultaneous saves, so exactly one wins,
 * and the revision number counts only after storage confirms the snapshot.
 */
export const saveRevision = async (input: {
  projectId: string;
  baseRevision: unknown;
  snapshotRaw: unknown;
  nameRaw: unknown;
}): Promise<ProjectRow> =>
  withTransaction(async (client) => {
    const locked = await client.query<ProjectRow>(
      `select ${PROJECT_COLUMNS} from projects where id = $1 for update`,
      [input.projectId],
    );
    const project = locked.rows[0];
    if (!project) return projectNotFound();

    const classroom = project.classroom_id
      ? (await client.query<ClassroomRow>(`select ${CLASSROOM_COLUMNS} from classrooms where id = $1`, [project.classroom_id])).rows[0] ?? null
      : null;
    if (classroomIsClosed(classroom)) throw conflict('classroom_handed_in');
    if (project.handed_in) throw conflict('project_handed_in');
    if (input.baseRevision !== project.revision) {
      throw new ApiError(409, 'stale_revision', { currentRevision: project.revision });
    }

    const snapshot = validateSnapshot(input.snapshotRaw, project.kind);
    const name = validateProjectName(input.nameRaw, project.name);

    const revision = project.revision + 1;
    const key = snapshotKey(project.id, revision);
    await putObject(key, Buffer.from(JSON.stringify(snapshot), 'utf8'), 'application/json');
    const now = serverNow();
    const updated = await client.query<ProjectRow>(
      `update projects set revision = $2, saved_at = $3, name = $4 where id = $1 returning ${PROJECT_COLUMNS}`,
      [project.id, revision, now, name],
    );
    await client.query('insert into project_revisions (project_id, revision, object_key) values ($1,$2,$3)', [
      project.id,
      revision,
      key,
    ]);
    return updated.rows[0];
  });

export const handInProject = async (projectId: string): Promise<ProjectRow> => {
  const rows = await query<ProjectRow>(
    `update projects set handed_in = true where id = $1 returning ${PROJECT_COLUMNS}`,
    [projectId],
  );
  return rows[0];
};

export const latestSnapshotKey = async (projectId: string, revision: number): Promise<string | null> => {
  const row = await queryOne<{ object_key: string }>(
    'select object_key from project_revisions where project_id = $1 and revision = $2',
    [projectId, revision],
  );
  return row ? row.object_key : null;
};
