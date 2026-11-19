import type { Tx } from './db';
import { query } from './db';
import type { Config } from './config';
import { formatDay } from './datetime';
import type { ApplicationClass, ConditionKind, RequestState, Escalation, Decision as DecisionKind } from '../shared/domain';
import { grantWindow } from './grant-window';
import { appendAudit } from './audit';
import { queueMail, stageAssignedMail, warningMail, breachMail, decisionMail, zeroLengthMail, grantMail, expiredMail } from './mail';
import { stageKinds, stageReason, tierHours, nextGrantId, nextRequestId, conditionText, type ReviewerCandidate } from './requests-core';
import { notify } from './pglisten';
import { calendarDateOf } from './datetime';

export interface RequestRecord {
  id: string;
  requesterId: string;
  requesterEmail: string;
  requesterName: string;
  organisationName: string;
  assetId: string;
  assetClass: string;
  variantId: string | null;
  cardName: string;
  applicationClass: ApplicationClass;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: { identifier: string; version: number }[];
  note: string;
  state: RequestState;
  escalation: Escalation;
  holderId: string;
  submittedAt: Date | null;
  deadline: Date | null;
  deadlineSubmittedAt: Date | null;
}

export interface StageRecord {
  n: number;
  kind: 'brand' | 'legal';
  assigneeId: string | null;
  decision: DecisionKind | null;
  decidedAt: Date | null;
  comment: string | null;
}

