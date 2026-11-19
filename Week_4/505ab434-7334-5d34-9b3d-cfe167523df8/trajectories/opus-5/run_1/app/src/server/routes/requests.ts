import { createHash } from 'node:crypto';
import { APPLICATION_KEYS, APPLICATION_LABELS, DECISION_LABELS, REQUEST_STATE_LABELS } from '../../shared/labels.js';
import type { ApplicationClass, Decision, RequestDetail, RequestSummary } from '../../shared/types.js';
import { appendAudit } from '../audit.js';
import { config } from '../config.js';
import { db, nextCounter, paddedId, withTransaction, type Queryable } from '../db.js';
import { buildCondition, isConditionKind } from '../domain/conditions.js';
import { planStages } from '../domain/routing.js';
import type { PrincipalRecord, RequestRecord } from '../domain/records.js';
import { requestTransitions, wrongRequestState } from '../domain/transitions.js';
import { errors } from '../errors.js';
import { jsonBody, requireSignedIn, requireViewer, type Ctx } from '../http/context.js';
import { sendJson } from '../http/respond.js';
import { repo } from '../repo.js';
import { decideOneCard, loadCard } from '../services/library.js';
import {
  applyDecision,
  createStages,
  openStageOf,
  projectRequest,
  publishRequestChange,
  submitRequest,
} from '../services/requests.js';
import { liveRules } from '../services/rules.js';

