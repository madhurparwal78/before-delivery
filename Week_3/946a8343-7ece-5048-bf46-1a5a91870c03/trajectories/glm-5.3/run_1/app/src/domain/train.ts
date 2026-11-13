import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { AppError } from '../core/errors.js';
import { getCommit, mergeBase, storeCommit, buildTreeFromFiles } from './repo.js';
import { mergeFileStates } from './diff.js';
import { filesOf } from './merge-service.js';
import type { MrRow } from './mr-service.js';
import { createPipeline } from './pipeline-service.js';
import { globMatch } from './push-rules.js';

export interface TrainCar {
  mr_id: number;
  iid: number;
  project_id: number;
  target: string;
  position: number;
  sha: string;
  pipeline_id: number | null;
  created_at: number;
}

export async function carsFor(c: PoolClient, projectId: number, target: string): Promise<TrainCar[]> {
  const r = await c.query<TrainCar>(`
    SELECT tc.mr_id, mr.iid, tc.project_id, tc.target, tc.position, tc.sha, tc.pipeline_id, tc.created_at
    FROM train_cars tc JOIN merge_requests mr ON mr.id = tc.mr_id
    WHERE tc.project_id = $1 AND tc.target = $2
    ORDER BY tc.position
  `, [projectId, target]);
  return r.rows;
}

/** Build the speculative commit for a car: parents are the previous car's commit (or target head), then source head. */
async function buildSpeculative(
  ctx: Ctx,
  c: PoolClient,
  mr: MrRow,
  base: string,
  sourceHead: string,
  actor: string,
): Promise<{ sha: string | null; conflicts: string[] }> {
  const baseFiles = await filesOf(c, ctx, base);
  const targetFiles = await filesOf(c, ctx, base); // base is the previous speculative commit or target head
  void targetFiles;
  const sourceFiles = await filesOf(c, ctx, sourceHead);
  const realBase = await mergeBase(c, sourceHead, base);
  const realBaseFiles = realBase ? await filesOf(c, ctx, realBase) : new Map<string, string>();
  const merged = new Map<string, string>();
  const conflicts: string[] = [];
  for (const path of new Set([...realBaseFiles.keys(), ...baseFiles.keys(), ...sourceFiles.keys()])) {
    const res = mergeFileStates(realBaseFiles.get(path) ?? null, baseFiles.get(path) ?? null, sourceFiles.get(path) ?? null, mr.target, mr.source);
    if (res.content !== null) merged.set(path, res.content);
    if (res.conflict) conflicts.push(path);
  }
  if (conflicts.length > 0) return { sha: null, conflicts };
  const tree = await buildTreeFromFiles(c, merged, ctx.settings.inlineMaxBytes);
  const now = ctx.now();
  const secs = Math.floor(now / 1000);
  const sha = await storeCommit(c, {
    tree,
    parents: [base, sourceHead],
    author: 'spurline-train',
    author_time: secs,
    committer: 'spurline-train',
    commit_time: secs,
    message: `Train merge !${mr.iid}`,
  });
  return { sha, conflicts: [] };
}

