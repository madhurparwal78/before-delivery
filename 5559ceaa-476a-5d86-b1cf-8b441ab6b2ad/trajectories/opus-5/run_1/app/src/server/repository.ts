import { randomUUID } from 'node:crypto';
import type {
  Checkpoint,
  CheckpointState,
  EmailStatus,
  FileMeta,
  Member,
  MemberRole,
  ProjectKind,
  Session,
  SessionState,
} from '../shared/api.js';
import type { Queryable } from './db.js';
import { forbidden, notFound } from './http/errors.js';

/** Narrows the result of an insert or update that is known to return one row. */
export function soleRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('Expected exactly one row');
  return row;
}

export interface ProjectRow {
  id: string;
  title: string;
  kind: ProjectKind;
  owner_id: string;
  file_seq: string;
}

export interface SessionRow {
  id: string;
  project_id: string;
  title: string;
  state: SessionState;
  scheduled_for: Date;
  driver_id: string | null;
  version: number;
}

export interface FileRow {
  id: string;
  project_id: string;
  path: string;
  content: Buffer;
  revision: number;
  sha256: string;
  size: number;
}

export interface CheckpointRow {
  id: string;
  project_id: string;
  name: string;
  state: CheckpointState;
  created_by: string | null;
  created_by_name: string;
  created_at: Date;
  deadline_at: Date;
  file_count: string;
}

export interface Membership {
  project: ProjectRow;
  role: MemberRole;
}

export async function loadMembership(
  client: Queryable,
  projectId: string,
  userId: string,
): Promise<Membership> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound();
  const { rows } = await client.query<ProjectRow & { role: MemberRole }>(
    `select p.id, p.title, p.kind, p.owner_id, p.file_seq, m.role
       from projects p join memberships m on m.project_id = p.id
      where p.id = $1 and m.user_id = $2`,
    [projectId, userId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return {
    project: {
      id: row.id,
      title: row.title,
      kind: row.kind,
      owner_id: row.owner_id,
      file_seq: row.file_seq,
    },
    role: row.role,
  };
}

export function assertMentor(role: MemberRole): void {
  if (role !== 'mentor') throw forbidden('Only the mentor may do this.');
}

export async function memberList(client: Queryable, projectId: string): Promise<Member[]> {
  const { rows } = await client.query<{
    user_id: string;
    name: string;
    role: MemberRole;
    email_status: EmailStatus;
    online: boolean;
  }>(
    `select m.user_id, u.name, m.role, m.email_status,
            exists (select 1 from presence pr
                     where pr.project_id = m.project_id and pr.user_id = m.user_id) as online
       from memberships m join users u on u.id = m.user_id
      where m.project_id = $1
      order by case when m.role = 'mentor' then 0 else 1 end, m.seq`,
    [projectId],
  );
  return rows.map((row) => ({
    user_id: row.user_id,
    name: row.name,
    role: row.role,
    online: row.online,
    email_status: row.email_status,
  }));
}

export const sessionView = (row: SessionRow): Session => ({
  id: row.id,
  project_id: row.project_id,
  title: row.title,
  state: row.state,
  scheduled_for: row.scheduled_for.toISOString(),
  driver_id: row.driver_id,
  version: row.version,
});

export const fileView = (row: FileRow): FileMeta => ({
  id: row.id,
  path: row.path,
  revision: row.revision,
  sha256: row.sha256,
  size: row.size,
});

export const checkpointView = (row: CheckpointRow): Checkpoint => ({
  id: row.id,
  project_id: row.project_id,
  name: row.name,
  state: row.state,
  created_by: { id: row.created_by, name: row.created_by_name },
  created_at: row.created_at.toISOString(),
  file_count: Number(row.file_count),
});

const CHECKPOINT_COLUMNS = `c.id, c.project_id, c.name, c.state, c.created_by, c.created_by_name,
    c.created_at, c.deadline_at,
    (select count(*) from checkpoint_files f where f.checkpoint_id = c.id) as file_count`;

export async function loadCheckpoint(
  client: Queryable,
  checkpointId: string,
): Promise<CheckpointRow> {
  if (!/^[0-9a-f-]{36}$/i.test(checkpointId)) throw notFound();
  const { rows } = await client.query<CheckpointRow>(
    `select ${CHECKPOINT_COLUMNS} from checkpoints c where c.id = $1`,
    [checkpointId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row;
}

export async function listCheckpoints(
  client: Queryable,
  projectId: string,
): Promise<CheckpointRow[]> {
  const { rows } = await client.query<CheckpointRow>(
    `select ${CHECKPOINT_COLUMNS} from checkpoints c
      where c.project_id = $1 order by c.created_at desc, c.id desc`,
    [projectId],
  );
  return rows;
}

/** The live or paused session of a project, which the write rule consults. */
export async function blockingSession(
  client: Queryable,
  projectId: string,
): Promise<SessionRow | null> {
  const { rows } = await client.query<SessionRow>(
    `select id, project_id, title, state, scheduled_for, driver_id, version
       from project_sessions
      where project_id = $1 and state in ('live', 'paused')
      limit 1`,
    [projectId],
  );
  return rows[0] ?? null;
}

export async function bumpFileSeq(client: Queryable, projectId: string): Promise<void> {
  await client.query('update projects set file_seq = file_seq + 1 where id = $1', [projectId]);
}

export async function currentFileSeq(client: Queryable, projectId: string): Promise<string> {
  const { rows } = await client.query<{ file_seq: string }>(
    'select file_seq from projects where id = $1',
    [projectId],
  );
  return soleRow(rows).file_seq;
}

export async function logEdit(
  client: Queryable,
  entry: {
    projectId: string;
    fileId: string;
    userId: string;
    actorName: string;
    revision: number;
    sha256: string;
  },
): Promise<void> {
  await client.query(
    `insert into edit_log (id, project_id, file_id, user_id, actor_name, revision, sha256)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      entry.projectId,
      entry.fileId,
      entry.userId,
      entry.actorName,
      entry.revision,
      entry.sha256,
    ],
  );
}

export type AuditType =
  | 'member_removed'
  | 'checkpoint_restored'
  | 'restore_undone'
  | 'import_applied'
  | 'file_renamed'
  | 'file_deleted'
  | 'reviewer_link_created'
  | 'reviewer_link_regenerated'
  | 'reviewer_link_revoked';

export async function writeAudit(
  client: Queryable,
  event: {
    projectId: string;
    type: AuditType;
    actorId: string;
    actorName: string;
    subject: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into audit_events (id, project_id, type, actor_id, actor_name, subject)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      event.projectId,
      event.type,
      event.actorId,
      event.actorName,
      JSON.stringify(event.subject),
    ],
  );
}
