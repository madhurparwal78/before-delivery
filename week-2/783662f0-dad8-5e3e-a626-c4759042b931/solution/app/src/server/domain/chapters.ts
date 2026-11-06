import type { PoolClient } from 'pg';
import { one, query } from '../db/pool.js';
import { CHAPTERS } from '../../shared/domain.js';
import type { RunObject } from '../../shared/types.js';
import {
  StorageUnreachable,
  checkpointKeys,
  deleteObject,
  manifestBytes,
  objectSha,
  putObject,
} from '../services/storage.js';
import { instant } from '../util.js';

interface RunRow {
  id: string;
  server_id: string;
  party_id: string;
  chapter_id: string;
  world_id: string;
  state: 'in_progress' | 'paused' | 'completed';
  start_tiles: { character_id: string; x: number; y: number }[];
  walk_log: { character_id: string; direction: string }[];
  started_at: Date;
}

export const chapterById = (id: string) => CHAPTERS.find((chapter) => chapter.id === id) ?? null;

export const loadRun = (id: string): Promise<RunRow | null> =>
  one<RunRow>('SELECT * FROM chapter_runs WHERE id = $1', [id]);

interface CheckpointRow {
  n: number;
  name: string;
  x: number;
  y: number;
  reached: boolean;
  stored: boolean;
  reached_at: Date | null;
}

const checkpointsOf = (runId: string): Promise<CheckpointRow[]> =>
  query<CheckpointRow>(
    'SELECT n, name, x, y, reached, stored, reached_at FROM checkpoints WHERE run_id = $1 ORDER BY n',
    [runId],
  );

export async function runObject(run: RunRow): Promise<RunObject> {
  const world = await one<{ slug: string }>('SELECT slug FROM worlds WHERE id = $1', [
    run.world_id,
  ]);
  const checkpoints = await checkpointsOf(run.id);
  return {
    id: run.id,
    party_id: run.party_id,
    chapter_id: run.chapter_id,
    world: world?.slug ?? '',
    state: run.state,
    checkpoints: checkpoints.map((checkpoint) => ({
      n: checkpoint.n,
      name: checkpoint.name,
      x: checkpoint.x,
      y: checkpoint.y,
      reached: checkpoint.reached,
      stored: checkpoint.stored,
    })),
    started_at: instant(run.started_at),
  };
}

/** The in-progress run a character's party is playing in this world, if any. */
export async function activeRunFor(
  client: PoolClient,
  characterId: string,
  worldId: string,
): Promise<RunRow | null> {
  const rows = await client.query<RunRow>(
    `SELECT r.* FROM chapter_runs r
       JOIN party_members pm ON pm.party_id = r.party_id
      WHERE pm.character_id = $1 AND r.world_id = $2 AND r.state = 'in_progress'
      LIMIT 1`,
    [characterId, worldId],
  );
  return rows.rows[0] ?? null;
}

export async function appendWalk(
  client: PoolClient,
  runId: string,
  characterId: string,
  direction: string,
): Promise<void> {
  await client.query(
    `UPDATE chapter_runs SET walk_log = walk_log || $2::jsonb WHERE id = $1`,
    [runId, JSON.stringify([{ character_id: characterId, direction }])],
  );
}

interface CheckpointHit {
  readonly n: number;
  readonly name: string;
  readonly last: boolean;
}

/** The next checkpoint is reached when any member steps onto its tile. */
export async function nextCheckpointAt(
  client: PoolClient,
  runId: string,
  x: number,
  y: number,
): Promise<CheckpointHit | null> {
  const pending = await client.query<CheckpointRow>(
    'SELECT n, name, x, y, reached, stored, reached_at FROM checkpoints WHERE run_id = $1 AND reached = false ORDER BY n LIMIT 1',
    [runId],
  );
  const checkpoint = pending.rows[0];
  if (checkpoint === undefined) return null;
  if (checkpoint.x !== x || checkpoint.y !== y) return null;
  const remaining = await client.query<{ count: string }>(
    'SELECT count(*) AS count FROM checkpoints WHERE run_id = $1 AND reached = false',
    [runId],
  );
  return {
    n: checkpoint.n,
    name: checkpoint.name,
    last: Number(remaining.rows[0]?.count ?? 0) === 1,
  };
}