/** Rebuild the cars from `fromPosition` onward with new speculative commits and pipelines. */
export async function rebuildCarsFrom(
  ctx: Ctx,
  c: PoolClient,
  projectId: number,
  projectPath: string,
  target: string,
  defaultBranch: string,
  fromPosition: number,
): Promise<TrainCar[]> {
  const cars = await carsFor(c, projectId, target);
  const targetHead = (await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, target])).rows[0]?.commit_id ?? null;
  if (!targetHead) return cars;
  let base = targetHead;
  let position = 1;
  const out: TrainCar[] = [];
  for (const car of cars) {
    const mr = (await c.query<MrRow>(`SELECT * FROM merge_requests WHERE id = $1`, [car.mr_id])).rows[0];
    if (!mr) continue;
    if (position >= fromPosition) {
      const sourceHead = (await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, mr.source])).rows[0]?.commit_id ?? null;
      if (!sourceHead) {
        await c.query(`DELETE FROM train_cars WHERE mr_id = $1`, [car.mr_id]);
        continue;
      }
      const spec = await buildSpeculative(ctx, c, mr, base, sourceHead, 'spurline-train');
      if (spec.sha === null) {
        await c.query(`DELETE FROM train_cars WHERE mr_id = $1`, [car.mr_id]);
        continue;
      }
      // cancel old pipeline
      if (car.pipeline_id) {
        await c.query(`UPDATE jobs SET status = 'canceled', failure_reason = $3, finished_at = $2 WHERE pipeline_id = $1 AND status IN ('created','pending','running','waiting','scheduled')`, [car.pipeline_id, ctx.now(), 'Canceled by train rebuild']);
        await c.query(`UPDATE pipelines SET status = 'canceled', finished_at = $2 WHERE id = $1`, [car.pipeline_id, ctx.now()]);
      }
      const pl = await createPipeline(ctx, c, {
        projectId, projectPath, ref: target, sha: spec.sha, source: 'train', defaultBranch,
        trainMr: mr, extraVars: { CI_TRAIN: 'true' },
      });
      await c.query(`UPDATE train_cars SET position = $2, sha = $3, pipeline_id = $4, created_at = $5 WHERE mr_id = $1`,
        [car.mr_id, position, spec.sha, pl.id ?? null, ctx.now()]);
      out.push({ ...car, position, sha: spec.sha, pipeline_id: pl.id ?? null });
    } else {
      out.push({ ...car, position });
    }
    const shaRow = (await c.query<{ sha: string }>(`SELECT sha FROM train_cars WHERE mr_id = $1`, [car.mr_id])).rows[0];
    if (shaRow) base = shaRow.sha;
    position++;
  }
  return out;
}

export interface AddTrainResult {
  position: number;
  sha: string;
  pipelineId: number | null;
}

export async function addToTrain(
  ctx: Ctx,
  c: PoolClient,
  projectId: number,
  projectPath: string,
  mr: MrRow,
  defaultBranch: string,
): Promise<AddTrainResult> {
  const cars = await carsFor(c, projectId, mr.target);
  if (cars.length >= ctx.settings.trainMax) {
    throw new AppError(409, 'train_full', `This train is full (${ctx.settings.trainMax} cars).`);
  }
  const last = cars[cars.length - 1];
  const targetHead = (await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, mr.target])).rows[0]?.commit_id ?? null;
  if (!targetHead) throw new AppError(404, 'not_found', 'Not found.');
  const base = last ? last.sha : targetHead;
  const sourceHead = (await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, mr.source])).rows[0]?.commit_id ?? null;
  if (!sourceHead) throw new AppError(409, 'stale_head', 'The source branch changed. Review the new commits and try again.');
  const spec = await buildSpeculative(ctx, c, mr, base, sourceHead, 'spurline-train');
  if (spec.sha === null) {
    throw new AppError(409, 'merge_blocked', `Source branch has conflicts with ${mr.target}.`);
  }
  const position = cars.length + 1;
  const pl = await createPipeline(ctx, c, {
    projectId, projectPath, ref: mr.target, sha: spec.sha, source: 'train', defaultBranch, trainMr: mr,
    extraVars: { CI_TRAIN: 'true' },
  });
  const now = ctx.now();
  await c.query(`INSERT INTO train_cars (mr_id, project_id, target, position, sha, pipeline_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [mr.id, projectId, mr.target, position, spec.sha, pl.id ?? null, now]);
  await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, 'spurline-train', $2, true, false, $3, $4)`,
    [projectId, `Added to merge train at position ${position}.`, mr.id, now]);
  return { position, sha: spec.sha, pipelineId: pl.id ?? null };
}

