// What the rest of Spurline asks of the train: joining, leaving, merging out of order, push and pipeline hooks, the stalled-car
// deadline and seeding.
import { config } from "../config.ts";
import { now } from "../clock.ts";
import { db, withTx, type Queryable, type Tx } from "../db.ts";
import { findProject, requireAction, type Access, type ProjectRow } from "../access.ts";
import { SYSTEM_ACTOR } from "../audit.ts";
import { conflict, notFound } from "../errors.ts";
import type { BranchUpdate, Person } from "../repo/types.ts";
import { branchHead, cannotMerge, performMerge } from "../repo/index.ts";
import { failPipelineForTimeout, getPipelineBrief } from "../ci/index.ts";
import { addSystemNote, completeMerge, assertNoBlockingCheck, findMergeRequest, type MergeRequestRef } from "../mr/index.ts";
import type { SeedKeys, SeedTrain, TrainSeedResult } from "../admin/seed-spec.ts";
import { appendCar, inChange, leave, rebuildFrom, removeAndRebuild, settle } from "./engine.ts";
import { isFinished, isStalled } from "./plan.ts";
import { carByPipeline, carByRequest, carsAtSource, carsDueBefore, listCars, personById, targetHasCars, TRAIN_USER, type CarRow } from "./store.ts";

interface TrainCarView {
  readonly iid: number;
  readonly position: number;
  readonly sha: string;
  readonly pipeline_id: number | null;
}

const viewOf = (car: CarRow): TrainCarView => ({ iid: car.mr_iid, position: car.position, sha: car.sha, pipeline_id: car.pipeline_id });

/** The car of a request (for the request body's `train` field), or null. */
export async function carOfRequest(q: Queryable, projectId: number, mrId: number): Promise<TrainCarView | null> {
  const car = await carByRequest(q, projectId, mrId);
  return car === undefined ? null : viewOf(car);
}

const trainsOff = () => conflict("wrong_state", "Merge trains are switched off for this project.");
const alreadyMerged = () => conflict("wrong_state", "This merge request is already merged.");

async function requestOf(q: Queryable, projectId: number, iid: number): Promise<MergeRequestRef> {
  const request = await findMergeRequest(q, projectId, iid);
  if (request === undefined) throw notFound();
  return request;
}

/** `Add to merge train`: checks (all but `pipeline`), the cap, the speculative commit, its pipeline, note, live messages. Returns the car. */
export async function addToTrain(
  tx: Tx,
  input: { project: ProjectRow; access: Access | null; actor: Person; mrId: number; iid: number },
): Promise<TrainCarView> {
  const { project, access, actor, mrId } = input;
  const request = await requestOf(tx, project.id, input.iid);
  if (access !== null && request.author_id !== actor.id) requireAction(access, "train.manage");
  if (!project.merge_trains) throw trainsOff();
  if (request.state === "merged") throw alreadyMerged();
  if ((await carByRequest(tx, project.id, mrId)) !== undefined) throw conflict("wrong_state", "This merge request is already on the merge train.");
  await assertNoBlockingCheck(tx, project, mrId, ["pipeline"]);
  if ((await listCars(tx, project.id, request.target)).length >= config.trainMax) {
    throw conflict("train_full", `This train is full (${config.trainMax} cars).`);
  }
  return inChange(tx, project, request.target, async (change) => {
    const author = await personById(tx, request.author_id);
    const car = await appendCar(tx, project, request, actor, author.username);
    const view = viewOf(car);
    await addSystemNote(tx, project.id, mrId, actor.username, `Added to merge train at position ${car.position}.`);
    await settle(tx, change);
    return view;
  });
}

/** Removes a request's car (reason text without the leading `Removed from merge train: ` and trailing dot) and rebuilds the cars behind. */
export async function removeFromTrain(tx: Tx, project: ProjectRow, mrId: number, reason: string, noteAuthor: string): Promise<void> {
  const car = await carByRequest(tx, project.id, mrId);
  if (car === undefined) return;
  await inChange(tx, project, car.target, async (change) => {
    await removeAndRebuild(tx, change, car, reason, noteAuthor);
    await settle(tx, change);
  });
}

