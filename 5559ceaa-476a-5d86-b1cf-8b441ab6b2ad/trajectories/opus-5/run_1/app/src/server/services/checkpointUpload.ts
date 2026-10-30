import { randomUUID } from 'node:crypto';
import type { Checkpoint, User } from '../../shared/api.js';
import { pool, tx } from '../db.js';
import { confirmBlob, manifestBody, manifestKey } from '../domain/blobs.js';
import { checkpointUploadDeadline } from '../domain/expiry.js';
import { resolveCheckpointState } from '../domain/checkpointState.js';
import { checkpointView, loadCheckpoint } from '../repository.js';
import { putObject } from './storage.js';
import { publish } from './bus.js';

const RETRY_DELAY = "interval '5 seconds'";

interface StagedFile {
  file_id: string;
  path: string;
  sha256: string;
  size: number;
  staged: Buffer;
}

async function stagedFiles(checkpointId: string): Promise<StagedFile[]> {
  const { rows } = await pool.query<StagedFile>(
    `select file_id, path, sha256, size, staged from checkpoint_files
      where checkpoint_id = $1 order by path`,
    [checkpointId],
  );
  return rows;
}

/**
 * Uploads every blob, confirms it, then writes the manifest. The checkpoint turns
 * saved only once the manifest is stored; otherwise it stays pending or, past its
 * deadline, fails.
 */
export async function attemptUpload(checkpointId: string): Promise<Checkpoint> {
  const before = await loadCheckpoint(pool, checkpointId);
  let confirmed = false;
  if (before.state === 'pending_upload') {
    try {
      const files = await stagedFiles(checkpointId);
      for (const file of files) {
        await confirmBlob(before.project_id, file.sha256, file.staged);
      }
      await putObject(
        manifestKey(before.project_id, checkpointId),
        manifestBody({
          checkpointId,
          projectId: before.project_id,
          name: before.name,
          createdAt: before.created_at.toISOString(),
          files: files.map((file) => ({
            file_id: file.file_id,
            path: file.path,
            sha256: file.sha256,
            size: file.size,
          })),
        }),
        { contentType: 'application/json' },
      );
      confirmed = true;
    } catch {
      confirmed = false;
    }
  }

  const state = resolveCheckpointState(confirmed, before.deadline_at, new Date());
  const after = await tx(async (client) => {
    if (state === 'pending_upload') {
      await client.query(
        `update checkpoints set claimed_at = null, next_attempt_at = now() + ${RETRY_DELAY}
          where id = $1`,
        [checkpointId],
      );
    } else {
      await client.query(
        `update checkpoints set state = $2, claimed_at = null where id = $1 and state = 'pending_upload'`,
        [checkpointId, state],
      );
      await client.query('update checkpoint_files set staged = null where checkpoint_id = $1', [
        checkpointId,
      ]);
    }
    return loadCheckpoint(client, checkpointId);
  });

  const view = checkpointView(after);
  if (after.state !== before.state) {
    await publish({ project_id: after.project_id, frame: { type: 'checkpoint', checkpoint: view } });
  }
  return view;
}

/** Captures the project's current files and tries the upload straight away. */
export async function saveCheckpoint(
  projectId: string,
  actor: User,
  name: string,
): Promise<{ status: number; checkpoint: Checkpoint }> {
  const checkpointId = randomUUID();
  const created = await tx(async (client) => {
    const now = new Date();
    await client.query(
      `insert into checkpoints (id, project_id, name, state, created_by, created_by_name,
                                created_at, deadline_at)
       values ($1, $2, $3, 'pending_upload', $4, $5, $6, $7)`,
      [
        checkpointId,
        projectId,
        name,
        actor.id,
        actor.name,
        now,
        checkpointUploadDeadline(now),
      ],
    );
    await client.query(
      `insert into checkpoint_files (checkpoint_id, file_id, path, sha256, size, staged)
       select $1, id, path, sha256, size, content from files where project_id = $2`,
      [checkpointId, projectId],
    );
    return loadCheckpoint(client, checkpointId);
  });

  await publish({
    project_id: projectId,
    frame: { type: 'checkpoint', checkpoint: checkpointView(created) },
  });

  const checkpoint = await attemptUpload(checkpointId);
  return { status: checkpoint.state === 'saved' ? 201 : 202, checkpoint };
}

/** Retries pending uploads, with each checkpoint claimed by a single instance. */
export async function retryPendingCheckpoints(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `update checkpoints set claimed_at = now()
      where id in (
        select id from checkpoints
         where state = 'pending_upload' and next_attempt_at <= now()
           and (claimed_at is null or claimed_at < now() - interval '60 seconds')
         order by created_at
         for update skip locked
         limit 10
      )
      returning id`,
  );
  for (const row of rows) {
    await attemptUpload(row.id);
  }
}
