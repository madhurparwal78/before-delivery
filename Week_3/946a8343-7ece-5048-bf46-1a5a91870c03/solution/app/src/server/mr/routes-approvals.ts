// Approving and revoking an approval.
import { intParam, json, type Router } from "../http.ts";
import { withTx, type Tx } from "../db.ts";
import { audit } from "../audit.ts";
import { now } from "../clock.ts";
import { denied, staleHead, wrongState } from "../errors.ts";
import type { ProjectRow, UserRow } from "../access.ts";
import { refreshRequest } from "./engine.ts";
import { evaluateRequest } from "./evaluate.ts";
import { requestWebhook } from "./notify.ts";
import { bodyRecord, optionalString } from "./input.ts";
import { approvedAnnouncement, mayApprove, missingApprovals } from "./rules.ts";
import { ALREADY_MERGED, insertSystemNote, lockedRequest, sayOnRequest, type MrRow } from "./store.ts";
import { approvalsView, type ApprovalsView } from "./view.ts";

async function recordAudit(tx: Tx, project: ProjectRow, mr: MrRow, actor: string, added: boolean): Promise<void> {
  const before = added ? null : { user: actor };
  const after = added ? { user: actor } : null;
  await audit(tx, { projectId: project.id, actor, action: added ? "approval.add" : "approval.remove", target: `${project.path}!${mr.iid}`, before, after });
}

async function approve(tx: Tx, project: ProjectRow, mr: MrRow, user: UserRow, sha: string | undefined): Promise<ApprovalsView> {
  if (mr.state === "merged") throw wrongState(ALREADY_MERGED);
  if (mr.author_id === user.id && !project.author_can_approve) {
    throw denied("author_cannot_approve", "Authors can't approve their own merge request.");
  }
  const before = await evaluateRequest(tx, project, mr, { id: user.id, username: user.username });
  if (!mayApprove(before.specs, user.username)) throw denied("not_eligible", "You aren't eligible to approve this merge request.");
  if (sha !== before.sourceHead) throw staleHead();
  if (before.approvedBy.includes(user.username)) return approvalsView(before);

  await tx.q("INSERT INTO mr_approvals (mr_id, user_id, created_at) VALUES ($1, $2, $3)", [mr.id, user.id, now()]);
  await insertSystemNote(tx, mr.id, user.username, `Approved by @${user.username}.`);
  await recordAudit(tx, project, mr, user.username, true);
  const after = await evaluateRequest(tx, project, mr, { id: user.id, username: user.username });
  await tx.emit(project.id, "approvals", { iid: mr.iid }, { say: [sayOnRequest(mr.iid, approvedAnnouncement(missingApprovals(after.rules)))] });
  await requestWebhook(tx, project, mr, "approve", user.username);
  await refreshRequest(tx, project, mr.id, { autoMerge: true, rulesMessage: false });
  return approvalsView(after);
}

async function revoke(tx: Tx, project: ProjectRow, mr: MrRow, user: UserRow): Promise<ApprovalsView> {
  if (mr.state === "merged") throw wrongState(ALREADY_MERGED);
  const removed = await tx.q("DELETE FROM mr_approvals WHERE mr_id = $1 AND user_id = $2 RETURNING user_id", [mr.id, user.id]);
  if (removed.length > 0) {
    const text = `Revoked approval by @${user.username}.`;
    await insertSystemNote(tx, mr.id, user.username, text);
    await recordAudit(tx, project, mr, user.username, false);
    await tx.emit(project.id, "approvals", { iid: mr.iid }, { say: [sayOnRequest(mr.iid, text)] });
    await refreshRequest(tx, project, mr.id, { autoMerge: false, rulesMessage: false });
  }
  return approvalsView(await evaluateRequest(tx, project, mr));
}

export function registerApprovalRoutes(router: Router): void {
  router.post("/api/projects/:id/merge_requests/:iid/approve", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "approve");
      const view = await approve(tx, project, mr, ctx.user, optionalString(bodyRecord(ctx.body), "sha"));
      return json(200, { ...view, seq: await tx.currentSeq(project.id) });
    });
  }, { idempotent: true });

  router.delete("/api/projects/:id/merge_requests/:iid/approve", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "approve");
      const view = await revoke(tx, project, mr, ctx.user);
      return json(200, { ...view, seq: await tx.currentSeq(project.id) });
    });
  });
}
