// The parts that move a request forward without a person pressing a button: check refreshes, auto-merge, finishing a merge.
import type { Queryable, Tx } from "../db.ts";
import { ApiError } from "../errors.ts";
import { now } from "../clock.ts";
import { config } from "../config.ts";
import { can, projectAccess, type Access, type ProjectRow } from "../access.ts";
import { closeIssuesForMerge } from "../planning/index.ts";
import { getPipelineBrief } from "../ci/index.ts";
import { carOfRequest, removeFromTrain } from "../train/index.ts";
import * as repo from "../repo/index.ts";
import type { Person } from "../repo/types.ts";
import { firstFailed, type CheckResult } from "./checks.ts";
import { closingIssueIids } from "./closing.ts";
import { evaluateRequest, type Evaluation } from "./evaluate.ts";
import { emitRequest, requestWebhook } from "./notify.ts";
import { ruleSignature } from "./rules.ts";
import { insertSystemNote, latestVersion, requestById, type MrRow } from "./store.ts";

function checksSignature(checks: readonly CheckResult[]): string {
  return checks.map((check) => `${check.name}|${check.state}|${check.text}`).join("\n");
}

/** Remembers what a viewer is about to see, so that a later change is compared with it and announced. */
export async function rememberChecks(q: Queryable, mr: MrRow, evaluation: Evaluation): Promise<void> {
  const signature = ruleSignature(evaluation.rules);
  if (checksSignature(evaluation.checks) === checksSignature(mr.checks) && signature === mr.rules_snapshot) return;
  await q.q("UPDATE merge_requests SET checks = $2, rules_snapshot = $3 WHERE id = $1", [mr.id, JSON.stringify(evaluation.checks), signature]);
}

interface RefreshOptions {
  /** Merge on the server when every check now passes and auto-merge is set. */
  readonly autoMerge: boolean;
  /** Emit an `approvals` message when the rule list itself changed (the caller has not already). */
  readonly rulesMessage: boolean;
}

/** Re-evaluates one request, stores what it found and emits `checks` (and `approvals`) when something changed. */
export async function refreshRequest(tx: Tx, project: ProjectRow, mrId: number, options: RefreshOptions): Promise<void> {
  const mr = await requestById(tx, mrId);
  if (mr === undefined || mr.state === "merged") return;
  const evaluation = await evaluateRequest(tx, project, mr);
  const signature = ruleSignature(evaluation.rules);
  const checksChanged = checksSignature(evaluation.checks) !== checksSignature(mr.checks);
  const rulesChanged = signature !== mr.rules_snapshot;
  if (checksChanged || rulesChanged) {
    await tx.q("UPDATE merge_requests SET checks = $2, rules_snapshot = $3 WHERE id = $1", [mr.id, JSON.stringify(evaluation.checks), signature]);
  }
  if (rulesChanged && options.rulesMessage) await tx.emit(project.id, "approvals", { iid: mr.iid });
  if (checksChanged) await tx.emit(project.id, "checks", { iid: mr.iid });
  if (options.autoMerge && mr.auto_merge_by !== null) await autoMergeIfReady(tx, project, mr, evaluation);
}

/** Cancels auto-merge with one of the four published reasons. Returns the announcement, or null when it was not set. */
export async function cancelAutoMerge(tx: Tx, mr: MrRow, reason: string, author: string): Promise<string | null> {
  if (mr.auto_merge_by === null) return null;
  await tx.q("UPDATE merge_requests SET auto_merge_by = NULL WHERE id = $1", [mr.id]);
  const text = `Auto-merge canceled: ${reason}.`;
  await insertSystemNote(tx, mr.id, author, text);
  return text;
}

// Runs `work` so that a refusal leaves no trace: the savepoint undoes its rows and its queued live messages.
async function attempt(tx: Tx, work: () => Promise<void>): Promise<boolean> {
  const queued = tx.messages.length;
  await tx.q("SAVEPOINT attempt");
  try {
    await work();
    await tx.q("RELEASE SAVEPOINT attempt");
    return true;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await tx.q("ROLLBACK TO SAVEPOINT attempt");
    tx.messages.length = queued;
    return false;
  }
}

// Requests whose target move is under way in a transaction: the pipeline that the move creates must not merge them again.
const landing = new WeakMap<Tx, Set<number>>();

async function autoMergeIfReady(tx: Tx, project: ProjectRow, mr: MrRow, evaluation: Evaluation): Promise<void> {
  if (mr.state !== "opened" || mr.auto_merge_by === null || evaluation.sourceHead === null) return;
  if (landing.get(tx)?.has(mr.id) === true) return;
  if (firstFailed(evaluation.checks) !== null) return;
  const user = await tx.maybe<Person>("SELECT id, username FROM users WHERE id = $1", [mr.auto_merge_by]);
  if (user === undefined) return;
  const access = await projectAccess(tx, user.id, project);
  if (!can(access, "mr.write")) return;
  const sourceHead = evaluation.sourceHead;
  await attempt(tx, async () => {
    await landRequest(tx, project, mr, user, access, sourceHead);
  });
}

