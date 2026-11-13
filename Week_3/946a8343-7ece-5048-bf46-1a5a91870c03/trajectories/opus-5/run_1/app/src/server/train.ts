import { Access, ProjectRow, roleLevels } from './access';
import { nowMs, nowSeconds } from './clock';
import { config } from './config';
import { Sql } from './db';
import { errors } from './errors';
import { Tx, emit } from './live';
import { threeWayMergeTrees } from './diff';
import { MergeRequestRow, firstFailedCheck, loadRequest, mergeChecks, systemNote } from './mr';
import { performMerge } from './merge';
import { createPipeline, loadPipeline } from './pipeline';
import { cancelPipeline } from './runner';
import { checkPushRules, pushRulesOf } from './pushrules';
import { branchHead, filesOfCommit, mergeBase, shortId, storeCommit, writeTree } from './repo';

export type CarRow = {
  id: number;
  project_id: number;
  target: string;
  mr_id: number;
  position: number;
  sha: string;
  pipeline_id: number | null;
  created_ms: number;
};

export async function carsOf(sql: Sql, projectId: number, target: string): Promise<CarRow[]> {
  const rows = await sql.query<CarRow>(
    `select id, project_id, target, mr_id, position, sha, pipeline_id, created_ms
     from train_cars where project_id = $1 and target = $2 order by position`,
    [projectId, target],
  );
  return rows.map(normalize);
}

function normalize(row: CarRow): CarRow {
  return {
    ...row,
    id: Number(row.id),
    project_id: Number(row.project_id),
    mr_id: Number(row.mr_id),
    position: Number(row.position),
    pipeline_id: row.pipeline_id === null ? null : Number(row.pipeline_id),
    created_ms: Number(row.created_ms),
  };
}

export async function carOfRequest(sql: Sql, request: MergeRequestRow): Promise<CarRow | null> {
  const row = await sql.one<CarRow>(
    `select id, project_id, target, mr_id, position, sha, pipeline_id, created_ms
     from train_cars where mr_id = $1`,
    [request.id],
  );
  return row === null ? null : normalize(row);
}

export async function requestOfCar(sql: Sql, car: CarRow): Promise<MergeRequestRow> {
  const row = await sql.one<MergeRequestRow>(
    `select id, project_id, iid, title, description, author, source, target, state, delete_source_branch,
            assignees, reviewers, auto_merge, auto_merge_sha, merge_commit
     from merge_requests where id = $1`,
    [car.mr_id],
  );
  if (row === null) throw errors.notFound();
  return { ...row, id: Number(row.id), project_id: Number(row.project_id), iid: Number(row.iid) };
}

export async function trainJson(sql: Sql, projectId: number, target: string): Promise<Record<string, unknown>> {
  const cars = await carsOf(sql, projectId, target);
  const out: Record<string, unknown>[] = [];
  for (const car of cars) {
    const request = await requestOfCar(sql, car);
    const pipeline = car.pipeline_id === null ? null : await loadPipeline(sql, car.pipeline_id);
    out.push({
      iid: request.iid,
      position: car.position,
      sha: car.sha,
      pipeline_id: car.pipeline_id,
      pipeline_status: pipeline === null ? 'created' : pipeline.status,
    });
  }
  return { target, cars: out };
}

type BuildResult = { sha: string } | { removed: string };

async function buildSpeculative(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  baseSha: string,
): Promise<BuildResult> {
  const sourceHead = await branchHead(t.sql, project.id, request.source);
  if (sourceHead === null) return { removed: 'the merge conflicted with the cars ahead' };
  const base = (await mergeBase(t.sql, project.id, baseSha, sourceHead)) ?? baseSha;
  const merged = threeWayMergeTrees(
    await filesOfCommit(t.sql, project.id, base),
    await filesOfCommit(t.sql, project.id, baseSha),
    await filesOfCommit(t.sql, project.id, sourceHead),
    request.target,
    request.source,
  );
  if (merged.conflicts.length > 0) return { removed: 'the merge conflicted with the cars ahead' };
  const message = `Train merge !${request.iid}`;
  const rules = await pushRulesOf(t.sql, project.id);
  const failure = checkPushRules(rules, {
    branch: request.target,
    isNewBranch: false,
    message,
    before: await filesOfCommit(t.sql, project.id, baseSha),
    after: merged.files,
  });
  if (failure !== null) return { removed: `push rule: ${failure.message}` };
  const tree = await writeTree(t, project.id, merged.files);
  const when = nowSeconds();
  const sha = await storeCommit(t, project.id, {
    tree,
    parents: [baseSha, sourceHead],
    author: 'spurline-train',
    authored_at: when,
    committer: 'spurline-train',
    committed_at: when,
    message,
  });
  return { sha };
}

