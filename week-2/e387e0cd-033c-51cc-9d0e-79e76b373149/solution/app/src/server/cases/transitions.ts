// The case state machine: every legal transition and its refusal, in one place.
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { one, rows, type Db } from "../db.js";
import { refuse } from "../errors.js";
import type { Mail } from "../smtp.js";
import type { Workspace } from "../workspaces.js";
import { formatDateTime, stamp } from "../../shared/format.js";
import { continueAfterScreening, sendData } from "./decide.js";
import { CASE_SELECT, effectiveStatus, isOpen, releaseAllowed, type CaseRow } from "./record.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

/** A case of this workspace, or a 404 exactly like an unknown id. `forUpdate` locks it for the transaction. */
export async function findCase(db: Db, workspace: Workspace, id: string, forUpdate = false): Promise<CaseRow> {
  const found = isUuid(id)
    ? await one<CaseRow>(db, `${CASE_SELECT} WHERE c.id = $1 AND c.workspace_slug = $2${forUpdate ? " FOR UPDATE OF c" : ""}`,
      [id, workspace.slug])
    : null;
  if (!found) throw refuse.notFound();
  return found;
}

export async function listCases(db: Db, workspace: Workspace, where: string, params: unknown[] = []): Promise<CaseRow[]> {
  return rows<CaseRow>(db, `${CASE_SELECT} WHERE c.workspace_slug = $1 AND ${where} ORDER BY c.created_at DESC, c.number DESC`,
    [workspace.slug, ...params]);
}

const closedCopy = () => refuse.conflict("case_closed", "This case is already closed.");

async function close(db: PoolClient, c: CaseRow, outcome: "released" | "returned", nowMs: number): Promise<void> {
  const closedAt = stamp(nowMs);
  await db.query(
    `UPDATE cases SET status = $2, outcome = $2, closed_at = $3, erasure_due_at = $4,
       claim_member_id = NULL, claim_member_name = NULL, claimed_at = NULL, claim_ends_at = NULL
     WHERE id = $1`,
    [c.id, outcome, closedAt, new Date(closedAt.getTime() + config.timers.retention * 1000)]);
}

export async function release(db: PoolClient, c: CaseRow, nowMs: number): Promise<void> {
  if (!isOpen(c.status)) throw closedCopy();
  if (!releaseAllowed(c, nowMs)) throw refuse.conflict("release_not_allowed", "This withdrawal can't be released yet.");
  await close(db, c, "released", nowMs);
}

export async function returnWithdrawal(db: PoolClient, c: CaseRow, reason: string, nowMs: number): Promise<void> {
  await close(db, c, "returned", nowMs);
  await db.query("UPDATE cases SET return_reason = $2 WHERE id = $1", [c.id, reason]);
}

export function assertOpen(c: CaseRow): void {
  if (!isOpen(c.status)) throw closedCopy();
}

export function assertReasonNeeded(c: CaseRow, nowMs: number): void {
  if (effectiveStatus(c, nowMs) !== "no_response") {
    throw refuse.conflict("reason_not_needed", "A reason is needed only after No response.");
  }
}

export async function recordReleaseReason(db: PoolClient, c: CaseRow, text: string, by: string, nowMs: number): Promise<void> {
  await db.query(
    "UPDATE cases SET status = 'no_response', release_reason_text = $2, release_reason_by = $3, release_reason_at = $4 WHERE id = $1",
    [c.id, text, by, stamp(nowMs)]);
}

export function assertOwnershipPending(c: CaseRow): void {
  if (c.status !== "awaiting_ownership") throw refuse.conflict("ownership_not_pending", "Ownership is not pending on this case.");
}

export async function recordOwnership(db: PoolClient, c: CaseRow, confirmedOn: string, by: string, nowMs: number): Promise<void> {
  await db.query(
    `UPDATE cases SET status = 'cleared', ownership_confirmed_on = $2, ownership_recorded_at = $3, ownership_recorded_by = $4
      WHERE id = $1`, [c.id, confirmedOn, stamp(nowMs), by]);
}

/** Who decided and when, for the stale-decision refusal. */
export function alreadyDecided(c: CaseRow, workspace: Workspace) {
  return refuse.conflict("already_decided",
    `Already decided by ${c.decided_by} at ${formatDateTime(c.decided_at!.getTime(), workspace.timeZone, workspace.city)}.`);
}

/** Accept continues with steps 4 to 6 at the decision instant under the rules recorded at creation; Reject returns. */
export async function decideReview(db: PoolClient, workspace: Workspace, c: CaseRow, accept: boolean, reason: string, by: string,
  nowMs: number): Promise<Mail | null> {
  const decidedAt = stamp(nowMs);
  await db.query(
    `UPDATE cases SET decision = $2, decision_reason = $3, decided_by = $4, decided_at = $5,
       claim_member_id = NULL, claim_member_name = NULL, claimed_at = NULL, claim_ends_at = NULL WHERE id = $1`,
    [c.id, accept ? "accept" : "reject", reason, by, decidedAt]);
  if (!accept) {
    await close(db, c, "returned", nowMs);
    return null;
  }
  const decided = c.decided_under;
  const next = continueAfterScreening(c.fiat_value_cents, {
    ...decided,
    thresholdCents: decided.thresholdCents === null ? null : BigInt(decided.thresholdCents),
    rateCents: BigInt(decided.rateCents),
    confirmationLimitCents: BigInt(decided.confirmationLimitCents),
  });
  await db.query("UPDATE cases SET route = $2, status = $3 WHERE id = $1", [c.id, next.route, next.status]);
  if (next.route === "below_threshold") return null;
  return sendData(db, workspace, { ...c, counterparty_id: c.counterparty_id! }, next.route, nowMs);
}

/** The one rule for accepting an answer, by network message or request page: open, and no answer recorded yet. */
export function answerExpected(c: CaseRow, nowMs: number): boolean {
  const status = effectiveStatus(c, nowMs);
  const waiting = status === "awaiting_answer" || status === "no_response";
  const sunrise = c.route === "sunrise" && status === "cleared";
  return c.answer_decision === null && (waiting || sunrise);
}

type AnswerOutcome = "accepted" | "rejected" | "late";

/** Records an expected answer: on time it decides the case, at or after the due instant it is kept as late. */
export async function applyAnswer(db: PoolClient, c: CaseRow, decision: "accepted" | "rejected", via: "network" | "request_page",
  nowMs: number): Promise<AnswerOutcome> {
  if (!answerExpected(c, nowMs)) throw refuse.conflict("answer_not_expected", "This case is not waiting for your answer.");
  const status = effectiveStatus(c, nowMs);
  const late = status === "no_response";
  const next = late ? "no_response" : status === "cleared" ? "cleared" : decision;
  await db.query(
    "UPDATE cases SET answer_decision = $2, answer_at = $3, answer_late = $4, answer_via = $5, status = $6 WHERE id = $1",
    [c.id, decision, stamp(nowMs), late, via, next]);
  return late ? "late" : decision;
}

/** Timed work: from the due instant on, a waiting case is recorded as No response. */
export async function markNoResponse(db: Db): Promise<void> {
  await db.query("UPDATE cases SET status = 'no_response' WHERE status = 'awaiting_answer' AND answer_due_at <= now()");
}