export async function markReached(
  client: PoolClient,
  runId: string,
  n: number,
  last: boolean,
): Promise<void> {
  await client.query(
    'UPDATE checkpoints SET reached = true, reached_at = now() WHERE run_id = $1 AND n = $2',
    [runId, n],
  );
  if (last) {
    await client.query(`UPDATE chapter_runs SET state = 'completed' WHERE id = $1`, [runId]);
  }
}

/**
 * Each reached checkpoint writes its snapshot object, then its manifest object,
 * then its row. A storage failure leaves `stored` false for retry.
 */
export async function storeCheckpoint(run: RunRow, n: number): Promise<boolean> {
  const checkpoint = await one<CheckpointRow>(
    'SELECT n, name, x, y, reached, stored, reached_at FROM checkpoints WHERE run_id = $1 AND n = $2',
    [run.id, n],
  );
  if (checkpoint === null) return false;

  const positions = await query<{ id: string; x: number; y: number }>(
    `SELECT c.id, c.x, c.y FROM characters c
       JOIN party_members pm ON pm.character_id = c.id
      WHERE pm.party_id = $1 ORDER BY c.id`,
    [run.party_id],
  );
  const body = Buffer.from(
    JSON.stringify({
      run_id: run.id,
      chapter_id: run.chapter_id,
      checkpoint: { n: checkpoint.n, name: checkpoint.name, x: checkpoint.x, y: checkpoint.y },
      positions: positions.map((row) => ({ character_id: row.id, x: row.x, y: row.y })),
      walk_log: run.walk_log,
    }),
    'utf8',
  );

  const keys = checkpointKeys(run.server_id, run.id, n);
  try {
    await putObject(keys.snapshot, body);
    await putObject(
      keys.manifest,
      manifestBytes({
        kind: 'chapter_checkpoint',
        server_id: run.server_id,
        object: keys.snapshot,
        sha256: objectSha(body),
        bytes: body.length,
        created_at: instant(new Date()),
      }),
    );
  } catch (error) {
    if (error instanceof StorageUnreachable) {
      await deleteObject(keys.manifest);
      await deleteObject(keys.snapshot);
      return false;
    }
    throw error;
  }
  await query('UPDATE checkpoints SET stored = true WHERE run_id = $1 AND n = $2', [run.id, n]);
  return true;
}

interface RunReplay {
  readonly positions: { character_id: string; x: number; y: number }[];
  readonly checkpoints_reached: number[];
}

/** Replay applies the walk log to the starting tiles. */
export async function replayRun(run: RunRow): Promise<RunReplay> {
  const { STEPS } = await import('./world.js');
  const places = new Map<string, { x: number; y: number }>();
  for (const start of run.start_tiles) places.set(start.character_id, { x: start.x, y: start.y });

  const checkpoints = await checkpointsOf(run.id);
  const reached: number[] = [];
  let next = 0;

  for (const step of run.walk_log) {
    const place = places.get(step.character_id);
    if (place === undefined) continue;
    const move = STEPS[step.direction as keyof typeof STEPS];
    if (move === undefined) continue;
    place.x += move.dx;
    place.y += move.dy;
    const checkpoint = checkpoints[next];
    if (checkpoint !== undefined && checkpoint.x === place.x && checkpoint.y === place.y) {
      reached.push(checkpoint.n);
      next += 1;
    }
  }

  return {
    positions: [...places.entries()]
      .map(([characterId, place]) => ({ character_id: characterId, x: place.x, y: place.y }))
      .sort((a, b) => a.character_id.localeCompare(b.character_id)),
    checkpoints_reached: reached,
  };
}

export async function retryPendingCheckpoints(): Promise<void> {
  const rows = await query<{ run_id: string; n: number }>(
    `SELECT run_id, n FROM checkpoints WHERE reached = true AND stored = false LIMIT 25`,
  );
  for (const row of rows) {
    const run = await loadRun(row.run_id);
    if (run === null) continue;
    await storeCheckpoint(run, row.n);
  }
}
