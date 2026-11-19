import {
  APPLICATION_LABELS,
  DECISION_LABELS,
  GRANT_STATUS_LABELS,
  PROOF_STATUS_LABELS,
  REQUEST_STATE_LABELS,
} from '../../shared/labels.js';
import type {
  ApplicationClass,
  Decision,
  Escalation,
  GrantCap,
  RequestDetail,
  RequestState,
  StageKind,
} from '../../shared/types.js';
import { appendAudit } from '../audit.js';
import { config } from '../config.js';
import { nextCounter, paddedId, type Queryable } from '../db.js';
import { computeGrantWindow } from '../domain/grantWindow.js';
import { leastLoaded, planStages, stageLabel, stageReason } from '../domain/routing.js';
import { OPEN_REQUEST_STATES } from '../domain/transitions.js';
import type { PrincipalRecord, RequestRecord, StageRecord } from '../domain/records.js';
import { enqueueMail } from '../mail.js';
import { repo } from '../repo.js';
import { businessDate, formatDisplayDate } from '../time.js';
import { EVERYONE, REVIEWERS, publish } from '../live.js';
import { loadCard, grantSummaryWith } from './library.js';
import { notices } from './notices.js';
import { ruleStatuses } from './rules.js';
import { cancelTimers, scheduleTimers } from './timers.js';

const STANDARD: ApplicationClass[] = ['internal_comms', 'social', 'press_article'];
const EXTENDED: ApplicationClass[] = ['event', 'film'];

export function deadlineHoursFor(applicationClass: ApplicationClass): number {
  if (STANDARD.includes(applicationClass)) return config.deadlineHoursStandard;
  if (EXTENDED.includes(applicationClass)) return config.deadlineHoursExtended;
  return config.deadlineHoursLegal;
}

export function openStageOf(stages: StageRecord[]): StageRecord | null {
  return stages.find((stage) => stage.decision === null) ?? null;
}

export async function publishRequestChange(
  tx: Queryable,
  request: RequestRecord,
): Promise<void> {
  await publish(tx, { type: 'request.updated', requestId: request.id }, {
    principalIds: [request.requesterId, request.holderId],
    roles: REVIEWERS,
  });
  await publish(tx, { type: 'queue.updated' }, { roles: REVIEWERS });
  await publish(tx, { type: 'library.updated' }, EVERYONE);
}

interface AssignmentResult {
  assigneeId: string;
  escalated: boolean;
}

async function assignStage(
  tx: Queryable,
  request: RequestRecord,
  stages: StageRecord[],
  stageNumber: number,
): Promise<AssignmentResult> {
  const stage = stages[stageNumber - 1]!;
  const role = stage.kind === 'brand' ? 'brand_reviewer' : 'legal_reviewer';
  const decidedBy = stages
    .filter((candidate) => candidate.decidedBy !== null)
    .map((candidate) => candidate.decidedBy!);

  const reviewers = await repo.principalsByRole(role, tx);
  const openCounts = await openStageCounts(tx);
  const eligible = reviewers
    .filter((reviewer) => reviewer.id !== request.requesterId && !decidedBy.includes(reviewer.id))
    .map((reviewer) => ({
      id: reviewer.id,
      displayName: reviewer.displayName,
      openStages: openCounts.get(reviewer.id) ?? 0,
    }));

  const picked = leastLoaded(eligible);
  if (picked) return { assigneeId: picked.id, escalated: false };

  const owners = await repo.principalsByRole('owner', tx);
  const owner = leastLoaded(
    owners.map((candidate) => ({
      id: candidate.id,
      displayName: candidate.displayName,
      openStages: openCounts.get(candidate.id) ?? 0,
    })),
  );
  if (!owner) throw new Error('No owner is available to take the stage');
  return { assigneeId: owner.id, escalated: true };
}

export async function openStageCounts(tx: Queryable): Promise<Map<string, number>> {
  const result = await tx.query<{ assignee_id: string; count: number }>(
    `select s.assignee_id, count(*)::bigint as count from request_stages s
     join requests r on r.id = s.request_id
     where s.decision is null and r.state = 'under_review' and s.assignee_id is not null
     group by s.assignee_id`,
  );
  return new Map(result.rows.map((row) => [row.assignee_id, row.count]));
}

