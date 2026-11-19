/** The approval state machine: requested goes to approved, changes_requested or rejected, once. */
import { randomUUID } from "node:crypto";
import { forbidden, ApiError, invalid, notFound } from "./http.js";
import { addInboxItem } from "./inbox.js";
import { now } from "./clock.js";
import { lockProject, type Tx } from "./db.js";
import { publish } from "./events.js";
import { personName } from "./access.js";
import { fireApproval, newChain } from "./rules.js";
import { addHistory, getTaskRow, loadProject } from "./tasks.js";
import { finishChain } from "./workflow.js";

interface Where { projectId: string; teamId: string }

const DECISIONS = new Map([
  ["approve", { status: "approved", verb: "approved" }],
  ["request_changes", { status: "changes_requested", verb: "requested changes on" }],
  ["reject", { status: "rejected", verb: "rejected" }],
]);

export async function requestApproval(tx: Tx, where: Where, taskId: string, requesterId: string, body: Record<string, unknown>) {
  await lockProject(tx, where.projectId);
  const latest = await tx.query<{ status: string }>("SELECT status FROM approvals WHERE task_id = $1 ORDER BY seq DESC LIMIT 1", [taskId]);
  if (latest.rows[0]?.status === "requested") throw new ApiError(409, { error: "already_requested" });
  const member = typeof body.approverId === "string"
    ? await tx.query("SELECT 1 FROM memberships WHERE team_id = $1 AND person_id = $2", [where.teamId, body.approverId]) : null;
  if (!member?.rowCount || typeof body.approverId !== "string") throw invalid({ approverId: "Choose a member of this team" });
  const id = randomUUID();
  const instant = await now(tx);
  const task = await getTaskRow(tx, taskId);
  await tx.query("INSERT INTO approvals (id, task_id, approver_id, requester_id, status, created_at) VALUES ($1,$2,$3,$4,'requested',$5)",
    [id, taskId, body.approverId, requesterId, instant]);
  await addInboxItem(tx, { personId: body.approverId, text: `Approval requested: ${task.name}`, taskId, kind: "approval_request", approvalId: id }, instant);
  await addHistory(tx, taskId, `${await personName(tx, requesterId)} requested approval`, instant);
  await publish(tx, { t: "approval", team: where.teamId, project: where.projectId, task: taskId });
  return { status: "requested", approverId: body.approverId };
}

/** Error order: not found, forbidden (not the approver), conflict (already decided), then field errors. */
export async function decide(tx: Tx, where: Where, taskId: string, approverId: string, raw: unknown, readBody: (raw: unknown) => Record<string, unknown>) {
  await lockProject(tx, where.projectId);
  const latest = await tx.query<{ id: string; status: string; approver_id: string; requester_id: string }>(
    "SELECT id, status, approver_id, requester_id FROM approvals WHERE task_id = $1 ORDER BY seq DESC LIMIT 1 FOR UPDATE", [taskId]);
  const approval = latest.rows[0];
  if (!approval) throw notFound();
  if (approval.approver_id !== approverId) throw forbidden();
  if (approval.status !== "requested") throw new ApiError(409, { error: "already_decided" });
  const body = readBody(raw);
  const errors: Record<string, string> = {};
  const decision = typeof body.decision === "string" ? DECISIONS.get(body.decision) : undefined;
  if (!decision) errors.decision = "Choose a decision";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length > 500) errors.comment = "Comment must be 500 characters or fewer";
  else if (decision && decision.status !== "approved" && !comment) errors.comment = "Add a comment for this decision";
  if (!decision || Object.keys(errors).length) throw invalid(errors);
  const instant = await now(tx);
  await tx.query("UPDATE approvals SET status = $2, comment = $3 WHERE id = $1", [approval.id, decision.status, comment || null]);
  const task = await getTaskRow(tx, taskId);
  const approver = await personName(tx, approverId);
  await addInboxItem(tx, { personId: approval.requester_id, text: `${approver} ${decision.verb} ${task.name}`, taskId, kind: "decision" }, instant);
  await addHistory(tx, taskId, `${approver} ${decision.verb} this task`, instant);
  const chain = await newChain(tx, await loadProject(tx, where.projectId), instant);
  chain.touched.add(taskId);
  await fireApproval(tx, chain, task);
  await finishChain(tx, chain);
  await publish(tx, { t: "approval", team: where.teamId, project: where.projectId, task: taskId });
  return { status: decision.status };
}
