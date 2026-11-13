import type { PoolClient } from 'pg';
import type { Cell, CellType, Checkpoint, NotebookOutput } from '../shared/types.js';
import { config } from './config.js';
import { storageUnavailable } from './errors.js';
import { newId } from './ids.js';
import { loadCells, notebookFileOf } from './notebookstore.js';
import { deleteObject, getObject, putObject, storageKeys, StorageFailure } from './storage.js';

interface CheckpointRow {
  id: string;
  number: number;
  label: string;
  created_at: Date;
}

export function toCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    number: row.number,
    label: row.label,
    created_at: new Date(row.created_at).toISOString(),
    status: 'saved',
  };
}

/**
 * Stores the whole notebook as one MinIO object and records the checkpoint.
 * The checkpoint exists only once MinIO has confirmed the put.
 */
export async function createCheckpoint(
  client: PoolClient,
  notebookId: string,
  label: string | null,
  snapshot: Cell[] | null = null,
): Promise<Checkpoint> {
  const sequence = await client.query<{ checkpoint_sequence: number }>(
    `update notebooks set checkpoint_sequence = checkpoint_sequence + 1
      where id = $1 returning checkpoint_sequence`,
    [notebookId],
  );
  const number = sequence.rows[0].checkpoint_sequence;
  const id = newId();
  const chosenLabel = label ?? `Checkpoint ${number}`;
  const cells = snapshot ?? (await loadCells(notebookId, client));

  const inserted = await client.query<CheckpointRow>(
    `insert into checkpoints (id, notebook_id, number, label) values ($1, $2, $3, $4)
     returning id, number, label, created_at`,
    [id, notebookId, number, chosenLabel],
  );
  try {
    await putObject(
      storageKeys.checkpoint(notebookId, id),
      Buffer.from(notebookFileOf(cells), 'utf8'),
      'application/json',
    );
  } catch (error) {
    if (error instanceof StorageFailure) throw storageUnavailable();
    throw error;
  }

  const extra = await client.query<{ id: string }>(
    `select id from checkpoints where notebook_id = $1 order by number desc offset $2`,
    [notebookId, config.limits.checkpoints_kept],
  );
  for (const row of extra.rows) {
    await deleteObject(storageKeys.checkpoint(notebookId, row.id));
    await client.query(`delete from checkpoints where id = $1`, [row.id]);
  }
  return toCheckpoint(inserted.rows[0]);
}

interface SnapshotCell {
  id?: unknown;
  cell_type?: unknown;
  source?: unknown;
  metadata?: unknown;
  execution_count?: unknown;
  outputs?: unknown;
}

/** Reads a checkpoint's cells back from its snapshot. */
export async function readCheckpointCells(notebookId: string, checkpointId: string): Promise<Cell[]> {
  let stored: { body: Buffer } | null;
  try {
    stored = await getObject(storageKeys.checkpoint(notebookId, checkpointId));
  } catch (error) {
    if (error instanceof StorageFailure) throw storageUnavailable();
    throw error;
  }
  if (!stored) throw storageUnavailable();
  const file = JSON.parse(stored.body.toString('utf8')) as { cells: SnapshotCell[] };
  return file.cells.map((cell, index) => ({
    id: String(cell.id),
    position: index,
    cell_type: cell.cell_type === 'markdown' ? 'markdown' : ('code' as CellType),
    source: typeof cell.source === 'string' ? cell.source : '',
    revision: 1,
    execution_count: typeof cell.execution_count === 'number' ? cell.execution_count : null,
    run_state: 'idle',
    outputs: Array.isArray(cell.outputs) ? (cell.outputs as NotebookOutput[]) : [],
    outputs_version: 1,
    metadata: (cell.metadata ?? {}) as Record<string, unknown>,
    locked_by: null,
  }));
}