interface RouteOptions {
  reuseAssignee: boolean;
}

/** Puts the request's open stage in front of a reviewer and records it. */
export async function routeOpenStage(
  tx: Queryable,
  request: RequestRecord,
  now: Date,
  previousHolderId: string | null,
  options: RouteOptions,
): Promise<RequestRecord> {
  const stages = await repo.stages(request.id, tx);
  const stage = openStageOf(stages);
  if (!stage) throw new Error(`Request ${request.id} has no open stage to route`);

  let assigneeId = stage.assigneeId;
  let escalated = false;
  if (!options.reuseAssignee || assigneeId === null || !(await stillEligible(tx, request, stages, assigneeId))) {
    const assignment = await assignStage(tx, request, stages, stage.n);
    assigneeId = assignment.assigneeId;
    escalated = assignment.escalated;
  }

  await tx.query('update request_stages set assignee_id = $1 where request_id = $2 and n = $3', [
    assigneeId,
    request.id,
    stage.n,
  ]);
  const escalation: Escalation = escalated ? 'no_eligible_reviewer' : null;
  await tx.query('update requests set state = $1, holder_id = $2, escalation = $3 where id = $4', [
    'under_review',
    assigneeId,
    escalation,
    request.id,
  ]);

  const actor = await repo.principal(assigneeId, tx);
  const after: Record<string, string> = previousHolderId === null
    ? { holder: assigneeId, state: 'under_review' }
    : { holder: assigneeId };
  if (escalated) after['escalation'] = 'no_eligible_reviewer';
  await appendAudit(tx, {
    occurredAt: now,
    actorId: 'system',
    actorRole: 'system',
    action: 'request.assigned',
    resourceType: 'request',
    resourceId: request.id,
    requestId: request.id,
    before: previousHolderId === null ? { state: 'routed' } : { holder: previousHolderId },
    after,
    outcome: 'success',
  });

  const card = await loadCard(request.assetId, request.variantId, tx);
  const plan = planStages(request.applicationClass, card!.asset.assetClass);
  if (actor && request.deadline) {
    await enqueueMail(
      tx,
      notices.stageAssigned(
        actor.email,
        request.id,
        card!.cardName,
        stageReason(stage.n, plan, request.applicationClass, card!.asset.assetClass),
        request.deadline,
      ),
      now,
    );
  }

  return { ...request, state: 'under_review', holderId: assigneeId, escalation };
}

async function stillEligible(
  tx: Queryable,
  request: RequestRecord,
  stages: StageRecord[],
  assigneeId: string,
): Promise<boolean> {
  const stage = openStageOf(stages)!;
  const principal = await repo.principal(assigneeId, tx);
  if (!principal) return false;
  const role = stage.kind === 'brand' ? 'brand_reviewer' : 'legal_reviewer';
  if (principal.role !== role) return false;
  if (principal.id === request.requesterId) return false;
  return !stages.some((candidate) => candidate.decidedBy === assigneeId);
}

export interface SubmitContext {
  /** `new` is a first submission, which records no previous state. */
  previousState: 'new' | 'draft' | 'changes_requested';
  reuseAssignee: boolean;
}

/** Submission and resubmission share this path: deadline, routing, timers. */
export async function submitRequest(
  tx: Queryable,
  request: RequestRecord,
  actor: PrincipalRecord,
  now: Date,
  context: SubmitContext,
): Promise<RequestRecord> {
  const hours = deadlineHoursFor(request.applicationClass);
  const deadline = new Date(now.getTime() + hours * 3_600_000);
  const submissionSeq = request.submissionSeq + 1;

  await tx.query(
    `update requests set state = 'routed', submitted_at = $1, deadline = $2, submission_seq = $3,
       escalation = null, holder_id = $4 where id = $5`,
    [now, deadline, submissionSeq, request.requesterId, request.id],
  );

  await appendAudit(tx, {
    occurredAt: now,
    actorId: actor.id,
    actorRole: actor.role,
    action: 'request.submitted',
    resourceType: 'request',
    resourceId: request.id,
    requestId: request.id,
    before: context.previousState === 'new' ? null : { state: context.previousState },
    after: { state: 'routed' },
    outcome: 'success',
  });

  const routed: RequestRecord = {
    ...request,
    state: 'routed',
    submittedAt: now,
    deadline,
    submissionSeq,
    holderId: request.requesterId,
    escalation: null,
  };

  await cancelTimers(tx, request.id);
  await scheduleTimers(tx, routed, now, hours);

  return routeOpenStage(tx, routed, now, null, { reuseAssignee: context.reuseAssignee });
}