export async function loadRequest(id: string): Promise<RequestRecord | null> {
  const rows = await query<{
    id: string;
    requester_id: string;
    requester_email: string;
    requester_name: string;
    organisation_name: string | null;
    asset_id: string;
    asset_class: string;
    variant_id: string | null;
    asset_name: string;
    variant_label: string | null;
    application_class: string;
    territories: string[];
    campaign_starts_on: string;
    campaign_ends_on: string;
    cited_rules: { identifier: string; version: number }[];
    note: string;
    state: string;
    escalation: Escalation;
    holder_id: string;
    submitted_at: Date | null;
    deadline: Date | null;
    deadline_submitted_at: Date | null;
  }>(
    `SELECT r.id, r.requester_id, p.email AS requester_email, p.display_name AS requester_name,
            o.name AS organisation_name, r.asset_id, a.class AS asset_class, r.variant_id, a.name AS asset_name,
            v.label AS variant_label, r.application_class, r.territories,
            r.campaign_starts_on::text, r.campaign_ends_on::text, r.cited_rules, r.note,
            r.state, r.escalation, r.holder_id, r.submitted_at, r.deadline, r.deadline_submitted_at
       FROM requests r
       JOIN principals p ON p.id = r.requester_id
       LEFT JOIN organisations o ON o.id = p.organisation_id
       JOIN assets a ON a.id = r.asset_id
       LEFT JOIN variants v ON v.id = r.variant_id
      WHERE r.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    organisationName: row.organisation_name ?? '',
    assetId: row.asset_id,
    assetClass: row.asset_class,
    variantId: row.variant_id,
    cardName: row.variant_id ? `${row.asset_name} — ${row.variant_label}` : row.asset_name,
    applicationClass: row.application_class as ApplicationClass,
    territories: row.territories,
    campaignStartsOn: row.campaign_starts_on,
    campaignEndsOn: row.campaign_ends_on,
    citedRules: row.cited_rules,
    note: row.note,
    state: row.state as RequestState,
    escalation: row.escalation,
    holderId: row.holder_id,
    submittedAt: row.submitted_at,
    deadline: row.deadline,
    deadlineSubmittedAt: row.deadline_submitted_at,
  };
}

export async function loadStages(requestId: string): Promise<StageRecord[]> {
  const rows = await query<{
    n: number;
    kind: string;
    assignee_id: string | null;
    decision: string | null;
    decided_at: Date | null;
    comment: string | null;
  }>(
    'SELECT n, kind, assignee_id, decision, decided_at, comment FROM request_stages WHERE request_id = $1 ORDER BY n',
    [requestId],
  );
  return rows.map((r) => ({
    n: r.n,
    kind: r.kind as 'brand' | 'legal',
    assigneeId: r.assignee_id,
    decision: (r.decision as DecisionKind | null) ?? null,
    decidedAt: r.decided_at,
    comment: r.comment,
  }));
}

export function openStage(stages: StageRecord[]): StageRecord | null {
  return stages.find((s) => s.decision === null) ?? null;
}

export async function createStages(
  tx: Tx,
  requestId: string,
  assetClass: string,
  applicationClass: ApplicationClass,
  stages: { kind: 'brand' | 'legal'; assigneeId: string | null }[],
): Promise<void> {
  for (let i = 0; i < stages.length; i++) {
    await tx.query(
      `INSERT INTO request_stages (request_id, n, kind, assignee_id, assigned_at) VALUES ($1,$2,$3,$4,$5)`,
      [requestId, i + 1, stages[i].kind, stages[i].assigneeId, null],
    );
  }
  void assetClass;
  void applicationClass;
}

export async function notifyRequest(tx: Tx, requestId: string, kind: string, extra?: Record<string, unknown>): Promise<void> {
  await notify(tx, JSON.stringify({ type: 'request.updated', requestId, kind, ...extra }));
  await notify(tx, JSON.stringify({ type: 'queue.updated' }));
  await notify(tx, JSON.stringify({ type: 'library.updated' }));
}

export async function submitRequest(
  tx: Tx,
  record: RequestRecord,
  now: Date,
  cfg: Config,
): Promise<void> {
  const deadline = new Date(now.getTime() + tierHours(record.applicationClass, cfg) * 3600000);
  const previousState = record.state;
  await tx.query(
    `UPDATE requests SET state = 'routed', submitted_at = $2, deadline = $3, deadline_submitted_at = $2,
        warning_sent_at = NULL, breach_sent_at = NULL, expiry_done_at = NULL, updated_at = $2
      WHERE id = $1`,
    [record.id, now, deadline],
  );
  await tx.query(
    `INSERT INTO timers (request_id, kind, due_at) VALUES ($1,'warning',$2),($1,'breach',$3),($1,'ceiling',$4)
       ON CONFLICT (request_id, kind) DO UPDATE SET due_at = EXCLUDED.due_at, done_at = NULL`,
    [
      record.id,
      new Date(now.getTime() + (tierHours(record.applicationClass, cfg) * 3600000 * cfg.deadlineWarningPercent) / 100),
      deadline,
      new Date(now.getTime() + tierHours(record.applicationClass, cfg) * 3600000 * cfg.expiryCeilingMultiplier),
    ],
  );
  await appendAudit(tx, {
    occurredAt: now,
    actorId: record.requesterId,
    actorRole: (await roleOf(tx, record.requesterId)) ?? 'agency',
    action: 'request.submitted',
    resourceType: 'request',
    resourceId: record.id,
    requestId: record.id,
    before: previousState === 'draft' ? { state: 'draft' } : previousState === 'changes_requested' ? { state: 'changes_requested' } : null,
    after: { state: 'routed' },
    outcome: 'success',
  });
  await routeToStage(tx, record.id, now, cfg, null);
}

export async function routeToStage(
  tx: Tx,
  requestId: string,
  now: Date,
  cfg: Config,
  previousHolderId: string | null,
): Promise<void> {
  const record = await loadRequestTx(tx, requestId);
  const stages = await loadStagesTx(tx, requestId);
  const open = stages.find((s) => s.decision === null);
  if (!open) return;
  const kinds = stageKinds(await assetClassOf(tx, record.assetId), record.applicationClass);
  const decided = stages.filter((s) => s.decision !== null);
  const excludeIds = [record.requesterId, ...decided.map((s) => s.assigneeId ?? '').filter(Boolean)];
  const candidates = await eligibleTx(tx, open.kind, excludeIds);
  const chosen = pickLeastLoaded(candidates);
  let escalation: Escalation = null;
  let assigneeId = chosen?.id ?? null;
  if (!assigneeId) {
    const owner = await leastLoadedOwnerTx(tx, excludeIds);
    assigneeId = owner?.id ?? null;
    if (assigneeId) escalation = 'no_eligible_reviewer';
  }
  const reason = stageReason(kinds, open.n, record.applicationClass);
  await tx.query(
    `UPDATE request_stages SET assignee_id = $2, assigned_at = $3 WHERE request_id = $1 AND n = $4`,
    [requestId, assigneeId, now, open.n],
  );
  const previous = previousHolderId ?? record.holderId;
  const before: Record<string, unknown> = previousHolderId ? { holder: previous } : { state: 'routed' };
  const after: Record<string, unknown> = previousHolderId
    ? { holder: assigneeId }
    : { holder: assigneeId, state: 'under_review' };
  if (escalation) {
    after['escalation'] = escalation;
  }
  await tx.query(
    `UPDATE requests SET state = 'under_review', holder_id = $2, escalation = $3, updated_at = $4 WHERE id = $1`,
    [requestId, assigneeId ?? record.requesterId, escalation, now],
  );
  await appendAudit(tx, {
    occurredAt: now,
    actorId: 'system',
    actorRole: 'system',
    action: 'request.assigned',
    resourceType: 'request',
    resourceId: requestId,
    requestId,
    before,
    after,
    outcome: 'success',
  });
  await setStagesFromState(tx, requestId, now);
  if (assigneeId) {
    const assignee = await principalTx(tx, assigneeId);
    if (assignee) {
      await queueMail(
        tx,
        stageAssignedMail(cfg, requestId, record.cardName, reason, record.deadline ?? now, assignee.email),
        now,
      );
    }
  }
  void formatDay;
}

async function setStagesFromState(tx: Tx, requestId: string, now: Date): Promise<void> {
  await tx.query('UPDATE requests SET updated_at = $2 WHERE id = $1', [requestId, now]);
}

async function roleOf(tx: Tx, principalId: string): Promise<string | null> {
  const rows = await tx.query<{ role: string }>('SELECT role FROM principals WHERE id = $1', [principalId]);
  return rows.rows[0]?.role ?? null;
}

async function assetClassOf(tx: Tx, assetId: string): Promise<string> {
  const rows = await tx.query<{ class: string }>('SELECT class FROM assets WHERE id = $1', [assetId]);
  return rows.rows[0]?.class ?? '';
}

async function principalTx(tx: Tx, id: string): Promise<{ email: string; display_name: string } | null> {
  const rows = await tx.query<{ email: string; display_name: string }>(
    'SELECT email, display_name FROM principals WHERE id = $1',
    [id],
  );
  return rows.rows[0] ?? null;
}

async function loadRequestTx(tx: Tx, id: string): Promise<RequestRecord> {
  const rows = await tx.query<{
    id: string;
    requester_id: string;
    asset_id: string;
    variant_id: string | null;
    application_class: string;
    state: string;
    holder_id: string;
    deadline: Date | null;
  }>(
    `SELECT id, requester_id, asset_id, variant_id, application_class, state, holder_id, deadline
       FROM requests WHERE id = $1`,
    [id],
  );
  const row = rows.rows[0];
  const assetName = await tx.query<{ name: string; label: string | null; class: string }>(
    `SELECT a.name, a.class, v.label FROM assets a LEFT JOIN variants v ON v.id = $2 WHERE a.id = $1`,
    [row.asset_id, row.variant_id],
  );
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterEmail: '',
    requesterName: '',
    organisationName: '',
    assetId: row.asset_id,
    assetClass: assetName.rows[0]?.class ?? '',
    variantId: row.variant_id,
    cardName: row.variant_id ? `${assetName.rows[0]?.name ?? ''} — ${assetName.rows[0]?.label ?? ''}` : assetName.rows[0]?.name ?? '',
    applicationClass: row.application_class as ApplicationClass,
    territories: [],
    campaignStartsOn: '',
    campaignEndsOn: '',
    citedRules: [],
    note: '',
    state: row.state as RequestState,
    escalation: null,
    holderId: row.holder_id,
    submittedAt: null,
    deadline: row.deadline,
    deadlineSubmittedAt: null,
  };
}

async function loadStagesTx(tx: Tx, requestId: string): Promise<StageRecord[]> {
  const rows = await tx.query<{
    n: number;
    kind: string;
    assignee_id: string | null;
    decision: string | null;
    decided_at: Date | null;
    comment: string | null;
  }>(
    'SELECT n, kind, assignee_id, decision, decided_at, comment FROM request_stages WHERE request_id = $1 ORDER BY n',
    [requestId],
  );
  return rows.rows.map((r) => ({
    n: r.n,
    kind: r.kind as 'brand' | 'legal',
    assigneeId: r.assignee_id,
    decision: (r.decision as DecisionKind | null) ?? null,
    decidedAt: r.decided_at,
    comment: r.comment,
  }));
}

async function eligibleTx(tx: Tx, kind: 'brand' | 'legal', excludeIds: string[]): Promise<ReviewerCandidate[]> {
  const role = kind === 'brand' ? 'brand_reviewer' : 'legal_reviewer';
  const rows = await tx.query<{ id: string; display_name: string; open_stages: string }>(
    `SELECT p.id, p.display_name,
            (SELECT COUNT(*) FROM request_stages rs
               JOIN requests r ON r.id = rs.request_id
              WHERE rs.assignee_id = p.id AND rs.decision IS NULL AND r.state = 'under_review')::text AS open_stages
       FROM principals p
      WHERE p.role = $1 AND p.id <> ALL($2) AND p.display_name IS NOT NULL`,
    [role, excludeIds],
  );
  return rows.rows.map((r) => ({ id: r.id, displayName: r.display_name, openStages: Number(r.open_stages) }));
}

async function leastLoadedOwnerTx(tx: Tx, excludeIds: string[]): Promise<ReviewerCandidate | null> {
  const rows = await tx.query<{ id: string; display_name: string; open_stages: string }>(
    `SELECT p.id, p.display_name,
            (SELECT COUNT(*) FROM request_stages rs
               JOIN requests r ON r.id = rs.request_id
              WHERE rs.assignee_id = p.id AND rs.decision IS NULL AND r.state = 'under_review')::text AS open_stages
       FROM principals p
      WHERE p.role = 'owner' AND p.id <> ALL($1)`,
    [excludeIds],
  );
  if (rows.rows.length === 0) return null;
  return { id: rows.rows[0].id, displayName: rows.rows[0].display_name, openStages: Number(rows.rows[0].open_stages) };
}

function pickLeastLoaded(candidates: ReviewerCandidate[]): ReviewerCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.openStages !== b.openStages) return a.openStages - b.openStages;
    return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0;
  });
  return sorted[0];
}

export { grantWindow, conditionText, calendarDateOf };
