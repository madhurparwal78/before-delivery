// Merge request module: requests, versions, threads, reviews, suggestions, approvals, checks, merging, auto-merge.
import type { Router } from "../http.ts";
import type { Queryable, Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { assertNotBlocked } from "./checks.ts";
import { refreshRequest } from "./engine.ts";
import { evaluateRequest } from "./evaluate.ts";
import { emitRequest } from "./notify.ts";
import { registerApprovalRoutes } from "./routes-approvals.ts";
import { registerMergingRoutes } from "./routes-merging.ts";
import { registerReportRoutes } from "./routes-reports.ts";
import { registerRequestRoutes } from "./routes-requests.ts";
import { registerReviewRoutes } from "./routes-review.ts";
import { insertSystemNote, requestById } from "./store.ts";

export { onBranchPushed } from "./pushes.ts";
export { completeMerge, onBranchDeleted, onPipelineChanged } from "./engine.ts";
export { seedMergeRequests } from "./seed.ts";
export { conflictsText } from "./checks.ts";

export function registerMrRoutes(router: Router): void {
  registerRequestRoutes(router);
  registerReviewRoutes(router);
  registerApprovalRoutes(router);
  registerMergingRoutes(router);
  registerReportRoutes(router);
}

/** `state` is `opened`, `closed` or `merged`. */
export interface MergeRequestRef {
  readonly id: number;
  readonly iid: number;
  readonly author_id: number;
  readonly source: string;
  readonly target: string;
  readonly title: string;
  readonly state: string;
}

export async function findMergeRequest(q: Queryable, projectId: number, iid: number): Promise<MergeRequestRef | undefined> {
  return q.maybe<MergeRequestRef>(
    "SELECT id, iid, author_id, source, target, title, state FROM merge_requests WHERE project_id = $1 AND iid = $2",
    [projectId, iid],
  );
}

/** Writes a system note (published text verbatim) and emits the matching live message. `author` is a username, `spurline-train` or `system`. */
export async function addSystemNote(tx: Tx, projectId: number, mrId: number, author: string, body: string): Promise<void> {
  const mr = await requestById(tx, mrId);
  if (mr === undefined || mr.project_id !== projectId) throw new Error(`Merge request ${mrId} is not in project ${projectId}`);
  await insertSystemNote(tx, mrId, author, body);
  await emitRequest(tx, { id: projectId }, mr.iid, "updated", [body]);
}

/** Re-evaluates the merge checks of one request and emits a `checks` message when anything changed. Auto-merge follows when it is set. */
export async function refreshChecks(tx: Tx, project: ProjectRow, mrId: number): Promise<void> {
  await refreshRequest(tx, project, mrId, { autoMerge: true, rulesMessage: true });
}

/** 409 `merge_blocked` with the first failed merge check (those named in `ignore` do not count); used by `Add to merge train` and `Merge now`. */
export async function assertNoBlockingCheck(q: Queryable, project: ProjectRow, mrId: number, ignore: readonly string[]): Promise<void> {
  const mr = await requestById(q, mrId);
  if (mr === undefined) return;
  assertNotBlocked((await evaluateRequest(q, project, mr)).checks, ignore);
}