export async function createStages(
  tx: Queryable,
  requestId: string,
  kinds: StageKind[],
): Promise<void> {
  for (const [index, kind] of kinds.entries()) {
    await tx.query('insert into request_stages (request_id, n, kind) values ($1, $2, $3)', [
      requestId,
      index + 1,
      kind,
    ]);
  }
}

export interface MintedGrant {
  id: string;
  notBefore: string | null;
  notAfter: string;
  cap: GrantCap;
  status: 'active' | 'pending_proof' | 'zero_length';
}

export async function mintGrant(
  tx: Queryable,
  request: RequestRecord,
  actor: PrincipalRecord,
  now: Date,
): Promise<MintedGrant> {
  const conditions = await repo.conditionsOfRequest(request.id, tx);
  const card = await loadCard(request.assetId, request.variantId, tx);
  const licences = await repo.licences(tx);
  const licence = licences.find((candidate) => candidate.id === card!.asset.licenceId)!;
  const requester = await repo.principal(request.requesterId, tx);
  const organisation = await repo.organisation(requester!.organisationId, tx);

  const expiryOverride = conditions.find((condition) => condition.kind === 'expiry_override')?.value ?? null;
  const proofRequired = conditions.some((condition) => condition.kind === 'proof_required');
  const window = computeGrantWindow({
    startsOn: businessDate(now),
    campaignEndsOn: request.campaignEndsOn,
    licenceDurationDays: licence.defaultDurationDays,
    expiryOverride,
    engagementEndsOn: organisation?.engagementEndsOn ?? null,
  });

  const status = window.zeroLength ? 'zero_length' : proofRequired ? 'pending_proof' : 'active';
  const notBefore = proofRequired && !window.zeroLength ? null : window.notBefore;
  const id = paddedId('GR', await nextCounter(tx, 'grants'));
  const sort = await nextCounter(tx, 'grant_sort');

  await tx.query(
    `insert into grants (id, holder_principal_id, holder_group_id, asset_id, variant_id, request_id,
       not_before, not_after, status, cap, sort)
     values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, request.requesterId, request.assetId, request.variantId, request.id, notBefore, window.notAfter, status, window.cap, sort],
  );
  await tx.query('update conditions set grant_id = $1 where request_id = $2', [id, request.id]);

  await appendAudit(tx, {
    occurredAt: now,
    actorId: actor.id,
    actorRole: actor.role,
    action: 'grant.minted',
    resourceType: 'grant',
    resourceId: id,
    requestId: request.id,
    before: null,
    after: { notAfter: window.notAfter, notBefore, status },
    outcome: 'success',
  });

  if (window.zeroLength) {
    await enqueueMail(
      tx,
      notices.decision(requester!.email, request.id, REQUEST_STATE_LABELS.granted, null, true),
      now,
    );
  } else {
    await enqueueMail(
      tx,
      notices.granted(
        requester!.email,
        request.id,
        id,
        card!.cardName,
        window.notAfter,
        GRANT_STATUS_LABELS[status],
        conditions.map((condition) => condition.text),
      ),
      now,
    );
  }

  await publish(tx, { type: 'grant.updated', grantId: id }, {
    principalIds: [request.requesterId],
    roles: ['owner', 'legal_reviewer'],
  });

  return { id, notBefore, notAfter: window.notAfter, cap: window.cap, status };
}

export interface DecisionOutcome {
  state: RequestState;
}

export async function applyDecision(
  tx: Queryable,
  request: RequestRecord,
  stage: StageRecord,
  decision: Decision,
  comment: string | null,
  actor: PrincipalRecord,
  now: Date,
): Promise<DecisionOutcome> {
  await tx.query(
    'update request_stages set decision = $1, decided_by = $2, decided_at = $3, comment = $4 where request_id = $5 and n = $6',
    [decision, actor.id, now, comment, request.id, stage.n],
  );

  const stages = await repo.stages(request.id, tx);
  const requester = await repo.principal(request.requesterId, tx);
  let newState: RequestState;

  if (decision === 'approve') {
    const remaining = openStageOf(stages);
    if (remaining) {
      newState = 'under_review';
    } else {
      newState = 'granted';
      await tx.query('update requests set state = $1, holder_id = $2 where id = $3', [
        'granted',
        request.requesterId,
        request.id,
      ]);
      await cancelTimers(tx, request.id);
    }
  } else if (decision === 'reject') {
    newState = 'rejected';
    await tx.query('update requests set state = $1, holder_id = $2 where id = $3', [
      'rejected',
      request.requesterId,
      request.id,
    ]);
    await cancelTimers(tx, request.id);
  } else {
    newState = 'changes_requested';
    await tx.query('update requests set state = $1, holder_id = $2 where id = $3', [
      'changes_requested',
      request.requesterId,
      request.id,
    ]);
    await cancelTimers(tx, request.id);
  }

  const after: Record<string, string | number> = { decision, stage: stage.n, state: newState };
  if (comment !== null) after['comment'] = comment;
  await appendAudit(tx, {
    occurredAt: now,
    actorId: actor.id,
    actorRole: actor.role,
    action: 'request.decided',
    resourceType: 'request',
    resourceId: request.id,
    requestId: request.id,
    before: { state: 'under_review' },
    after,
    outcome: 'success',
  });

  if (newState === 'granted') {
    await mintGrant(tx, { ...request, state: 'granted' }, actor, now);
  } else if (newState === 'under_review') {
    await routeOpenStage(tx, request, now, actor.id, { reuseAssignee: false });
  } else if (requester) {
    await enqueueMail(
      tx,
      notices.decision(requester.email, request.id, REQUEST_STATE_LABELS[newState], comment, false),
      now,
    );
  }

  return { state: newState };
}

export async function projectRequest(
  request: RequestRecord,
  viewer: PrincipalRecord,
  now: Date,
  source: Queryable,
): Promise<RequestDetail> {
  const stages = await repo.stages(request.id, source);
  const card = await loadCard(request.assetId, request.variantId, source);
  const requester = await repo.principal(request.requesterId, source);
  const organisation = await repo.organisation(requester!.organisationId, source);
  const holder = await repo.principal(request.holderId, source);
  const conditions = await repo.conditionsOfRequest(request.id, source);
  const plan = planStages(request.applicationClass, card!.asset.assetClass);
  const statuses = await ruleStatuses(request.citedRules, source);

  const grants = await repo.grants(source);
  const grant = grants.find((candidate) => candidate.requestId === request.id) ?? null;
  const grantConditions = grant ? await repo.conditionsOfGrant(grant.id, source) : [];
  const proofs = grant ? await repo.proofsOfGrant(grant.id, source) : [];

  const names = new Map<string, string>();
  for (const principal of await repo.principals(source)) names.set(principal.id, principal.displayName);

  const openStage = openStageOf(stages);
  const isHolder = openStage !== null && openStage.assigneeId === viewer.id;
  const showsDecisionPanel = isHolder || viewer.role === 'owner';

  const detail: RequestDetail = {
    id: request.id,
    state: request.state,
    stateLabel: REQUEST_STATE_LABELS[request.state],
    holder: { id: request.holderId, displayName: holder?.displayName ?? 'Unknown' },
    requester: {
      id: requester!.id,
      displayName: requester!.displayName,
      organisationName: organisation?.name ?? '',
    },
    cardName: card!.cardName,
    assetId: request.assetId,
    variantId: request.variantId,
    applicationClass: request.applicationClass,
    applicationLabel: APPLICATION_LABELS[request.applicationClass],
    territories: request.territories,
    campaignStartsOn: request.campaignStartsOn,
    campaignEndsOn: request.campaignEndsOn,
    citedRules: request.citedRules.map((identifier) => ({
      identifier,
      status: statuses.get(identifier) === 'live' ? 'live' : 'withdrawn',
    })),
    note: request.note,
    submittedAt: request.submittedAt ? request.submittedAt.toISOString() : null,
    deadline: request.deadline ? request.deadline.toISOString() : null,
    escalation: request.escalation,
    stages: stages.map((stage) => ({
      n: stage.n,
      kind: stage.kind,
      label: stageLabel(stage.n, plan, card!.asset.assetClass),
      assigneeName: stage.assigneeId ? (names.get(stage.assigneeId) ?? null) : null,
      decision: stage.decision,
      decisionLabel: stage.decision ? DECISION_LABELS[stage.decision] : null,
      decidedByName: stage.decidedBy ? (names.get(stage.decidedBy) ?? null) : null,
      decidedAt: stage.decidedAt ? stage.decidedAt.toISOString() : null,
      comment: stage.comment,
    })),
    conditions: conditions.map((condition) => ({
      id: condition.id,
      kind: condition.kind,
      text: condition.text,
    })),
    grant: grant
      ? { ...grantSummaryWith(grant, grantConditions, now), cap: grant.cap ?? 'campaign end' }
      : null,
    proofs: proofs.map((proof) => ({
      id: proof.id,
      fileName: proof.fileName,
      status: proof.status,
      statusLabel: PROOF_STATUS_LABELS[proof.status],
      reason: proof.reason,
      uploadedAt: proof.uploadedAt.toISOString(),
    })),
  };

  if (showsDecisionPanel && openStage) {
    detail.stageReason = stageReason(openStage.n, plan, request.applicationClass, card!.asset.assetClass);
    const licences = await repo.licences(source);
    const licence = licences.find((candidate) => candidate.id === card!.asset.licenceId)!;
    const expiryOverride = conditions.find((condition) => condition.kind === 'expiry_override')?.value ?? null;
    const preview = computeGrantWindow({
      startsOn: businessDate(now),
      campaignEndsOn: request.campaignEndsOn,
      licenceDurationDays: licence.defaultDurationDays,
      expiryOverride,
      engagementEndsOn: organisation?.engagementEndsOn ?? null,
    });
    detail.grantPreview = preview;
  }

  return detail;
}

/** Retirement rejects every open request on the asset, decided by the system. */
export async function rejectOpenRequestsOnAsset(
  tx: Queryable,
  assetId: string,
  successorName: string,
  now: Date,
): Promise<void> {
  const requests = await repo.allRequests(tx);
  const comment = `Asset retired. Use ${successorName} instead.`;
  for (const request of requests) {
    if (request.assetId !== assetId) continue;
    if (!OPEN_REQUEST_STATES.includes(request.state)) continue;
    const stages = await repo.stages(request.id, tx);
    const open = openStageOf(stages);
    if (open) {
      await tx.query(
        `update request_stages set decision = 'reject', decided_by = 'system', decided_at = $1, comment = $2
         where request_id = $3 and n = $4`,
        [now, comment, request.id, open.n],
      );
    }
    await tx.query('update requests set state = $1, holder_id = $2 where id = $3', [
      'rejected',
      request.requesterId,
      request.id,
    ]);
    await cancelTimers(tx, request.id);
    await appendAudit(tx, {
      occurredAt: now,
      actorId: 'system',
      actorRole: 'system',
      action: 'request.decided',
      resourceType: 'request',
      resourceId: request.id,
      requestId: request.id,
      before: { state: request.state },
      after: { comment, decision: 'reject', stage: open?.n ?? 1, state: 'rejected' },
      outcome: 'success',
    });
    const requester = await repo.principal(request.requesterId, tx);
    if (requester) {
      await enqueueMail(
        tx,
        notices.decision(requester.email, request.id, REQUEST_STATE_LABELS.rejected, comment, false),
        now,
      );
    }
    await publishRequestChange(tx, request);
  }
}

export function grantPreviewText(preview: { notAfter: string; cap: GrantCap; zeroLength: boolean }): string {
  return preview.zeroLength
    ? `This grant would end on ${formatDisplayDate(preview.notAfter)}, before it starts. Approving records the decision but grants nothing.`
    : `Grant will end on ${formatDisplayDate(preview.notAfter)} (${preview.cap})`;
}