export async function removeFromTrain(
  ctx: Ctx,
  c: PoolClient,
  projectId: number,
  projectPath: string,
  mr: MrRow,
  reason: string,
  defaultBranch: string,
): Promise<void> {
  const car = (await c.query<{ position: number; pipeline_id: number | null }>(`SELECT position, pipeline_id FROM train_cars WHERE mr_id = $1`, [mr.id])).rows[0];
  if (!car) return;
  if (car.pipeline_id) {
    const now = ctx.now();
    await c.query(`UPDATE jobs SET status = 'canceled', failure_reason = $3, finished_at = $2 WHERE pipeline_id = $1 AND status IN ('created','pending','running','waiting','scheduled')`, [car.pipeline_id, now, 'Canceled by train removal']);
    await c.query(`UPDATE pipelines SET status = 'canceled', finished_at = $2 WHERE id = $1`, [car.pipeline_id, now]);
  }
  await c.query(`DELETE FROM train_cars WHERE mr_id = $1`, [mr.id]);
  const now = ctx.now();
  await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, 'spurline-train', $2, true, false, $3, $4)`,
    [projectId, `Removed from merge train: ${reason}.`, mr.id, now]);
  await rebuildCarsFrom(ctx, c, projectId, projectPath, mr.target, defaultBranch, car.position);
  await ctx.live(c, projectId, 'train', { target: mr.target, event: 'removed', iid: mr.iid });
}

/** A car's pipeline finished: merge if it's first, remove if it failed. */
export async function onCarPipelineFinished(
  ctx: Ctx,
  c: PoolClient,
  projectId: number,
  projectPath: string,
  pipelineId: number,
  status: string,
  defaultBranch: string,
): Promise<void> {
  const car = (await c.query<TrainCar & { iid: number }>(`
    SELECT tc.mr_id, mr.iid, tc.project_id, tc.target, tc.position, tc.sha, tc.pipeline_id, tc.created_at
    FROM train_cars tc JOIN merge_requests mr ON mr.id = tc.mr_id WHERE tc.pipeline_id = $1`, [pipelineId])).rows[0];
  if (!car) return;
  const mr = (await c.query<MrRow>(`SELECT * FROM merge_requests WHERE id = $1`, [car.mr_id])).rows[0];
  if (!mr) return;
  if (status === 'failed' || status === 'canceled') {
    await removeFromTrain(ctx, c, projectId, projectPath, mr, `pipeline ${pipelineId} failed`, defaultBranch);
    return;
  }
  if (status === 'success' || status === 'warning') {
    if (car.position === 1) {
      await mergeFirstCar(ctx, c, projectId, projectPath, car, mr, defaultBranch);
    }
    // a car further back waits until it is first
  }
}

async function mergeFirstCar(
  ctx: Ctx,
  c: PoolClient,
  projectId: number,
  projectPath: string,
  car: TrainCar,
  mr: MrRow,
  defaultBranch: string,
): Promise<void> {
  // target head becomes the stored speculative commit
  await c.query(`UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, mr.target, car.sha]);
  const now = ctx.now();
  await c.query(`UPDATE merge_requests SET state = 'merged', merged_at = $2, merge_commit = $3, updated_at = $2 WHERE id = $1`, [mr.id, now, car.sha]);
  await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
    [projectId, 'spurline-train', `Merged by @spurline-train into ${mr.target}.`, mr.id, now]);
  await c.query(`DELETE FROM train_cars WHERE mr_id = $1`, [mr.id]);
  if (mr.delete_source_branch) {
    await c.query(`DELETE FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, mr.source]);
  }
  // target push pipeline
  await createPipeline(ctx, c, {
    projectId, projectPath, ref: mr.target, sha: car.sha, source: 'push', defaultBranch,
  });
  // closing keywords and stacked retargeting, as for any merge
  const { closeIssuesForMerge, retargetStacked } = await import('./merge-journey.js');
  await closeIssuesForMerge(ctx, c, { id: projectId, default_branch: defaultBranch, path: projectPath }, { iid: mr.iid, description: mr.description, source: mr.source, target: mr.target }, car.sha, 'spurline-train');
  await retargetStacked(ctx, c, { id: projectId, path: projectPath }, mr, ctx.settings.retargetLimit);
  await rebuildCarsFrom(ctx, c, projectId, projectPath, mr.target, defaultBranch, 1);
  await ctx.live(c, projectId, 'train', { target: mr.target, event: 'merged', iid: mr.iid, sha: car.sha });
  void getCommit;
}

export { globMatch };