/** Moves the target by the project's merge method, then finishes the merge. `access` is the merger's. */
export async function landRequest(tx: Tx, project: ProjectRow, mr: MrRow, by: Person, access: Access | null, sourceHead: string): Promise<string> {
  if ((await carOfRequest(tx, project.id, mr.id)) !== null) await removeFromTrain(tx, project, mr.id, "merged out of order", "spurline-train");
  const active = landing.get(tx) ?? new Set<number>();
  landing.set(tx, active);
  active.add(mr.id);
  try {
    const merged = await repo.performMerge(tx, {
      project,
      access,
      actor: by,
      targetBranch: mr.target,
      sourceBranch: mr.source,
      sourceHead,
      title: mr.title,
      iid: mr.iid,
      method: project.merge_method,
    });
    await completeMerge(tx, project, mr.id, by, merged.mergeCommit);
    return merged.mergeCommit;
  } finally {
    active.delete(mr.id);
  }
}

export async function completeMerge(tx: Tx, project: ProjectRow, mrId: number, by: Person, mergeCommit: string): Promise<void> {
  const mr = await requestById(tx, mrId);
  if (mr === undefined) throw new Error(`Merge request ${mrId} does not exist`);
  const latest = await latestVersion(tx, mr.id);
  let closes: number[] = [];
  if (mr.target === project.default_branch) {
    const commits = latest === undefined ? [] : await repo.commitsBetween(tx, project.id, latest.base, latest.head);
    closes = closingIssueIids([mr.description, ...commits.map((commit) => commit.message)]);
  }
  await tx.q(
    "UPDATE merge_requests SET state = 'merged', merged_by = $2, merge_commit = $3, auto_merge_by = NULL, updated_at = $4 WHERE id = $1",
    [mr.id, by.username, mergeCommit, now()],
  );
  await insertSystemNote(tx, mr.id, by.username, `Merged by @${by.username} into ${mr.target}.`);

  const removable = mr.delete_source_branch && mr.source !== mr.target && !(await repo.isProtectedBranch(tx, project.id, mr.source));
  const deleted = removable && (await repo.branchExists(tx, project.id, mr.source));
  if (deleted) await repo.deleteBranchRef(tx, project, mr.source);

  await emitRequest(tx, project, mr.iid, "merged", [`Merged into ${mr.target}.`]);
  await requestWebhook(tx, project, { ...mr, state: "merged" }, "merge", by.username);
  if (closes.length > 0) await closeIssuesForMerge(tx, project, closes, mr.iid, by);
  if (deleted) await retargetStacked(tx, project, mr, by);
}

// Requests waiting on the deleted source branch move to the merged request's target, oldest first, up to the limit.
async function retargetStacked(tx: Tx, project: ProjectRow, merged: MrRow, by: Person): Promise<void> {
  const waiting = await tx.q<MrRow>(
    "SELECT * FROM merge_requests WHERE project_id = $1 AND state = 'opened' AND target = $2 AND id <> $3 ORDER BY iid",
    [project.id, merged.source, merged.id],
  );
  for (const [index, request] of waiting.entries()) {
    if (index >= config.retargetLimit) {
      await refreshRequest(tx, project, request.id, { autoMerge: false, rulesMessage: true });
      continue;
    }
    const text = `Retargeted from ${request.target} to ${merged.target} because !${merged.iid} merged.`;
    await tx.q("UPDATE merge_requests SET target = $2, updated_at = $3 WHERE id = $1", [request.id, merged.target, now()]);
    await insertSystemNote(tx, request.id, by.username, text);
    await emitRequest(tx, project, request.iid, "retargeted", [text]);
    await requestWebhook(tx, project, { ...request, target: merged.target }, "update", by.username);
    await refreshRequest(tx, project, request.id, { autoMerge: true, rulesMessage: true });
  }
}

/** A branch was deleted: requests that used it as source or target have new checks. */
export async function onBranchDeleted(tx: Tx, project: ProjectRow, branch: string): Promise<void> {
  const affected = await tx.q<{ id: number }>(
    "SELECT id FROM merge_requests WHERE project_id = $1 AND state <> 'merged' AND (source = $2 OR target = $2) ORDER BY iid",
    [project.id, branch],
  );
  for (const request of affected) await refreshRequest(tx, project, request.id, { autoMerge: false, rulesMessage: true });
}

export async function onPipelineChanged(tx: Tx, project: ProjectRow, pipelineId: number): Promise<void> {
  const pipeline = await getPipelineBrief(tx, pipelineId);
  if (pipeline === null) return;
  const affected = await tx.q<{ id: number }>(
    `SELECT m.id FROM merge_requests m
      WHERE m.project_id = $1 AND m.state <> 'merged'
        AND (SELECT v.head FROM mr_versions v WHERE v.mr_id = m.id ORDER BY v.number DESC LIMIT 1) = $2
      ORDER BY m.iid`,
    [project.id, pipeline.sha],
  );
  for (const request of affected) await refreshRequest(tx, project, request.id, { autoMerge: true, rulesMessage: true });
}
