// The request state machine: submission, routing, decisions, withdrawal, timers' effects and retirement.
// Every transition of a request goes through `moveTo`; every stage assignment through `assignStage`.
import { CARD_NAME_SQL } from "./availability.ts";
import type { Tx } from "./db.ts";
import { config } from "./config.ts";
import { deadlineFor } from "./deadlines.ts";
import { mintGrant } from "./grants.ts";
import { chooseAssignee, chooseOwner, planStages, stageReason } from "./routing.ts";
import { publishedNumbers } from "./rules.ts";
import { formatCalendarDate, formatStamp } from "../shared/dates.ts";
import {
  GRANT_STATUS_LABELS,
  OPEN_REQUEST_STATES,
  REQUEST_STATE_LABELS,
  REVIEW_ROLES,
  applicationOf,
  type AssetClass,
  type ConditionKind,
  type Decision,
  type Escalation,
  type RequestState,
  type Role,
  type StageKind,
} from "../shared/domain.ts";

export interface RequestRow {
  id: string;
  requester_id: string;
  asset_id: string;
  variant_id: string | null;
  application_class: string;
  territories: string[];
  campaign_starts_on: string;
  campaign_ends_on: string;
  cited_rules: string[];
  note: string;
  state: RequestState;
  submitted_at: string | null;
  deadline: string | null;
  escalation: Escalation | null;
  holder_id: string;
  rule_versions: Record<string, number>;
  requester_grants: string[];
  warned: boolean;
  breached: boolean;
  idempotency_key: string | null;
  fingerprint: string | null;
  created_at: string;
}

export interface StageRow {
  request_id: string;
  n: number;
  kind: StageKind;
  assignee_id: string | null;
  decision: Decision | null;
  decided_by: string | null;
  decided_at: string | null;
  comment: string | null;
}

interface Actor {
  id: string;
  role: Role | "system";
}

/** Legal transitions. Retirement also rejects drafts, routed requests and requests awaiting changes. */
const TRANSITIONS: Record<RequestState, readonly RequestState[]> = {
  draft: ["routed", "withdrawn", "rejected"],
  routed: ["under_review", "withdrawn", "rejected"],
  under_review: ["under_review", "approved", "rejected", "changes_requested", "withdrawn", "expired"],
  changes_requested: ["routed", "withdrawn", "rejected"],
  approved: ["granted"],
  granted: [],
  rejected: [],
  withdrawn: [],
  expired: [],
};

export const canMove = (from: RequestState, to: RequestState): boolean => TRANSITIONS[from].includes(to);