interface CreateBody {
  idempotencyKey?: string;
  assetId?: string;
  variantId?: string | null;
  applicationClass?: ApplicationClass;
  territories?: string[];
  campaignStartsOn?: string;
  campaignEndsOn?: string;
  citedRules?: string[];
  note?: string | null;
  submit?: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function bodyFingerprint(body: CreateBody): string {
  const canonical = JSON.stringify({
    assetId: body.assetId ?? null,
    variantId: body.variantId ?? null,
    applicationClass: body.applicationClass ?? null,
    territories: body.territories ?? [],
    campaignStartsOn: body.campaignStartsOn ?? null,
    campaignEndsOn: body.campaignEndsOn ?? null,
    citedRules: body.citedRules ?? [],
    note: body.note ?? null,
    submit: body.submit ?? false,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const SUBMIT_LOCK = 751_903;

function keyLock(key: string, principalId: string): number {
  let hash = 0;
  for (const character of `${key}|${principalId}`) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return hash;
}

/** The stored create response for a replayed submission key, or null. */
async function readIdempotent(
  source: Queryable,
  key: string,
  principalId: string,
  now: Date,
  fingerprint: string,
): Promise<RequestDetail | null> {
  const stored = await source.query<{ body_hash: string; response: RequestDetail; created_at: Date }>(
    'select body_hash, response, created_at from idempotency where key = $1 and principal_id = $2',
    [key, principalId],
  );
  const row = stored.rows[0];
  if (!row || now.getTime() - row.created_at.getTime() > config.submitDedupSeconds * 1000) return null;
  if (row.body_hash !== fingerprint) throw errors.idempotencyConflict();
  return row.response;
}

function canSeeRequest(principal: PrincipalRecord, request: RequestRecord): boolean {
  if (principal.id === request.requesterId) return true;
  return principal.role === 'brand_reviewer' || principal.role === 'legal_reviewer' || principal.role === 'owner';
}

async function loadVisibleRequest(ctx: Ctx, id: string): Promise<{ principal: PrincipalRecord; request: RequestRecord }> {
  const principal = requireSignedIn(ctx);
  const request = await repo.request(id);
  if (!request || !canSeeRequest(principal, request)) throw errors.notFound();
  return { principal, request };
}

async function validateRequestFields(
  body: CreateBody,
  requester: PrincipalRecord,
  assetId: string,
  variantId: string | null,
): Promise<{
  applicationClass: ApplicationClass;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: string[];
  note: string | null;
}> {
  const card = await loadCard(assetId, variantId);
  if (!card) throw errors.notFound();
  const licences = await repo.licences();
  const licence = licences.find((candidate) => candidate.id === card.asset.licenceId)!;
  const organisation = await repo.organisation(requester.organisationId);

  const applicationClass = (body.applicationClass ?? '') as ApplicationClass;
  if (!APPLICATION_KEYS.includes(applicationClass)) {
    throw errors.applicationProhibited(APPLICATION_LABELS[applicationClass] ?? String(body.applicationClass));
  }
  if (
    licence.prohibitedApplications.includes(applicationClass) ||
    !licence.permittedApplications.includes(applicationClass)
  ) {
    throw errors.applicationProhibited(APPLICATION_LABELS[applicationClass]);
  }

  const engagementTerritories = organisation?.territories ?? [];
  const territories = Array.isArray(body.territories) ? body.territories : [];
  const territoriesValid =
    territories.length > 0 &&
    territories.every(
      (code) =>
        engagementTerritories.includes(code) &&
        (licence.territories.includes('worldwide') || licence.territories.includes(code)) &&
        !licence.excludedTerritories.includes(code),
    );
  if (!territoriesValid) throw errors.territoryInvalid(engagementTerritories);

  const campaignStartsOn = body.campaignStartsOn ?? '';
  const campaignEndsOn = body.campaignEndsOn ?? '';
  if (!DATE_PATTERN.test(campaignStartsOn) || !DATE_PATTERN.test(campaignEndsOn) || campaignEndsOn < campaignStartsOn) {
    throw errors.campaignDates();
  }

  const citedRules = Array.isArray(body.citedRules) ? body.citedRules : [];
  if (citedRules.length === 0) throw errors.rulesRequired();
  const live = new Set((await liveRules()).map((rule) => rule.identifier));
  for (const identifier of citedRules) {
    if (!live.has(identifier)) throw errors.ruleUnknown(identifier);
  }

  const note = typeof body.note === 'string' ? body.note : null;
  if (note !== null && note.length > 2000) throw errors.noteTooLong();

  return { applicationClass, territories, campaignStartsOn, campaignEndsOn, citedRules, note };
}

export async function createRequest(ctx: Ctx): Promise<void> {
  const viewer = requireViewer(ctx);
  const body = jsonBody<CreateBody>(ctx);
  const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  const fingerprint = bodyFingerprint(body);

  const replay = key === '' ? null : await readIdempotent(db, key, viewer.principal.id, ctx.now, fingerprint);
  if (replay) {
    sendJson(ctx.res, 201, replay);
    return;
  }

  if (viewer.principal.role !== 'agency') throw errors.forbidden();

  const assetId = body.assetId ?? '';
  const variantId = body.variantId ?? null;
  const entry = await decideOneCard(viewer, ctx.now, assetId, variantId);
  if (!entry) throw errors.notFound();

  if (!entry.decision.canRequest) {
    if (entry.decision.openRequestId) throw errors.duplicateOpenRequest(entry.decision.openRequestId);
    const reason = entry.decision.requestReason ?? entry.decision.reason ?? 'Not available.';
    throw errors.notRequestable(entry.card.cardName, reason);
  }

  const fields = await validateRequestFields(body, viewer.principal, assetId, variantId);
  const shouldSubmit = body.submit !== false;

  const detail = await withTransaction(async (tx) => {
    if (key !== '') {
      await tx.query('select pg_advisory_xact_lock($1, $2)', [SUBMIT_LOCK, keyLock(key, viewer.principal.id)]);
      const stored = await readIdempotent(tx, key, viewer.principal.id, ctx.now, fingerprint);
      if (stored) return stored;
    }
    const id = paddedId('REQ', await nextCounter(tx, 'requests'));
    const sort = await nextCounter(tx, 'request_sort');
    await tx.query(
      `insert into requests (id, requester_id, asset_id, variant_id, application_class, territories,
         campaign_starts_on, campaign_ends_on, cited_rules, note, state, holder_id, created_at, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$2,$11,$12)`,
      [
        id,
        viewer.principal.id,
        assetId,
        variantId,
        fields.applicationClass,
        fields.territories,
        fields.campaignStartsOn,
        fields.campaignEndsOn,
        fields.citedRules,
        fields.note,
        ctx.now,
        sort,
      ],
    );
    await createStages(tx, id, planStages(fields.applicationClass, entry.card.asset.assetClass));

    let record = (await repo.request(id, tx))!;
    if (shouldSubmit) {
      record = await submitRequest(tx, record, viewer.principal, ctx.now, {
        previousState: 'new',
        reuseAssignee: false,
      });
    }
    await publishRequestChange(tx, record);

    const projected = await projectRequest(record, viewer.principal, ctx.now, tx);
    if (key !== '') {
      await tx.query(
        `insert into idempotency (key, principal_id, body_hash, response, created_at)
         values ($1,$2,$3,$4::jsonb,$5)
         on conflict (key, principal_id) do update set body_hash = excluded.body_hash,
           response = excluded.response, created_at = excluded.created_at`,
        [key, viewer.principal.id, fingerprint, JSON.stringify(projected), ctx.now],
      );
    }
    return projected;
  });

  sendJson(ctx.res, 201, detail);
}

export async function submitExistingRequest(ctx: Ctx): Promise<void> {
  const { principal, request } = await loadVisibleRequest(ctx, ctx.params['id'] ?? '');
  if (principal.id !== request.requesterId) throw errors.forbidden();

  const detail = await withTransaction(async (tx) => {
    const locked = (await repo.requestForUpdate(request.id, tx))!;
    if (!requestTransitions.canSubmit(locked.state)) wrongRequestState(locked.id, locked.state);
    const submitted = await submitRequest(tx, locked, principal, ctx.now, {
      previousState: locked.state === 'changes_requested' ? 'changes_requested' : 'draft',
      reuseAssignee: locked.state === 'changes_requested',
    });
    await publishRequestChange(tx, submitted);
    return projectRequest(submitted, principal, ctx.now, tx);
  });
  sendJson(ctx.res, 200, detail);
}

export async function listRequests(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const requests = await repo.requestsOf(principal.id);
  const summaries: RequestSummary[] = [];
  for (const request of requests) {
    const card = await loadCard(request.assetId, request.variantId);
    const holder = await repo.principal(request.holderId);
    summaries.push({
      id: request.id,
      cardName: card!.cardName,
      applicationLabel: APPLICATION_LABELS[request.applicationClass],
      stateLabel: REQUEST_STATE_LABELS[request.state],
      deadline: request.deadline ? request.deadline.toISOString() : null,
      holderName: holder?.displayName ?? '',
    });
  }
  sendJson(ctx.res, 200, { requests: summaries });
}

export async function readRequest(ctx: Ctx): Promise<void> {
  const { principal, request } = await loadVisibleRequest(ctx, ctx.params['id'] ?? '');
  sendJson(ctx.res, 200, await projectRequest(request, principal, ctx.now, db));
}

export async function withdrawRequest(ctx: Ctx): Promise<void> {
  const { principal, request } = await loadVisibleRequest(ctx, ctx.params['id'] ?? '');
  if (principal.id !== request.requesterId) throw errors.forbidden();

  const detail = await withTransaction(async (tx) => {
    const locked = (await repo.requestForUpdate(request.id, tx))!;
    if (!requestTransitions.canWithdraw(locked.state)) wrongRequestState(locked.id, locked.state);
    await tx.query('update requests set state = $1, holder_id = $2 where id = $3', [
      'withdrawn',
      locked.requesterId,
      locked.id,
    ]);
    await tx.query('update timers set cancelled = true where request_id = $1 and fired_at is null', [locked.id]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'request.withdrawn',
      resourceType: 'request',
      resourceId: locked.id,
      requestId: locked.id,
      before: { state: locked.state },
      after: { state: 'withdrawn' },
      outcome: 'success',
    });
    const updated = (await repo.request(locked.id, tx))!;
    await publishRequestChange(tx, updated);
    return projectRequest(updated, principal, ctx.now, tx);
  });
  sendJson(ctx.res, 200, detail);
}

export async function resubmitRequest(ctx: Ctx): Promise<void> {
  const viewer = requireViewer(ctx);
  const { principal, request } = await loadVisibleRequest(ctx, ctx.params['id'] ?? '');
  if (principal.id !== request.requesterId) throw errors.forbidden();

  const body = jsonBody<CreateBody>(ctx);
  const merged: CreateBody = {
    applicationClass: body.applicationClass ?? request.applicationClass,
    territories: body.territories ?? request.territories,
    campaignStartsOn: body.campaignStartsOn ?? request.campaignStartsOn,
    campaignEndsOn: body.campaignEndsOn ?? request.campaignEndsOn,
    citedRules: body.citedRules ?? request.citedRules,
    note: body.note === undefined ? request.note : body.note,
  };

  const detail = await withTransaction(async (tx) => {
    const locked = (await repo.requestForUpdate(request.id, tx))!;
    if (!requestTransitions.canResubmit(locked.state)) wrongRequestState(locked.id, locked.state);
    const fields = await validateRequestFields(merged, viewer.principal, locked.assetId, locked.variantId);
    await tx.query(
      `update requests set application_class = $1, territories = $2, campaign_starts_on = $3,
         campaign_ends_on = $4, cited_rules = $5, note = $6 where id = $7`,
      [
        fields.applicationClass,
        fields.territories,
        fields.campaignStartsOn,
        fields.campaignEndsOn,
        fields.citedRules,
        fields.note,
        locked.id,
      ],
    );
    const updated = (await repo.request(locked.id, tx))!;
    const submitted = await submitRequest(tx, updated, principal, ctx.now, {
      previousState: 'changes_requested',
      reuseAssignee: true,
    });
    await publishRequestChange(tx, submitted);
    return projectRequest(submitted, principal, ctx.now, tx);
  });
  sendJson(ctx.res, 200, detail);
}

async function auditDenied(
  actor: PrincipalRecord,
  now: Date,
  action: string,
  resourceType: string,
  resourceId: string,
  requestId: string | null,
): Promise<void> {
  await withTransaction(async (tx) => {
    await appendAudit(tx, {
      occurredAt: now,
      actorId: actor.id,
      actorRole: actor.role,
      action,
      resourceType,
      resourceId,
      requestId,
      before: null,
      after: null,
      outcome: 'denied',
    });
  });
}

async function requireStageAuthority(
  ctx: Ctx,
  principal: PrincipalRecord,
  request: RequestRecord,
  action: string,
): Promise<void> {
  const stages = await repo.stages(request.id);
  const open = openStageOf(stages);
  const holderId = open?.assigneeId ?? request.holderId;
  if (principal.role === 'owner' || principal.id === holderId) return;
  const holder = await repo.principal(holderId);
  await auditDenied(principal, ctx.now, action, 'request', request.id, request.id);
  throw errors.notStageHolder(holder?.displayName ?? 'the holder');
}

export async function decideStage(ctx: Ctx): Promise<void> {
  const { principal, request } = await loadVisibleRequest(ctx, ctx.params['id'] ?? '');
  const stageNumber = Number(ctx.params['n']);
  await requireStageAuthority(ctx, principal, request, 'request.decided');

  const body = jsonBody<{ decision?: Decision; comment?: string | null }>(ctx);
  const decision = body.decision;
  const comment = typeof body.comment === 'string' && body.comment.trim() !== '' ? body.comment.trim() : null;

  const detail = await withTransaction(async (tx) => {
    const locked = (await repo.requestForUpdate(request.id, tx))!;
    const stages = await repo.stages(locked.id, tx);
    const stage = stages.find((candidate) => candidate.n === stageNumber);
    if (!stage) throw errors.notFound();

    if (locked.state === 'withdrawn') {
      const requester = await repo.principal(locked.requesterId, tx);
      throw errors.withdrawn(locked.id, requester?.displayName ?? 'the requester');
    }
    if (stage.decision !== null) {
      const decider = stage.decidedBy ? await repo.principal(stage.decidedBy, tx) : null;
      throw errors.alreadyDecided(decider?.displayName ?? 'another reviewer', DECISION_LABELS[stage.decision]);
    }
    if (!requestTransitions.canDecide(locked.state)) wrongRequestState(locked.id, locked.state);

    if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_changes') {
      throw errors.reasonRequired();
    }
    if (decision === 'reject' && comment === null) throw errors.reasonRequired();
    if (decision === 'request_changes' && comment === null) throw errors.commentRequired();

    await applyDecision(tx, locked, stage, decision, comment, principal, ctx.now);
    const updated = (await repo.request(locked.id, tx))!;
    await publishRequestChange(tx, updated);
    return projectRequest(updated, principal, ctx.now, tx);
  });

  sendJson(ctx.res, 200, detail);
}

export async function addCondition(ctx: Ctx): Promise<void> {
  const { principal, request } = await loadVisibleRequest(ctx, ctx.params['id'] ?? '');
  await requireStageAuthority(ctx, principal, request, 'condition.added');

  const body = jsonBody<{ kind?: string; value?: string | null }>(ctx);

  const created = await withTransaction(async (tx) => {
    const locked = (await repo.requestForUpdate(request.id, tx))!;
    if (locked.state !== 'under_review') wrongRequestState(locked.id, locked.state);
    if (!isConditionKind(body.kind)) throw errors.conditionInvalid('Clear space must be 0.5, 1, 1.5 or 2.');
    const built = buildCondition(body.kind, body.value ?? null);
    const id = paddedId('CON', await nextCounter(tx, 'conditions'));
    const sort = await nextCounter(tx, 'condition_sort');
    await tx.query(
      `insert into conditions (id, request_id, grant_id, kind, value, text, added_by, sort)
       values ($1,$2,null,$3,$4,$5,$6,$7)`,
      [id, locked.id, built.kind, built.value, built.text, principal.id, sort],
    );
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'condition.added',
      resourceType: 'condition',
      resourceId: id,
      requestId: locked.id,
      before: null,
      after: { kind: built.kind, text: built.text },
      outcome: 'success',
    });
    await publishRequestChange(tx, locked);
    return { id, kind: built.kind, text: built.text };
  });

  sendJson(ctx.res, 201, created);
}