async function startCarPipeline(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  sha: string,
): Promise<number | null> {
  const result = await createPipeline(t, {
    project,
    ref: request.source,
    sha,
    source: 'train',
    trainTarget: request.target,
    variables: { CI_TRAIN: 'true' },
    mrIid: request.iid,
    actor: 'spurline-train',
    beforeSha: null,
  });
  return 'id' in result ? result.id : null;
}

export async function addToTrain(
  t: Tx,
  project: ProjectRow,
  access: Access,
  request: MergeRequestRow,
  actor: string,
): Promise<void> {
  if (!project.settings.merge_trains) throw errors.forbidden();
  if (request.author !== actor && access.level < roleLevels.maintainer) throw errors.forbidden();
  const checks = await mergeChecks(t.sql, project, request);
  const failed = firstFailedCheck(checks.filter((check) => check.name !== 'pipeline'));
  if (failed !== null) throw errors.conflict('merge_blocked', failed.text);
  const cars = await carsOf(t.sql, project.id, request.target);
  if (cars.length >= config.trainMax) {
    throw errors.conflict('train_full', `This train is full (${cars.length} cars).`);
  }
  const previous = cars[cars.length - 1];
  const baseSha = previous === undefined ? await branchHead(t.sql, project.id, request.target) : previous.sha;
  if (baseSha === null) throw errors.notFound();
  const position = cars.length + 1;
  const built = await buildSpeculative(t, project, request, baseSha);
  if ('removed' in built) {
    await systemNote(t, request, 'spurline-train', `Removed from merge train: ${built.removed}.`);
    throw errors.conflict('merge_blocked', `Source branch has conflicts with ${request.target}.`);
  }
  const pipelineId = await startCarPipeline(t, project, request, built.sha);
  await t.sql.query(
    `insert into train_cars (project_id, target, mr_id, position, sha, pipeline_id, created_ms)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [project.id, request.target, request.id, position, built.sha, pipelineId, nowMs()],
  );
  await t.sql.query("update merge_requests set state = 'on_train' where id = $1", [request.id]);
  await systemNote(t, request, actor, `Added to merge train at position ${position}.`);
  await emit(t, project.id, 'train', {
    target: request.target,
    action: 'join',
    iid: request.iid,
    position,
    sha: built.sha,
    announcement: `!${request.iid} is now position ${position}, testing ${shortId(built.sha)}`,
  });
}

export async function removeCar(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  reason: string,
  notifyAuthor: boolean,
): Promise<void> {
  const car = await carOfRequest(t.sql, request);
  if (car === null) return;
  await t.sql.query('delete from train_cars where id = $1', [car.id]);
  if (car.pipeline_id !== null) {
    await cancelPipeline(t, project, car.pipeline_id);
  }
  if (request.state === 'on_train') {
    await t.sql.query("update merge_requests set state = 'opened' where id = $1", [request.id]);
  }
  await systemNote(t, request, 'spurline-train', `Removed from merge train: ${reason}.`);
  await emit(t, project.id, 'train', {
    target: car.target,
    action: 'leave',
    iid: request.iid,
    ...(notifyAuthor ? { recipient: request.author, announcement: 'Removed from merge train' } : {}),
  });
  await shiftAndRebuild(t, project, car.target, car.position);
}

async function shiftAndRebuild(t: Tx, project: ProjectRow, target: string, fromPosition: number): Promise<void> {
  const cars = await carsOf(t.sql, project.id, target);
  const behind = cars.filter((car) => car.position > fromPosition);
  for (const car of behind) {
    await t.sql.query('update train_cars set position = position - 1 where id = $1', [car.id]);
  }
  await rebuildFrom(t, project, target, fromPosition);
}

export async function rebuildFrom(t: Tx, project: ProjectRow, target: string, fromPosition: number): Promise<void> {
  const cars = await carsOf(t.sql, project.id, target);
  let baseSha =
    fromPosition <= 1
      ? await branchHead(t.sql, project.id, target)
      : cars.find((car) => car.position === fromPosition - 1)?.sha ?? (await branchHead(t.sql, project.id, target));
  if (baseSha === null) return;
  for (const car of cars.filter((item) => item.position >= fromPosition)) {
    const request = await requestOfCar(t.sql, car);
    const built = await buildSpeculative(t, project, request, baseSha);
    if ('removed' in built) {
      await t.sql.query('delete from train_cars where id = $1', [car.id]);
      if (car.pipeline_id !== null) await cancelPipeline(t, project, car.pipeline_id);
      await t.sql.query("update merge_requests set state = 'opened' where id = $1", [request.id]);
      await systemNote(t, request, 'spurline-train', `Removed from merge train: ${built.removed}.`);
      await emit(t, project.id, 'train', {
        target,
        action: 'leave',
        iid: request.iid,
        recipient: request.author,
        announcement: 'Removed from merge train',
      });
      continue;
    }
    if (built.sha !== car.sha) {
      if (car.pipeline_id !== null) await cancelPipeline(t, project, car.pipeline_id);
      const pipelineId = await startCarPipeline(t, project, request, built.sha);
      await t.sql.query('update train_cars set sha = $2, pipeline_id = $3, created_ms = $4 where id = $1', [
        car.id,
        built.sha,
        pipelineId,
        nowMs(),
      ]);
    }
    const fresh = await carOfRequest(t.sql, request);
    await emit(t, project.id, 'train', {
      target,
      action: 'rise',
      iid: request.iid,
      position: fresh?.position ?? car.position,
      sha: built.sha,
      announcement: `!${request.iid} is now position ${fresh?.position ?? car.position}, testing ${shortId(built.sha)}`,
    });
    baseSha = built.sha;
  }
}

export async function rebuildTargetTrain(t: Tx, project: ProjectRow, target: string): Promise<void> {
  const cars = await carsOf(t.sql, project.id, target);
  if (cars.length === 0) return;
  await rebuildFrom(t, project, target, 1);
}

export async function mergeFirstCar(t: Tx, project: ProjectRow, car: CarRow): Promise<void> {
  const request = await requestOfCar(t.sql, car);
  const access: Access = { level: roleLevels.owner, role: 'owner', permissions: [], implied: false };
  await t.sql.query('delete from train_cars where id = $1', [car.id]);
  await performMerge(t, project, access, request, null, 'spurline-train', {
    skipChecks: true,
    speculative: car.sha,
  });
  await emit(t, project.id, 'train', {
    target: car.target,
    action: 'merged',
    iid: request.iid,
    announcement: `!${request.iid} merged into ${car.target}`,
  });
  const cars = await carsOf(t.sql, project.id, car.target);
  for (const behind of cars.filter((item) => item.position > car.position)) {
    await t.sql.query('update train_cars set position = position - 1 where id = $1', [behind.id]);
    const updated = await carOfRequest(t.sql, await requestOfCar(t.sql, behind));
    const behindRequest = await requestOfCar(t.sql, behind);
    await emit(t, project.id, 'train', {
      target: car.target,
      action: 'rise',
      iid: behindRequest.iid,
      position: updated?.position ?? behind.position - 1,
      sha: behind.sha,
      announcement: `!${behindRequest.iid} is now position ${updated?.position ?? behind.position - 1}, testing ${shortId(
        behind.sha,
      )}`,
    });
  }
  await promoteFirstCar(t, project, car.target);
}

export async function promoteFirstCar(t: Tx, project: ProjectRow, target: string): Promise<void> {
  const cars = await carsOf(t.sql, project.id, target);
  const first = cars[0];
  if (first === undefined || first.pipeline_id === null) return;
  const pipeline = await loadPipeline(t.sql, first.pipeline_id);
  if (pipeline === null || pipeline.status !== 'success') return;
  await mergeFirstCar(t, project, first);
}

export async function mergeNow(
  t: Tx,
  project: ProjectRow,
  access: Access,
  request: MergeRequestRow,
  actor: string,
): Promise<void> {
  const car = await carOfRequest(t.sql, request);
  if (car !== null) {
    await t.sql.query('delete from train_cars where id = $1', [car.id]);
    if (car.pipeline_id !== null) await cancelPipeline(t, project, car.pipeline_id);
    await t.sql.query("update merge_requests set state = 'opened' where id = $1", [request.id]);
    await systemNote(t, request, 'spurline-train', `Removed from merge train: removed by ${actor}.`);
  }
  const fresh = await loadRequest(t.sql, project.id, request.iid);
  if (fresh === null) throw errors.notFound();
  await performMerge(t, project, access, fresh, null, actor, { skipChecks: true });
  await rebuildTargetTrain(t, project, request.target);
}

export async function timeoutCars(t: Tx, project: ProjectRow): Promise<void> {
  const rows = await t.sql.query<CarRow>(
    `select id, project_id, target, mr_id, position, sha, pipeline_id, created_ms
     from train_cars where project_id = $1 order by position`,
    [project.id],
  );
  for (const raw of rows) {
    const car = normalize(raw);
    if (car.created_ms + config.jobTimeoutMs > nowMs()) continue;
    if (car.pipeline_id === null) continue;
    const pipeline = await loadPipeline(t.sql, car.pipeline_id);
    if (pipeline === null || ['success', 'failed', 'canceled'].includes(pipeline.status)) continue;
    const jobs = await t.sql.query<{ id: string }>(
      "select id from jobs where pipeline_id = $1 and status in ('running','pending','created','scheduled','manual')",
      [car.pipeline_id],
    );
    for (const job of jobs) {
      await t.sql.query(
        "update jobs set status = 'failed', failure_reason = 'job_timeout', finished_ms = $2 where id = $1",
        [Number(job.id), nowMs()],
      );
    }
    await t.sql.query("update pipelines set status = 'failed' where id = $1", [car.pipeline_id]);
    const request = await requestOfCar(t.sql, car);
    await removeCar(t, project, request, `pipeline ${car.pipeline_id} timed out`, true);
  }
}