/** `Merge now`: merges the request by the project's merge method at once, drops its car and rebuilds every remaining car on the new head. */
export async function mergeNow(
  tx: Tx,
  input: { project: ProjectRow; access: Access; actor: Person; iid: number },
): Promise<{ target: string }> {
  const { project, access, actor } = input;
  const request = await requestOf(tx, project.id, input.iid);
  if (!project.merge_trains) throw trainsOff();
  if (request.state === "merged") throw alreadyMerged();
  await assertNoBlockingCheck(tx, project, request.id, ["pipeline"]);
  const sourceHead = await branchHead(tx, project.id, request.source);
  if (sourceHead === null) throw cannotMerge();
  await inChange(tx, project, request.target, async (change) => {
    const car = await carByRequest(tx, project.id, request.id);
    if (car !== undefined) await leave(tx, change, car, "merged out of order", TRAIN_USER);
    const merged = await performMerge(tx, {
      project, access, actor, targetBranch: request.target, sourceBranch: request.source, sourceHead,
      title: request.title, iid: request.iid, method: project.merge_method,
    });
    await completeMerge(tx, project, request.id, actor, merged.mergeCommit);
    await settle(tx, change);
  });
  return { target: request.target };
}

/** Train part of the push transaction: a push to a car's source branch removes that car and rebuilds the cars behind;
 *  a direct push to the target (anything but a train merge) rebuilds every car on the new head. */
export async function onBranchPushed(tx: Tx, update: BranchUpdate): Promise<void> {
  const { project, branch } = update;
  for (const pushed of await carsAtSource(tx, project.id, branch)) {
    await inChange(tx, project, pushed.target, async (change) => {
      const car = await carByRequest(tx, project.id, pushed.mr_id);
      if (car === undefined) return;
      await removeAndRebuild(tx, change, car, "new commits were pushed", update.actor.username);
      await settle(tx, change);
    });
  }
  if (update.source === "train" || !(await targetHasCars(tx, project.id, branch))) return;
  await inChange(tx, project, branch, (change) => settle(tx, change));
}

/** A pipeline finished: a car's pipeline failing removes the car; the first car succeeding merges its stored commit. */
export async function onPipelineChanged(tx: Tx, project: ProjectRow, pipelineId: number): Promise<void> {
  const car = await carByPipeline(tx, project.id, pipelineId);
  if (car === undefined) return;
  await inChange(tx, project, car.target, (change) => settle(tx, change));
}

/** Server-clock deadline: cars whose pipeline did not finish within the job timeout fail with `job_timeout` and leave. */
export async function expireStalledCars(): Promise<void> {
  for (const candidate of await carsDueBefore(db, now() - config.jobTimeoutMs)) {
    await withTx(async (tx) => {
      const project = await findProject(tx, candidate.project_id);
      if (project === undefined) return;
      await tx.lockProject(project.id);
      const car = await carByRequest(tx, project.id, candidate.mr_id);
      if (car === undefined || car.pipeline_id === null || car.pipeline_at === null) return;
      if (!isStalled(car.pipeline_at, now(), config.jobTimeoutMs)) return;
      const pipeline = await getPipelineBrief(tx, car.pipeline_id);
      if (pipeline === null || isFinished(pipeline.status)) return;
      await inChange(tx, project, car.target, async (change) => {
        const index = await leave(tx, change, car, `pipeline ${pipeline.id} timed out`, SYSTEM_ACTOR);
        await failPipelineForTimeout(tx, pipeline.id);
        await rebuildFrom(tx, change, index);
        await settle(tx, change);
      });
    });
  }
}

/** Runs `work` and forgets the live messages it caused, as seeding writes none. */
async function silently<T>(tx: Tx, projectId: number, work: () => Promise<T>): Promise<T> {
  const seq = await tx.currentSeq(projectId);
  const emitted = tx.messages.length;
  const result = await work();
  await tx.q("DELETE FROM live_messages WHERE project_id = $1 AND seq > $2", [projectId, seq]);
  await tx.q("UPDATE projects SET seq = $2 WHERE id = $1", [projectId, seq]);
  tx.messages.splice(emitted);
  return result;
}

/** Seeds trains: builds cars in list order as if each request had been added (turns merge trains on for the project). */
export async function seedTrains(tx: Tx, project: ProjectRow, keys: SeedKeys, specs: readonly SeedTrain[]): Promise<TrainSeedResult> {
  await tx.q("UPDATE projects SET merge_trains = true WHERE id = $1", [project.id]);
  const seeded: ProjectRow = { ...project, merge_trains: true };
  const train: Record<string, { position: number; sha: string; pipeline_id: number | null }> = {};
  await silently(tx, project.id, async () => {
    for (const spec of specs) {
      for (const key of spec.requests) {
        const ids = keys.mergeRequestIds.get(key);
        if (ids === undefined) throw new Error(`Unknown merge request key ${key}`);
        const request = await requestOf(tx, project.id, ids.iid);
        const author = await personById(tx, request.author_id);
        const car = await appendCar(tx, seeded, { ...request, target: spec.target }, author, author.username);
        train[key] = { position: car.position, sha: car.sha, pipeline_id: car.pipeline_id };
      }
    }
  });
  return { train };
}
