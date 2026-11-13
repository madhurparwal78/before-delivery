// The train rules: joining, speculative commits, rebuilds, removals, merging and the one live message per train change.
import { nowSeconds } from "../clock.ts";
import type { Say, Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { ApiError, conflict } from "../errors.ts";
import type { Person } from "../repo/types.ts";
import { branchHead, cannotMerge, checkPushRules, mergeBase, mergeCommits, moveBranch, snapshot, writeCommit } from "../repo/index.ts";
import { cancelPipeline, createPipeline, getPipelineBrief, type PipelineBrief } from "../ci/index.ts";
import { addSystemNote, completeMerge, conflictsText, type MergeRequestRef } from "../mr/index.ts";
import {
  deleteCar, insertCar, listCars, personById, rebuildRow, renumber, trainActor, TRAIN_USER, type CarRow,
} from "./store.ts";
import { isFinished, positionAnnouncements, rebuildChain, verdictOf, type CarSnapshot } from "./plan.ts";

/** What one train change has done so far; its live message is emitted when the outermost change finishes. */
interface Change {
  readonly project: ProjectRow;
  readonly target: string;
  readonly before: CarSnapshot[];
  readonly removed: { iid: number; author: string }[];
  readonly merged: number[];
}

const open = new WeakMap<Tx, Map<string, Change>>();

function snapshotOf(cars: readonly CarRow[]): CarSnapshot[] {
  return cars.map((car) => ({ iid: car.mr_iid, position: car.position, sha: car.sha }));
}

/** Runs `work` as one change of the train for `target`. A change started while another one of the same train is running
 *  (a push hook inside a merge) joins it, so the train still emits exactly one message. */
export async function inChange<T>(tx: Tx, project: ProjectRow, target: string, work: (change: Change) => Promise<T>): Promise<T> {
  const running = open.get(tx) ?? new Map<string, Change>();
  open.set(tx, running);
  const key = `${project.id}:${target}`;
  const joined = running.get(key);
  if (joined !== undefined) return work(joined);
  const change: Change = { project, target, before: snapshotOf(await listCars(tx, project.id, target)), removed: [], merged: [] };
  running.set(key, change);
  try {
    const result = await work(change);
    running.delete(key);
    await announce(tx, change);
    return result;
  } finally {
    running.delete(key);
  }
}

async function announce(tx: Tx, change: Change): Promise<void> {
  const { project, target } = change;
  const cars = snapshotOf(await listCars(tx, project.id, target));
  const pages = (iid: number): string[] => [`train:${target}`, `mr:${iid}`];
  const say: Say[] = [
    ...change.merged.map((iid) => ({ text: `!${iid} merged into ${target}`, pages: pages(iid) })),
    ...change.removed.map((car) => ({ text: "Removed from merge train", to: car.author, pages: pages(car.iid) })),
    ...positionAnnouncements(change.before, cars).map((line) => ({ text: line.text, pages: pages(line.iid) })),
  ];
  if (say.length === 0) return;
  await tx.emit(project.id, "train", { target, cars }, { say });
}

/** Why a speculative commit could not be built: the reason in the removal note, and the refusal a joining request gets. */
interface Refusal {
  readonly reason: string;
  readonly error: ApiError;
}

interface Speculative {
  readonly sha: string;
  readonly sourceSha: string;
}

function conflicted(target: string): Refusal {
  return {
    reason: "the merge conflicted with the cars ahead",
    error: conflict("merge_blocked", conflictsText(target)),
  };
}

/** The car's stored commit: the three-way merge of `base` (ours) and the request's source head (theirs), parents in that order. */
async function speculate(tx: Tx, project: ProjectRow, target: string, request: { iid: number; source: string }, base: string): Promise<Speculative | Refusal> {
  const sourceSha = await branchHead(tx, project.id, request.source);
  if (sourceSha === null) return conflicted(target);
  const merged = await mergeCommits(tx, project.id, base, sourceSha, { ours: target, theirs: request.source });
  if (!merged.clean) return conflicted(target);
  const message = `Train merge !${request.iid}`;
  try {
    await checkPushRules(tx, { projectId: project.id, branch: target, isNewBranch: false, message, before: await snapshot(tx, project.id, base), after: merged.files });
  } catch (error) {
    if (error instanceof ApiError && error.code === "push_rule") return { reason: `push rule: ${error.message}`, error };
    throw error;
  }
  const at = nowSeconds();
  const commit = await writeCommit(tx, {
    projectId: project.id, parents: [base, sourceSha], files: merged.files,
    author: TRAIN_USER, authoredAt: at, committer: TRAIN_USER, committedAt: at, message,
  });
  return { sha: commit.id, sourceSha };
}

async function startPipeline(tx: Tx, project: ProjectRow, target: string, iid: number, sha: string): Promise<number | null> {
  const head = await branchHead(tx, project.id, target);
  const outcome = await createPipeline(tx, {
    project, ref: target, sha, source: "train", actor: await trainActor(tx), trainTarget: target, mergeRequestIid: iid,
    changesBase: head === null ? null : await mergeBase(tx, project.id, sha, head),
  });
  return "id" in outcome ? outcome.id : null;
}

async function cancelReplaced(tx: Tx, oldId: number, newId: number | null): Promise<void> {
  if (newId === null) return;
  const old = await getPipelineBrief(tx, oldId);
  if (old !== null && !isFinished(old.status)) await cancelPipeline(tx, oldId, `Canceled by newer pipeline ${newId}.`);
}

/** Puts a request at the end of its train with a freshly stored speculative commit and pipeline. Throws the refusal when it cannot be built. */
export async function appendCar(tx: Tx, project: ProjectRow, request: MergeRequestRef, addedBy: Person, author: string): Promise<CarRow> {
  const target = request.target;
  const cars = await listCars(tx, project.id, target);
  const head = await branchHead(tx, project.id, target);
  if (head === null) throw cannotMerge();
  const base = cars.length === 0 ? head : cars[cars.length - 1].sha;
  const made = await speculate(tx, project, target, request, base);
  if ("error" in made) throw made.error;
  const pipelineId = await startPipeline(tx, project, target, request.iid, made.sha);
  return insertCar(tx, {
    projectId: project.id, target, mrId: request.id, iid: request.iid, source: request.source, author,
    addedBy: addedBy.id, sha: made.sha, baseSha: base, sourceSha: made.sourceSha, pipelineId,
  }, cars.length + 1);
}

/** Takes a car off its train and writes the removal note; returns its index so the cars behind can be rebuilt. */
export async function leave(tx: Tx, change: Change, car: CarRow, reason: string, noteAuthor: string): Promise<number> {
  const cars = await listCars(tx, car.project_id, car.target);
  const index = cars.findIndex((row) => row.id === car.id);
  await deleteCar(tx, car.id);
  await renumber(tx, car.project_id, car.target);
  await addSystemNote(tx, car.project_id, car.mr_id, noteAuthor, `Removed from merge train: ${reason}.`);
  change.removed.push({ iid: car.mr_iid, author: car.author });
  return index;
}

/** Rebuilds the cars from `index` on, each on the car in front of it (the first on the target head). Cars ahead are untouched. */
export async function rebuildFrom(tx: Tx, change: Change, index: number): Promise<void> {
  const { project, target } = change;
  const head = await branchHead(tx, project.id, target);
  if (head === null) return;
  const cars = await listCars(tx, project.id, target);
  const ahead = index === 0 ? head : cars[index - 1].sha;
  const { dropped } = await rebuildChain(ahead, cars.slice(index), async (car, base) => {
    const made = await speculate(tx, project, target, { iid: car.mr_iid, source: car.source }, base);
    if ("error" in made) return { refused: made.reason };
    const pipelineId = await startPipeline(tx, project, target, car.mr_iid, made.sha);
    await rebuildRow(tx, car.id, { sha: made.sha, baseSha: base, sourceSha: made.sourceSha, pipelineId });
    if (car.pipeline_id !== null) await cancelReplaced(tx, car.pipeline_id, pipelineId);
    return { built: made };
  });
  for (const { car, reason } of dropped) await leave(tx, change, car, reason, TRAIN_USER);
}

/** Removes a car and rebuilds the cars behind it. */
export async function removeAndRebuild(tx: Tx, change: Change, car: CarRow, reason: string, noteAuthor: string): Promise<void> {
  const index = await leave(tx, change, car, reason, noteAuthor);
  await rebuildFrom(tx, change, index);
}

async function mergeFront(tx: Tx, change: Change, car: CarRow): Promise<void> {
  const { project, target } = change;
  await deleteCar(tx, car.id);
  await renumber(tx, project.id, target);
  await moveBranch(tx, {
    project, access: null, actor: await trainActor(tx), branch: target, to: car.sha, expectedOld: car.base_sha, source: "train", kind: "merge",
  });
  await completeMerge(tx, project, car.mr_id, await personById(tx, car.added_by), car.sha);
  change.merged.push(car.mr_iid);
}

/** Brings the train to rest: cars on a stale base are rebuilt on the head, cars whose pipeline failed leave, and the first car
 *  merges its stored commit once its pipeline passed (the next car then merges at once if it has passed already). */
export async function settle(tx: Tx, change: Change): Promise<void> {
  const { project, target } = change;
  for (;;) {
    const cars = await listCars(tx, project.id, target);
    const head = await branchHead(tx, project.id, target);
    if (cars.length === 0 || head === null) return;
    if (cars[0].base_sha !== head) {
      await rebuildFrom(tx, change, 0);
      continue;
    }
    const verdicts: (PipelineBrief | null)[] = [];
    for (const car of cars) verdicts.push(car.pipeline_id === null ? null : await getPipelineBrief(tx, car.pipeline_id));
    const failed = verdicts.findIndex((brief) => brief !== null && verdictOf(brief.status) === "failed");
    if (failed !== -1) {
      await removeAndRebuild(tx, change, cars[failed], `pipeline ${cars[failed].pipeline_id} failed`, TRAIN_USER);
      continue;
    }
    const first = verdicts[0];
    if (first === null || verdictOf(first.status) !== "passed") return;
    await mergeFront(tx, change, cars[0]);
  }
}
