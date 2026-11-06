import { randomUUID } from 'node:crypto';
import type { FileMeta, User } from '../../shared/api.js';
import { tx, type Queryable } from '../db.js';
import { checkContent, checkPath, normalisePath, pathProblemMessages } from '../domain/paths.js';
import { assertBaseRevision } from '../domain/revisions.js';
import { assertMayWrite } from '../domain/writeRule.js';
import { notFound, pathTaken, validation } from '../http/errors.js';
import {
  blockingSession,
  bumpFileSeq,
  fileView,
  logEdit,
  soleRow,
  writeAudit,
  type FileRow,
} from '../repository.js';
import { publish } from './bus.js';
import { sha256Hex } from './storage.js';

const FILE_COLUMNS = 'id, project_id, path, content, revision, sha256, size';

async function lockFile(
  client: Queryable,
  projectId: string,
  fileId: string,
): Promise<FileRow> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound();
  const { rows } = await client.query<FileRow>(
    `select ${FILE_COLUMNS} from files where project_id = $1 and id = $2 for update`,
    [projectId, fileId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row;
}

async function guardWrite(client: Queryable, projectId: string, userId: string): Promise<void> {
  const session = await blockingSession(client, projectId);
  assertMayWrite(
    session === null ? null : { state: session.state, driverId: session.driver_id },
    userId,
  );
}

function assertPathAllowed(normalised: string, field: 'path' | 'to'): void {
  const problem = checkPath(normalised);
  if (problem !== null) throw validation({ [field]: pathProblemMessages[problem] });
}

function assertContentAllowed(normalised: string, bytes: Buffer): void {
  const problem = checkContent(normalised, bytes);
  if (problem !== null) throw validation({ content: pathProblemMessages[problem] });
}

async function announceFile(projectId: string, file: FileMeta): Promise<FileMeta> {
  await publish({ project_id: projectId, frame: { type: 'file', file } });
  return file;
}

export async function createFile(
  projectId: string,
  user: User,
  rawPath: string,
  content: string,
): Promise<FileMeta> {
  const bytes = Buffer.from(content, 'utf8');
  const path = normalisePath(rawPath);
  const file = await tx(async (client) => {
    await guardWrite(client, projectId, user.id);
    const existing = await client.query<{ one: number }>(
      'select 1 as one from files where project_id = $1 and path = $2',
      [projectId, path],
    );
    if (existing.rows.length > 0) throw pathTaken(path);
    assertPathAllowed(path, 'path');
    assertContentAllowed(path, bytes);

    const id = randomUUID();
    const { rows } = await client.query<FileRow>(
      `insert into files (id, project_id, path, content, revision, sha256, size)
       values ($1, $2, $3, $4, 1, $5, $6)
       on conflict (project_id, path) do nothing
       returning ${FILE_COLUMNS}`,
      [id, projectId, path, bytes, sha256Hex(bytes), bytes.length],
    );
    if (rows.length === 0) throw pathTaken(path);
    const row = soleRow(rows);
    await logEdit(client, {
      projectId,
      fileId: row.id,
      userId: user.id,
      actorName: user.name,
      revision: row.revision,
      sha256: row.sha256,
    });
    await bumpFileSeq(client, projectId);
    return fileView(row);
  });
  return announceFile(projectId, file);
}

export async function saveFile(
  projectId: string,
  user: User,
  fileId: string,
  baseRevision: number,
  content: string,
): Promise<FileMeta> {
  const bytes = Buffer.from(content, 'utf8');
  const file = await tx(async (client) => {
    const current = await lockFile(client, projectId, fileId);
    await guardWrite(client, projectId, user.id);
    assertBaseRevision(current.revision, baseRevision);
    assertContentAllowed(current.path, bytes);

    const { rows } = await client.query<FileRow>(
      `update files set content = $3, revision = revision + 1, sha256 = $4, size = $5
        where project_id = $1 and id = $2
        returning ${FILE_COLUMNS}`,
      [projectId, fileId, bytes, sha256Hex(bytes), bytes.length],
    );
    const row = soleRow(rows);
    await logEdit(client, {
      projectId,
      fileId: row.id,
      userId: user.id,
      actorName: user.name,
      revision: row.revision,
      sha256: row.sha256,
    });
    await bumpFileSeq(client, projectId);
    return fileView(row);
  });
  return announceFile(projectId, file);
}

export async function renameFile(
  projectId: string,
  user: User,
  fileId: string,
  rawPath: string,
): Promise<FileMeta> {
  const path = normalisePath(rawPath);
  const file = await tx(async (client) => {
    const current = await lockFile(client, projectId, fileId);
    const clash = await client.query<{ id: string }>(
      'select id from files where project_id = $1 and path = $2 and id <> $3',
      [projectId, path, fileId],
    );
    if (clash.rows.length > 0) throw pathTaken(path);
    assertPathAllowed(path, 'path');

    const { rows } = await client.query<FileRow>(
      `update files set path = $3 where project_id = $1 and id = $2 returning ${FILE_COLUMNS}`,
      [projectId, fileId, path],
    );
    await writeAudit(client, {
      projectId,
      type: 'file_renamed',
      actorId: user.id,
      actorName: user.name,
      subject: { file_id: fileId, from: current.path, to: path },
    });
    await bumpFileSeq(client, projectId);
    return fileView(soleRow(rows));
  });
  return announceFile(projectId, file);
}

export async function renameFolder(
  projectId: string,
  user: User,
  rawFrom: string,
  rawTo: string,
): Promise<FileMeta[]> {
  const from = normalisePath(rawFrom).replace(/\/+$/, '');
  const to = normalisePath(rawTo).replace(/\/+$/, '');
  const moved = await tx(async (client) => {
    const { rows: inside } = await client.query<FileRow>(
      `select ${FILE_COLUMNS} from files
        where project_id = $1 and path like $2 || '/%' order by path for update`,
      [projectId, from],
    );
    if (inside.length === 0) {
      throw validation({ from: 'No file sits under that folder.' });
    }

    const targets = inside.map((row) => ({
      row,
      path: `${to}/${row.path.slice(from.length + 1)}`,
    }));
    const movedIds = new Set(inside.map((row) => row.id));
    for (const target of targets) {
      const clash = await client.query<{ id: string }>(
        'select id from files where project_id = $1 and path = $2',
        [projectId, target.path],
      );
      if (clash.rows.some((row) => !movedIds.has(row.id))) throw pathTaken(target.path);
    }
    for (const target of targets) assertPathAllowed(target.path, 'to');

    const views: FileMeta[] = [];
    for (const target of targets) {
      const { rows } = await client.query<FileRow>(
        `update files set path = $3 where project_id = $1 and id = $2 returning ${FILE_COLUMNS}`,
        [projectId, target.row.id, target.path],
      );
      await writeAudit(client, {
        projectId,
        type: 'file_renamed',
        actorId: user.id,
        actorName: user.name,
        subject: { file_id: target.row.id, from: target.row.path, to: target.path },
      });
      views.push(fileView(soleRow(rows)));
    }
    await bumpFileSeq(client, projectId);
    return views;
  });
  for (const file of moved) await announceFile(projectId, file);
  return moved;
}

export async function deleteFile(
  projectId: string,
  user: User,
  fileId: string,
): Promise<void> {
  await tx(async (client) => {
    const current = await lockFile(client, projectId, fileId);
    await guardWrite(client, projectId, user.id);
    await client.query('delete from files where project_id = $1 and id = $2', [projectId, fileId]);
    await writeAudit(client, {
      projectId,
      type: 'file_deleted',
      actorId: user.id,
      actorName: user.name,
      subject: { file_id: fileId, path: current.path },
    });
    await bumpFileSeq(client, projectId);
  });
  await publish({ project_id: projectId, frame: { type: 'file_deleted', file_id: fileId } });
}

export async function listFiles(client: Queryable, projectId: string): Promise<FileRow[]> {
  const { rows } = await client.query<FileRow>(
    `select ${FILE_COLUMNS} from files where project_id = $1 order by path`,
    [projectId],
  );
  return rows;
}

export async function loadFile(
  client: Queryable,
  projectId: string,
  fileId: string,
): Promise<FileRow> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound();
  const { rows } = await client.query<FileRow>(
    `select ${FILE_COLUMNS} from files where project_id = $1 and id = $2`,
    [projectId, fileId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row;
}

export { guardWrite };