export async function loadRequest(tx: Tx, id: string, lock = false): Promise<RequestRow | undefined> {
  return tx.one<RequestRow>(`SELECT * FROM requests WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
}

export const loadStages = (tx: Tx, id: string): Promise<StageRow[]> =>
  tx.q<StageRow>("SELECT * FROM request_stages WHERE request_id = $1 ORDER BY n", [id]);

export const openStage = (stages: readonly StageRow[]): StageRow | undefined => stages.find((s) => s.decision === null);

const requestUrl = (id: string): string => `${config.publicUrl}/requests/${id}`;

async function moveTo(tx: Tx, req: RequestRow, to: RequestState, holderId: string): Promise<void> {
  if (!canMove(req.state, to)) throw new Error(`illegal request transition ${req.state} -> ${to}`);
  req.state = to;
  req.holder_id = holderId;
  await tx.q("UPDATE requests SET state = $2, holder_id = $3 WHERE id = $1", [req.id, to, holderId]);
}

/** Live messages for a request change: its page, the review queues and the requester's library. */
export function announce(tx: Tx, req: Pick<RequestRow, "id" | "requester_id">): void {
  tx.live({ type: "request.updated", requestId: req.id }, { roles: REVIEW_ROLES, principals: [req.requester_id] });
  tx.live({ type: "queue.updated" }, { roles: REVIEW_ROLES });
  tx.live({ type: "library.updated" }, { principals: [req.requester_id] });
}

interface Person {
  id: string;
  email: string;
  display_name: string;
}

export const personOf = async (tx: Tx, id: string): Promise<Person> =>
  (await tx.one<Person>("SELECT id, email, display_name FROM principals WHERE id = $1", [id]))!;

async function assetOf(tx: Tx, req: RequestRow): Promise<{ assetClass: AssetClass; cardName: string }> {
  const row = (await tx.one<{ class: AssetClass; card_name: string }>(
    `SELECT a.class, ${CARD_NAME_SQL} AS card_name
       FROM assets a LEFT JOIN variants v ON v.id = $2 WHERE a.id = $1`,
    [req.asset_id, req.variant_id],
  ))!;
  return { assetClass: row.class, cardName: row.card_name };
}


/** Materialises the stages a request needs (later stages stay unassigned until reached). */
async function ensureStages(tx: Tx, req: RequestRow): Promise<StageRow[]> {
  const existing = await loadStages(tx, req.id);
  if (existing.length > 0) return existing;
  const { assetClass } = await assetOf(tx, req);
  for (const [i, kind] of planStages(assetClass, req.application_class).entries()) {
    await tx.q("INSERT INTO request_stages (request_id, n, kind) VALUES ($1,$2,$3)", [req.id, i + 1, kind]);
  }
  return loadStages(tx, req.id);
}

/**
 * Assigns stage `n` to a reviewer and records `request.assigned`. `previousHolder` is null for the first open stage
 * after a submission. `preferred` is the reviewer of a reopened stage, kept while still eligible.
 */
async function assignStage(tx: Tx, req: RequestRow, stages: readonly StageRow[], n: number, previousHolder: string | null, preferred: string | null): Promise<void> {
  const stage = stages[n - 1];
  const earlier = stages.filter((s) => s.n < n && s.decided_by && s.decided_by !== "system").map((s) => s.decided_by!);
  let assigneeId = preferred;
  let escalated = false;
  if (assigneeId) {
    const stillEligible = await tx.one(
      "SELECT 1 FROM principals WHERE id = $1 AND role = $2 AND id <> $3 AND NOT (id = ANY($4))",
      [assigneeId, stage.kind === "legal" ? "legal_reviewer" : "brand_reviewer", req.requester_id, stage.kind === "brand" ? earlier : []],
    );
    if (!stillEligible) assigneeId = null;
  }
  if (!assigneeId) ({ assigneeId, escalated } = await chooseAssignee(tx, stage.kind, req.requester_id, earlier));
  const escalation: Escalation | null = escalated ? "no_eligible_reviewer" : null;
  await tx.q("UPDATE request_stages SET assignee_id = $3 WHERE request_id = $1 AND n = $2", [req.id, n, assigneeId]);
  const first = previousHolder === null;
  if (first) await moveTo(tx, req, "under_review", assigneeId);
  else {
    req.state = "under_review";
    req.holder_id = assigneeId;
    await tx.q("UPDATE requests SET holder_id = $2 WHERE id = $1", [req.id, assigneeId]);
  }
  req.escalation = escalation;
  await tx.q("UPDATE requests SET escalation = $2 WHERE id = $1", [req.id, escalation]);
  tx.audit({
    actorId: "system",
    actorRole: "system",
    action: "request.assigned",
    resourceType: "request",
    resourceId: req.id,
    requestId: req.id,
    before: first ? { state: "routed" } : { holder: previousHolder },
    after: { holder: assigneeId, ...(first ? { state: "under_review" } : {}), ...(escalated ? { escalation } : {}) },
  });
  const { assetClass, cardName } = await assetOf(tx, req);
  const assignee = await personOf(tx, assigneeId);
  const reason = stageReason(stages.map((s) => s.kind), n, assetClass, applicationOf(req.application_class)!.label);
  await tx.mail(
    assignee.email,
    `Review needed: ${req.id} ${cardName}`,
    `${reason}\nDue ${formatStamp(req.deadline!, config.timeZone)}\n\n${requestUrl(req.id)}\n`,
  );
}

/**
 * Submission and resubmission: stores the snapshot and the fresh deadline, routes the request and opens its first
 * undecided stage. `before` is the audit `before` of `request.submitted`.
 */
export async function submitRequest(tx: Tx, req: RequestRow, actor: Actor, before: Record<string, unknown> | null): Promise<void> {
  const versions = await publishedNumbers(tx);
  const ruleVersions = Object.fromEntries(req.cited_rules.map((rule) => [rule, versions.get(rule.split(".")[0]) ?? 0]));
  const grants = (await tx.q<{ id: string }>("SELECT id FROM grants WHERE holder_type = 'principal' AND holder_id = $1 ORDER BY id", [req.requester_id])).map((g) => g.id);
  req.submitted_at = tx.now;
  req.deadline = deadlineFor(tx.now, req.application_class);
  req.warned = false;
  req.breached = false;
  await tx.q(
    `UPDATE requests SET submitted_at = $2, deadline = $3, warned = false, breached = false, escalation = NULL, rule_versions = $4, requester_grants = $5 WHERE id = $1`,
    [req.id, req.submitted_at, req.deadline, JSON.stringify(ruleVersions), JSON.stringify(grants)],
  );
  await moveTo(tx, req, "routed", req.requester_id);
  tx.audit({ actorId: actor.id, actorRole: actor.role, action: "request.submitted", resourceType: "request", resourceId: req.id, requestId: req.id, before, after: { state: "routed" } });
  const stages = await ensureStages(tx, req);
  const stage = openStage(stages)!;
  await assignStage(tx, req, stages, stage.n, null, stage.assignee_id);
  announce(tx, req);
}

export async function withdrawRequest(tx: Tx, req: RequestRow, actor: Actor): Promise<void> {
  const before = { state: req.state };
  await moveTo(tx, req, "withdrawn", req.requester_id);
  tx.audit({ actorId: actor.id, actorRole: actor.role, action: "request.withdrawn", resourceType: "request", resourceId: req.id, requestId: req.id, before, after: { state: "withdrawn" } });
  announce(tx, req);
}

/** Resubmission: the stage that asked for changes reopens for the same reviewer, and stages follow the new application. */
export async function reopenForResubmission(tx: Tx, req: RequestRow): Promise<void> {
  await tx.q(
    `UPDATE request_stages SET decision = NULL, decided_by = NULL, decided_at = NULL, comment = NULL
      WHERE request_id = $1 AND decision = 'request_changes'`,
    [req.id],
  );
  const stages = await loadStages(tx, req.id);
  const { assetClass } = await assetOf(tx, req);
  const plan = planStages(assetClass, req.application_class);
  if (plan.length === stages.length && plan.every((kind, i) => kind === stages[i].kind)) return;
  const approved = stages.filter((s) => s.decision === "approve").length;
  await tx.q("DELETE FROM request_stages WHERE request_id = $1 AND decision IS NULL", [req.id]);
  for (const [i, kind] of plan.entries()) {
    if (i >= approved) await tx.q("INSERT INTO request_stages (request_id, n, kind) VALUES ($1,$2,$3)", [req.id, i + 1, kind]);
  }
}

async function decisionMail(tx: Tx, req: RequestRow, state: RequestState, lines: string): Promise<void> {
  const requester = await personOf(tx, req.requester_id);
  await tx.mail(requester.email, `Decision on ${req.id}: ${REQUEST_STATE_LABELS[state]}`, `${lines}\n\n${requestUrl(req.id)}\n`);
}

/** Records a stage decision and everything it causes: next stage, grant, state change, mail. */
export async function decideStage(tx: Tx, req: RequestRow, stages: readonly StageRow[], stage: StageRow, actor: Actor, decision: Decision, comment: string | null): Promise<void> {
  const previousHolder = req.holder_id;
  await tx.q("UPDATE request_stages SET decision = $3, decided_by = $4, decided_at = $5, comment = $6 WHERE request_id = $1 AND n = $2", [req.id, stage.n, decision, actor.id, tx.now, comment]);
  const decided = stages.map((s) => (s.n === stage.n ? { ...s, decision, decided_by: actor.id } : s));
  const next = decided.find((s) => s.decision === null);
  let to: RequestState = "under_review";
  if (decision === "reject") to = "rejected";
  else if (decision === "request_changes") to = "changes_requested";
  else if (!next) to = "granted";
  const record = (state: RequestState): Record<string, unknown> => ({ decision, stage: stage.n, state, ...(comment ? { comment } : {}) });
  tx.audit({ actorId: actor.id, actorRole: actor.role, action: "request.decided", resourceType: "request", resourceId: req.id, requestId: req.id, before: { state: "under_review" }, after: record(to) });

  if (to === "under_review") {
    await assignStage(tx, req, decided, next!.n, previousHolder, null);
  } else if (to === "granted") {
    await moveTo(tx, req, "approved", req.requester_id);
    await moveTo(tx, req, "granted", req.requester_id);
    const grant = await mintGrant(tx, req, actor);
    const { cardName } = await assetOf(tx, req);
    if (grant.status === "zero_length") {
      await decisionMail(tx, req, "granted", "This grant ended before it started, so nothing can be downloaded.");
    } else {
      const conditions = await tx.q<{ kind: ConditionKind; text: string }>("SELECT kind, text FROM grant_conditions WHERE grant_id = $1 ORDER BY position", [grant.id]);
      const requester = await personOf(tx, req.requester_id);
      await tx.mail(
        requester.email,
        `Granted: ${req.id} until ${formatCalendarDate(grant.not_after)}`,
        [`Grant ${grant.id} on ${cardName}`, `Ends ${formatCalendarDate(grant.not_after)}`, `Status: ${GRANT_STATUS_LABELS[grant.status]}`, ...conditions.map((c) => c.text), "", requestUrl(req.id), ""].join("\n"),
      );
    }
    tx.live({ type: "grant.updated", grantId: grant.id }, { roles: ["owner", "legal_reviewer"], principals: [req.requester_id] });
  } else {
    await moveTo(tx, req, to, req.requester_id);
    await decisionMail(tx, req, to, comment ?? "");
  }
  announce(tx, req);
}

/** Retirement: every open request on the asset or its variants is rejected by the system with the successor reason. */
export async function rejectOpenRequestsOnAsset(tx: Tx, assetId: string, successorName: string): Promise<void> {
  const comment = `Asset retired. Use ${successorName} instead.`;
  const open = await tx.q<{ id: string }>("SELECT id FROM requests WHERE asset_id = $1 AND state = ANY($2) ORDER BY id FOR UPDATE", [assetId, OPEN_REQUEST_STATES]);
  for (const { id } of open) {
    const req = (await loadRequest(tx, id))!;
    const stages = await ensureStages(tx, req);
    const stage = openStage(stages) ?? stages.find((s) => s.decision === "request_changes") ?? stages[0];
    await tx.q("UPDATE request_stages SET decision = 'reject', decided_by = 'system', decided_at = $3, comment = $4 WHERE request_id = $1 AND n = $2", [id, stage.n, tx.now, comment]);
    const before = { state: req.state };
    await moveTo(tx, req, "rejected", req.requester_id);
    tx.audit({
      actorId: "system",
      actorRole: "system",
      action: "request.decided",
      resourceType: "request",
      resourceId: id,
      requestId: id,
      before,
      after: { comment, decision: "reject", stage: stage.n, state: "rejected" },
    });
    await decisionMail(tx, req, "rejected", comment);
    announce(tx, req);
  }
}

/** Breach timer: the open stage moves to the owner with the fewest open stages. */
export async function escalateMissedDeadline(tx: Tx, req: RequestRow, dueAt: string): Promise<void> {
  const previous = await personOf(tx, req.holder_id);
  const owner = await chooseOwner(tx);
  const stage = openStage(await loadStages(tx, req.id))!;
  await tx.q("UPDATE request_stages SET assignee_id = $3 WHERE request_id = $1 AND n = $2", [req.id, stage.n, owner]);
  await tx.q("UPDATE requests SET holder_id = $2, escalation = 'deadline_missed', breached = true WHERE id = $1", [req.id, owner]);
  tx.audit({
    actorId: "system",
    actorRole: "system",
    action: "request.escalated",
    resourceType: "request",
    resourceId: req.id,
    requestId: req.id,
    before: { holder: previous.id },
    after: { escalation: "deadline_missed", holder: owner },
    occurredAt: dueAt,
  });
  const ownerPerson = await personOf(tx, owner);
  await tx.mail(ownerPerson.email, `Deadline missed: ${req.id} is now yours`, `Previous holder: ${previous.display_name}\nDue ${formatStamp(req.deadline!, config.timeZone)}\n\n${requestUrl(req.id)}\n`);
  announce(tx, req);
}

/** Warning timer: the current holder is mailed once per submission. */
export async function warnHolder(tx: Tx, req: RequestRow): Promise<void> {
  await tx.q("UPDATE requests SET warned = true WHERE id = $1", [req.id]);
  const holder = await personOf(tx, req.holder_id);
  await tx.mail(holder.email, `Deadline soon: ${req.id}`, `Due ${formatStamp(req.deadline!, config.timeZone)}\n\n${requestUrl(req.id)}\n`);
}

/** Ceiling timer: the request expires and the requester is told. */
export async function expireRequest(tx: Tx, req: RequestRow, dueAt: string): Promise<void> {
  await moveTo(tx, req, "expired", req.requester_id);
  tx.audit({ actorId: "system", actorRole: "system", action: "request.expired", resourceType: "request", resourceId: req.id, requestId: req.id, before: { state: "under_review" }, after: { state: "expired" }, occurredAt: dueAt });
  await decisionMail(tx, req, "expired", "The review window closed without a decision.");
  announce(tx, req);
}
