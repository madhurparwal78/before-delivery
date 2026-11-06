import { randomUUID } from 'node:crypto';
import type { FileMeta, User } from '../../shared/api.js';
import { pool, tx, type Queryable } from '../db.js';
import { readCheckpointBlobs, type ManifestFile } from '../domain/blobs.js';
import { notFound, restoreAlreadyUndone, restoreSuperseded } from '../http/errors.js';
import {
  bumpFileSeq,
  currentFileSeq,
  fileView,
  loadCheckpoint,
  logEdit,
  soleRow,
  writeAudit,
  type FileRow,
} from '../repository.js';
import { publish } from './bus.js';
import { guardWrite, listFiles } from './fileWrites.js';

interface TargetFile {
  file_id: string;
  path: string;
  sha256: string;
  size: number;
  revision: number;
  content: Buffer;
}

async function replaceFileSet(
  client: Queryable,
  projectId: string,
  before: readonly FileRow[],
  target: readonly TargetFile[],
  actor: User,
  logChanges: boolean,
): Promise<{ files: FileMeta[]; deletedIds: string[] }> {
  const keptIds = new Set(target.map((file) => file.file_id));
  const deletedIds = before.filter((row) => !keptIds.has(row.id)).map((row) => row.id);

  await client.query('delete from files where project_id = $1', [projectId]);

  const files: FileMeta[] = [];
  for (const file of target) {
    const { rows } = await client.query<FileRow>(
      `insert into files (id, project_id, path, content, revision, sha256, size)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, project_id, path, content, revision, sha256, size`,
      [file.file_id, projectId, file.path, file.content, file.revision, file.sha256, file.size],
    );
    const row = soleRow(rows);
    const previous = before.find((candidate) => candidate.id === file.file_id);
    if (logChanges && (previous === undefined || previous.revision !== row.revision)) {
      await logEdit(client, {
        projectId,
        fileId: row.id,
        userId: actor.id,
        actorName: actor.name,
        revision: row.revision,
        sha256: row.sha256,
      });
    }
    files.push(fileView(row));
  }
  await bumpFileSeq(client, projectId);
  return { files, deletedIds };
}

async function announce(
  projectId: string,
  outcome: { files: FileMeta[]; deletedIds: string[] },
): Promise<void> {
  for (const id of outcome.deletedIds) {
    await publish({ project_id: projectId, frame: { type: 'file_deleted', file_id: id } });
  }
  for (const file of outcome.files) {
    await publish({ project_id: projectId, frame: { type: 'file', file } });
  }
}

export async function restoreCheckpoint(
  projectId: string,
  user: User,
  checkpointId: string,
  manifest: readonly ManifestFile[],
): Promise<{ restoreId: string; files: FileMeta[] }> {
  await guardWrite(pool, projectId, user.id);
  const stored = await readCheckpointBlobs(projectId, manifest);

  const result = await tx(async (client) => {
    await guardWrite(client, projectId, user.id);
    const checkpoint = await loadCheckpoint(client, checkpointId);

    const before = await listFiles(client, projectId);
    const restoreId = randomUUID();
    await client.query(
      `insert into restores (id, project_id, checkpoint_id, state, file_seq_after)
       values ($1, $2, $3, 'applied', 0)`,
      [restoreId, projectId, checkpointId],
    );
    for (const row of before) {
      await client.query(
        `insert into restore_files (restore_id, file_id, path, content, revision, sha256, size)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [restoreId, row.id, row.path, row.content, row.revision, row.sha256, row.size],
      );
    }

    const target: TargetFile[] = stored.map(({ file, bytes }) => {
      const previous = before.find((row) => row.id === file.file_id);
      const changed =
        previous === undefined || previous.path !== file.path || previous.sha256 !== file.sha256;
      return {
        file_id: file.file_id,
        path: file.path,
        sha256: file.sha256,
        size: file.size,
        revision: previous === undefined ? 1 : previous.revision + (changed ? 1 : 0),
        content: bytes,
      };
    });

    const outcome = await replaceFileSet(client, projectId, before, target, user, true);
    await client.query('update restores set file_seq_after = $2 where id = $1', [
      restoreId,
      await currentFileSeq(client, projectId),
    ]);
    await writeAudit(client, {
      projectId,
      type: 'checkpoint_restored',
      actorId: user.id,
      actorName: user.name,
      subject: { checkpoint_id: checkpointId, name: checkpoint.name },
    });
    return { restoreId, outcome };
  });

  await announce(projectId, result.outcome);
  return { restoreId: result.restoreId, files: result.outcome.files };
}

interface RestoreRow {
  id: string;
  project_id: string;
  checkpoint_id: string;
  state: 'applied' | 'undone';
  file_seq_after: string;
}

export async function loadRestore(client: Queryable, restoreId: string): Promise<RestoreRow> {
  if (!/^[0-9a-f-]{36}$/i.test(restoreId)) throw notFound();
  const { rows } = await client.query<RestoreRow>(
    'select id, project_id, checkpoint_id, state, file_seq_after from restores where id = $1',
    [restoreId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row;
}

export async function undoRestore(
  user: User,
  restoreId: string,
): Promise<{ checkpointId: string; files: FileMeta[] }> {
  const result = await tx(async (client) => {
    const { rows } = await client.query<RestoreRow>(
      `select id, project_id, checkpoint_id, state, file_seq_after
         from restores where id = $1 for update`,
      [restoreId],
    );
    const restore = soleRow(rows);
    await guardWrite(client, restore.project_id, user.id);
    if (restore.state === 'undone') throw restoreAlreadyUndone();

    const later = await client.query<{ one: number }>(
      `select 1 as one from restores
        where project_id = $1
          and (created_at, id) > ((select created_at from restores where id = $2), $2)`,
      [restore.project_id, restoreId],
    );
    const seq = await currentFileSeq(client, restore.project_id);
    if (later.rows.length > 0 || seq !== restore.file_seq_after) throw restoreSuperseded();

    const before = await listFiles(client, restore.project_id);
    const { rows: recorded } = await client.query<{
      file_id: string;
      path: string;
      content: Buffer;
      revision: number;
      sha256: string;
      size: number;
    }>(
      `select file_id, path, content, revision, sha256, size from restore_files
        where restore_id = $1 order by path`,
      [restoreId],
    );
    const outcome = await replaceFileSet(
      client,
      restore.project_id,
      before,
      recorded,
      user,
      false,
    );
    await client.query(`update restores set state = 'undone', file_seq_after = $2 where id = $1`, [
      restoreId,
      await currentFileSeq(client, restore.project_id),
    ]);
    await writeAudit(client, {
      projectId: restore.project_id,
      type: 'restore_undone',
      actorId: user.id,
      actorName: user.name,
      subject: { restore_id: restoreId, checkpoint_id: restore.checkpoint_id },
    });
    return { restore, outcome };
  });

  await announce(result.restore.project_id, result.outcome);
  return { checkpointId: result.restore.checkpoint_id, files: result.outcome.files };
}
