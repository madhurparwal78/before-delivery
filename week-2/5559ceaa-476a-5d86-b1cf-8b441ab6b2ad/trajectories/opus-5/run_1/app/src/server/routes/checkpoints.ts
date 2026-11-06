import { limits } from '../config.js';
import { pool } from '../db.js';
import { readCheckpointBlobs, type ManifestFile } from '../domain/blobs.js';
import { assertCheckpointSaved } from '../domain/checkpointState.js';
import { notFound, storageUnavailable } from '../http/errors.js';
import type { AuthContext, Route } from '../http/router.js';
import { nameField } from '../http/validate.js';
import {
  checkpointView,
  listCheckpoints,
  loadCheckpoint,
  loadMembership,
  soleRow,
  type CheckpointRow,
} from '../repository.js';
import { saveCheckpoint } from '../services/checkpointUpload.js';
import { loadRestore, restoreCheckpoint, undoRestore } from '../services/restores.js';
import { StorageUnreachable } from '../services/storage.js';

export async function checkpointManifest(checkpointId: string): Promise<ManifestFile[]> {
  const { rows } = await pool.query<ManifestFile>(
    `select file_id, path, sha256, size from checkpoint_files
      where checkpoint_id = $1 order by path`,
    [checkpointId],
  );
  return rows;
}

async function reachableCheckpoint(ctx: AuthContext): Promise<CheckpointRow> {
  const checkpoint = await loadCheckpoint(pool, ctx.params['checkpoint_id'] ?? '');
  await loadMembership(pool, checkpoint.project_id, ctx.user.id);
  return checkpoint;
}

export async function withStorage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof StorageUnreachable) throw storageUnavailable();
    throw cause;
  }
}

export const checkpointRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/projects/:project_id/checkpoints',
    scope: 'project',
    body: 'json',
    handler: async (ctx) => {
      const name = nameField(
        ctx.fields(),
        'name',
        `Give the checkpoint a name of 1 to ${limits.nameChars} characters.`,
      );
      const saved = await saveCheckpoint(ctx.project.id, ctx.user, name);
      return { status: saved.status, payload: { checkpoint: saved.checkpoint } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:project_id/checkpoints',
    scope: 'project',
    body: 'none',
    handler: async (ctx) => ({
      status: 200,
      payload: {
        checkpoints: (await listCheckpoints(pool, ctx.project.id)).map(checkpointView),
      },
    }),
  },
  {
    method: 'GET',
    pattern: '/api/checkpoints/:checkpoint_id',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const checkpoint = await reachableCheckpoint(ctx);
      const { rows } = await pool.query<{
        file_id: string;
        path: string;
        current_path: string | null;
        sha256: string;
        size: number;
      }>(
        `select f.file_id, f.path, p.path as current_path, f.sha256, f.size
           from checkpoint_files f
           left join files p on p.id = f.file_id and p.project_id = $2
          where f.checkpoint_id = $1 order by f.path`,
        [checkpoint.id, checkpoint.project_id],
      );
      return {
        status: 200,
        payload: { checkpoint: { ...checkpointView(checkpoint), files: rows } },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/checkpoints/:checkpoint_id/files/:file_id',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const checkpoint = await reachableCheckpoint(ctx);
      const fileId = ctx.params['file_id'] ?? '';
      const manifest = await checkpointManifest(checkpoint.id);
      const entry = manifest.find((file) => file.file_id === fileId);
      if (entry === undefined) throw notFound();
      assertCheckpointSaved(checkpoint.state);
      const stored = soleRow(
        await withStorage(() => readCheckpointBlobs(checkpoint.project_id, [entry])),
      );
      return {
        status: 200,
        payload: {
          file: {
            file_id: entry.file_id,
            path: entry.path,
            content: stored.bytes.toString('utf8'),
            sha256: entry.sha256,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/checkpoints/:checkpoint_id/restore',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const checkpoint = await reachableCheckpoint(ctx);
      assertCheckpointSaved(checkpoint.state);
      const manifest = await checkpointManifest(checkpoint.id);
      const restore = await withStorage(() =>
        restoreCheckpoint(checkpoint.project_id, ctx.user, checkpoint.id, manifest),
      );
      return {
        status: 200,
        payload: {
          restore: { id: restore.restoreId, checkpoint_id: checkpoint.id, state: 'applied' },
          files: restore.files,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/restores/:restore_id/undo',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const restore = await loadRestore(pool, ctx.params['restore_id'] ?? '');
      await loadMembership(pool, restore.project_id, ctx.user.id);
      const undone = await undoRestore(ctx.user, restore.id);
      return {
        status: 200,
        payload: {
          restore: { id: restore.id, checkpoint_id: undone.checkpointId, state: 'undone' },
          files: undone.files,
        },
      };
    },
  },
];
