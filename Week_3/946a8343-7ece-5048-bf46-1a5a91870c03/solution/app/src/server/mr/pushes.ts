// The request part of "one push, every consequence": a push to a source branch makes a version, a push to a target branch
// refreshes the checks of the requests aimed at it.
import type { Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { now } from "../clock.ts";
import * as repo from "../repo/index.ts";
import type { BranchUpdate } from "../repo/types.ts";
import { cancelAutoMerge, refreshRequest } from "./engine.ts";
import { emitRequest, requestWebhook } from "./notify.ts";
import { insertSystemNote, latestVersion, sayOnRequest, type MrRow, type VersionRow } from "./store.ts";
import { remapThreads } from "./threads.ts";

const RESOLVED_BECAUSE_CHANGED = "Resolved because the line changed.";
const APPROVALS_RESET = "Approvals reset: new commits were pushed.";

function addedText(count: number): string {
  return `Added ${count} ${count === 1 ? "commit" : "commits"}.`;
}

// Commits the request gained: those between its base and the new head that the previous version did not already have.
async function addedCommitCount(tx: Tx, project: ProjectRow, previous: VersionRow | undefined, base: string | null, head: string): Promise<number> {
  const current = await repo.commitsBetween(tx, project.id, base, head);
  const before = previous === undefined ? [] : await repo.commitsBetween(tx, project.id, previous.base, previous.head);
  const known = new Set(before.map((commit) => commit.id));
  return current.filter((commit) => !known.has(commit.id)).length;
}

export async function onBranchPushed(tx: Tx, update: BranchUpdate): Promise<void> {
  const project = update.project;
  const asSource = await tx.q<MrRow>("SELECT * FROM merge_requests WHERE project_id = $1 AND source = $2 AND state <> 'merged' ORDER BY iid", [project.id, update.branch]);
  for (const request of asSource) await sourcePushed(tx, project, request, update);
  const asTarget = await tx.q<{ id: number }>("SELECT id FROM merge_requests WHERE project_id = $1 AND target = $2 AND state = 'opened' ORDER BY iid", [project.id, update.branch]);
  for (const request of asTarget) await refreshRequest(tx, project, request.id, { autoMerge: false, rulesMessage: true });
}

async function sourcePushed(tx: Tx, project: ProjectRow, mr: MrRow, update: BranchUpdate): Promise<void> {
  const latest = await latestVersion(tx, mr.id);
  if (latest?.head === update.newHead) return;
  const actor = update.actor.username;
  const targetHead = await repo.branchHead(tx, project.id, mr.target);
  const base = targetHead === null ? null : await repo.mergeBase(tx, project.id, targetHead, update.newHead);
  const number = (latest?.number ?? 0) + 1;
  await tx.q("INSERT INTO mr_versions (mr_id, number, base, head, start, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [mr.id, number, base, update.newHead, targetHead, now()]);

  const added = await addedCommitCount(tx, project, latest, base, update.newHead);
  if (added > 0) await insertSystemNote(tx, mr.id, actor, addedText(added));
  await tx.emit(project.id, "version", { iid: mr.iid, number }, added > 0 ? { say: [sayOnRequest(mr.iid, addedText(added))] } : {});

  const changes = await remapThreads(tx, mr, project.auto_resolve_outdated);
  for (const change of changes) {
    if (change.autoResolved) await insertSystemNote(tx, mr.id, actor, RESOLVED_BECAUSE_CHANGED);
    await tx.emit(
      project.id,
      "thread",
      { iid: mr.iid, thread_id: change.thread.id },
      {
        ...(change.autoResolved ? { say: [sayOnRequest(mr.iid, RESOLVED_BECAUSE_CHANGED)] } : {}),
        ...(change.thread.pending ? { restrictUser: change.thread.author_id } : {}),
      },
    );
  }

  const reset = project.reset_approvals_on_push && (await resetApprovals(tx, project, mr, actor));
  const canceled = await cancelAutoMerge(tx, mr, "new commits were pushed", actor);
  if (canceled !== null) await emitRequest(tx, project, mr.iid, "updated", [canceled]);
  await requestWebhook(tx, project, mr, "update", actor);
  await refreshRequest(tx, project, mr.id, { autoMerge: false, rulesMessage: !reset });
}

async function resetApprovals(tx: Tx, project: ProjectRow, mr: MrRow, actor: string): Promise<boolean> {
  const removed = await tx.q("DELETE FROM mr_approvals WHERE mr_id = $1 RETURNING user_id", [mr.id]);
  if (removed.length === 0) return false;
  await insertSystemNote(tx, mr.id, actor, APPROVALS_RESET);
  await tx.emit(project.id, "approvals", { iid: mr.iid }, { say: [sayOnRequest(mr.iid, APPROVALS_RESET)] });
  return true;
}
