import type { Ctx, Method, Principal } from './http';
import { requireSession } from './http';
import { withTransaction, query, type Tx } from './db';
import {
  applicationProhibited,
  alreadyDecided,
  campaignDates,
  commentRequired,
  conditionInvalidAttribution,
  conditionInvalidClearSpace,
  conditionInvalidExpiry,
  conditionInvalidTerritory,
  duplicateOpenRequest,
  forbidden,
  idempotencyConflict,
  invalidBody,
  notFound,
  notRequestable,
  notStageHolder,
  noteTooLong,
  reasonRequired,
  ruleUnknown,
  rulesRequired,
  territoryInvalid,
  unauthenticated,
  withdrawnBy,
  wrongStateRequest,
  ApiError,
} from './errors';
import type { Config } from './config';
import { readClock } from './clock';
import {
  APPLICATION_LABELS,
  isApplicationClass,
  type ApplicationClass,
  type ConditionKind,
  type Decision,
  type RequestState,
} from '../shared/domain';
import { decideFor } from './routes-library';
import { loadViewer } from './data';
import { appendAudit } from './audit';
import { queueMail, decisionMail, grantMail, zeroLengthMail } from './mail';
import { loadRequest, loadStages, openStage, routeToStage, submitRequest, notifyRequest } from './requests-flows';
import { nextRequestId, nextGrantId, nextConditionId, stageKinds, conditionText, tierHours } from './requests-core';
import { grantWindow } from './grant-window';
import { sha256, stableStringify } from './crypto';
import { requestDetail, canSeeRequest } from './request-detail';
import { localEndOfDay } from './availability';
import { auditDenied } from './audit-denied';
import { formatDay } from './datetime';
import { created } from './created';

export function routeRequests(
  router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void },
  cfg: Config,
): void {
  router.add('POST', '/requests', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'agency') throw forbidden();
    const body = asRecord(ctx.body.json);
    const now = await readClock(cfg);
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null;
    if (idempotencyKey) {
      const existing = await query<{
        request_id: string;
        body_hash: string;
        created_at: Date;
        state: string;
      }>(
        `SELECT i.request_id, i.body_hash, i.created_at, r.state FROM request_idempotency i
           JOIN requests r ON r.id = i.request_id
          WHERE i.principal_id = $1 AND i.idempotency_key = $2`,
        [principal.id, idempotencyKey],
      );
      if (existing.length > 0) {
        const elapsed = (now.getTime() - existing[0].created_at.getTime()) / 1000;
        if (elapsed <= cfg.submitDedupSeconds && existing[0].state !== 'withdrawn') {
          return requestDetail(existing[0].request_id, cfg, principal);
        }
      }
    }
    const assetId = str(body.assetId);
    const variantId = body.variantId === null || body.variantId === undefined ? null : str(body.variantId);
    const target = await query<{ asset_id: string; variant_id: string | null; variant_label: string | null; asset_name: string; asset_state: string; class: string; licence_id: string }>(
      `SELECT a.id AS asset_id, a.class, a.licence_id, a.state AS asset_state, a.name AS asset_name,
              v.id AS variant_id, v.label AS variant_label
         FROM assets a LEFT JOIN variants v ON v.id = $2 WHERE a.id = $1`,
      [assetId, variantId],
    );
    if (target.length === 0) throw notFound();
    const row = target[0];
    if (variantId && row.variant_id !== variantId) throw notFound();
    const viewer = await loadViewer(principal);
    const decision = await decideFor(viewer, assetId, variantId, now, cfg);
    const cardName = variantId ? `${row.asset_name} — ${row.variant_label}` : row.asset_name;
    if (!decision.canRequest) {
      if (decision.openRequestId) throw duplicateOpenRequest(decision.openRequestId);
      if (decision.reason) throw notRequestable(cardName, decision.reason);
      throw notRequestable(cardName, decision.requestReason ?? 'Request use to download.');
    }
    const applicationClass = str(body.applicationClass);
    if (!isApplicationClass(applicationClass)) throw invalidBody();
    const territories = stringArray(body.territories);
    const campaignStartsOn = str(body.campaignStartsOn);
    const campaignEndsOn = str(body.campaignEndsOn);
    const citedRules = stringArray(body.citedRules);
    const note = typeof body.note === 'string' ? body.note : '';
    const submit = body.submit === true;
    await validateRequestFields(cfg, viewer, {
      applicationClass,
      territories,
      campaignStartsOn,
      campaignEndsOn,
      citedRules,
      note,
      assetId,
    });
    const bodyHash = sha256(stableStringify(body));
    const newRequestId = await withTransaction(async (tx) => {
      const requestId = await nextRequestId(tx);
      const ruleVersions = await ruleVersionsFor(tx, citedRules);
      await tx.query(
        `INSERT INTO requests (id, idempotency_key, requester_id, asset_id, variant_id, application_class,
            territories, campaign_starts_on, campaign_ends_on, cited_rules, note, state, escalation,
            holder_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',NULL,$12,$13,$13)`,
        [
          requestId,
          idempotencyKey,
          principal.id,
          assetId,
          variantId,
          applicationClass,
          territories,
          campaignStartsOn,
          campaignEndsOn,
          JSON.stringify(ruleVersions),
          note,
          principal.id,
          now,
        ],
      );
      const kinds = stageKinds(row.class, applicationClass);
      for (let i = 0; i < kinds.length; i++) {
        await tx.query(
          'INSERT INTO request_stages (request_id, n, kind) VALUES ($1,$2,$3)',
          [requestId, i + 1, kinds[i]],
        );
      }
      if (idempotencyKey) {
        const prior = await tx.query<{ request_id: string; body_hash: string }>(
          'SELECT request_id, body_hash FROM request_idempotency WHERE principal_id = $1 AND idempotency_key = $2',
          [principal.id, idempotencyKey],
        );
        if (prior.rows.length > 0 && prior.rows[0].body_hash !== bodyHash) throw idempotencyConflict();
        if (prior.rows.length > 0 && prior.rows[0].body_hash === bodyHash) {
          return prior.rows[0].request_id;
        }
        await tx.query(
          'INSERT INTO request_idempotency (principal_id, idempotency_key, request_id, body_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
          [principal.id, idempotencyKey, requestId, bodyHash, now],
        );
      }
      if (submit) {
        const record = await loadRequestTx(tx, requestId);
        await submitRequest(tx, record, now, cfg);
        await notifyRequest(tx, requestId, 'submitted');
      }
      return requestId;
    });
    return created(await requestDetail(newRequestId, cfg, principal));
  });

  router.add('POST', '/requests/:id/submit', async (ctx) => {
    const principal = requireSession(ctx);
    const now = await readClock(cfg);
    const record = await loadRequest(ctx.params.id);
    if (!record) throw notFound();
    if (record.requesterId !== principal.id) throw notFound();
    if (record.state !== 'draft') throw wrongStateRequest(record.id, requestStateLabel(record.state));
    await withTransaction(async (tx) => {
      const fresh = await loadRequestTx(tx, record.id);
      await submitRequest(tx, fresh, now, cfg);
      await notifyRequest(tx, record.id, 'submitted');
    });
    return requestDetail(record.id, cfg, principal);
  });

  router.add('GET', '/requests', async (ctx) => {
    const principal = requireSession(ctx);
    const rows = await query<{ id: string }>(
      `SELECT id FROM requests WHERE requester_id = $1 ORDER BY created_at, id`,
      [principal.id],
    );
    const requests = [];
    for (const row of rows) {
      const detail = (await requestDetail(row.id, cfg, principal)) as {
        id: string;
        state: string;
        stateLabel: string;
        cardName: string;
        applicationLabel: string;
        deadline: string | null;
      };
      requests.push({
        id: detail.id,
        cardName: detail.cardName,
        applicationLabel: detail.applicationLabel,
        state: detail.state,
        stateLabel: detail.stateLabel,
        due: detail.deadline,
      });
    }
    return { requests };
  });

  router.add('GET', '/requests/:id', async (ctx) => {
    const principal = requireSession(ctx);
    return requestDetail(ctx.params.id, cfg, principal);
  });

  router.add('POST', '/requests/:id/withdraw', async (ctx) => {
    const principal = requireSession(ctx);
    const now = await readClock(cfg);
    const record = await loadRequest(ctx.params.id);
    if (!record) throw notFound();
    if (record.requesterId !== principal.id) throw notFound();
    if (!['draft', 'routed', 'under_review', 'changes_requested'].includes(record.state)) {
      throw wrongStateRequest(record.id, requestStateLabel(record.state));
    }
    await withTransaction(async (tx) => {
      const fresh = await loadRequestTx(tx, record.id);
      if (fresh.state === 'withdrawn') {
        throw withdrawnBy(record.id, record.requesterName);
      }
      if (!['draft', 'routed', 'under_review', 'changes_requested'].includes(fresh.state)) {
        throw wrongStateRequest(record.id, requestStateLabel(fresh.state));
      }
      await tx.query(
        `UPDATE requests SET state = 'withdrawn', holder_id = $2, updated_at = $3 WHERE id = $1`,
        [record.id, record.requesterId, now],
      );
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'request.withdrawn',
        resourceType: 'request',
        resourceId: record.id,
        requestId: record.id,
        before: { state: fresh.state },
        after: { state: 'withdrawn' },
        outcome: 'success',
      });
      await notifyRequest(tx, record.id, 'withdrawn');
    });
    return requestDetail(record.id, cfg, principal);
  });

  router.add('POST', '/requests/:id/resubmit', async (ctx) => {
    const principal = requireSession(ctx);
    const now = await readClock(cfg);
    const record = await loadRequest(ctx.params.id);
    if (!record) throw notFound();
    if (record.requesterId !== principal.id) throw notFound();
    if (record.state !== 'changes_requested') {
      throw wrongStateRequest(record.id, requestStateLabel(record.state));
    }
    const body = asRecord(ctx.body.json);
    const updates = resubmitFields(body);
    if (updates) {
      const viewer = await loadViewer(principal);
      await validateRequestFields(cfg, viewer, {
        applicationClass: updates.applicationClass ?? record.applicationClass,
        territories: updates.territories ?? record.territories,
        campaignStartsOn: updates.campaignStartsOn ?? record.campaignStartsOn,
        campaignEndsOn: updates.campaignEndsOn ?? record.campaignEndsOn,
        citedRules: updates.citedRules ?? record.citedRules.map((r) => r.identifier),
        note: updates.note ?? record.note,
        assetId: record.assetId,
      });
    }
    await withTransaction(async (tx) => {
      const fresh = await loadRequestTx(tx, record.id);
      if (fresh.state !== 'changes_requested') {
        throw wrongStateRequest(record.id, requestStateLabel(fresh.state));
      }
      if (updates) {
        await applyResubmit(tx, record.id, updates, now);
      }
      const reopened = await reopenStage(tx, record.id, now, cfg);
      void reopened;
      await submitRequest(tx, fresh, now, cfg);
      await notifyRequest(tx, record.id, 'resubmitted');
    });
    return requestDetail(record.id, cfg, principal);
  });

  router.add('POST', '/requests/:id/stages/:n/decision', async (ctx) => {
    const principal = requireSession(ctx);
    const now = await readClock(cfg);
    const record = await loadRequest(ctx.params.id);
    if (!record) throw notFound();
    if (!canSeeRequest(principal, record)) throw notFound();
    const stages = await loadStages(record.id);
    const n = Number(ctx.params.n);
    const stage = stages.find((s) => s.n === n);
    if (!stage) throw notFound();
    const body = asRecord(ctx.body.json);
    const decision = str(body.decision);
    if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_changes') throw invalidBody();
    const comment = typeof body.comment === 'string' ? body.comment : null;
    if (decision === 'reject' && (!comment || comment.trim().length === 0)) throw reasonRequired();
    if (decision === 'request_changes' && (!comment || comment.trim().length === 0)) throw commentRequired();
    if (stage.assigneeId !== principal.id && principal.role !== 'owner') {
      const holderName = await assigneeName(stage.assigneeId);
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'request.decided',
          resourceType: 'request',
          resourceId: record.id,
          requestId: record.id,
        },
        now,
      );
      throw notStageHolder(holderName);
    }
    const result = await withTransaction(async (tx) => {
      await tx.query('SELECT id FROM requests WHERE id = $1 FOR UPDATE', [record.id]);
      const freshStages = await loadStagesTx(tx, record.id);
      const fresh = freshStages.find((s) => s.n === n);
      if (!fresh) throw notFound();
      const freshRecord = await loadRequestTx(tx, record.id);
      if (freshRecord.state === 'withdrawn') throw withdrawnBy(record.id, record.requesterName);
      if (fresh.decision !== null) {
        throw alreadyDecided(await assigneeName(fresh.assigneeId), decisionLabel(fresh.decision));
      }
      if (freshRecord.state !== 'under_review') {
        throw wrongStateRequest(record.id, requestStateLabel(freshRecord.state));
      }
      const conditions = await txRows<{ kind: string; value: string | null }>(tx, 'SELECT kind, value FROM conditions WHERE request_id = $1 ORDER BY position', [record.id]);
      const isFinal = n === freshStages.length;
      let newState: string;
      if (decision === 'approve') {
        newState = isFinal ? 'granted' : 'under_review';
      } else if (decision === 'reject') {
        newState = 'rejected';
      } else {
        newState = 'changes_requested';
      }
      await tx.query(
        `UPDATE request_stages SET decision = $3, decided_at = $4, comment = $5 WHERE request_id = $1 AND n = $2`,
        [record.id, n, decision, now, comment],
      );
      await tx.query(`UPDATE requests SET state = $2, updated_at = $3 WHERE id = $1`, [
        record.id,
        newState,
        now,
      ]);
      const auditAfter: Record<string, unknown> = {
        decision,
        stage: n,
        state: newState,
      };
      if (comment) auditAfter['comment'] = comment;
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'request.decided',
        resourceType: 'request',
        resourceId: record.id,
        requestId: record.id,
        before: { state: 'under_review' },
        after: auditAfter,
        outcome: 'success',
      });
      if (decision === 'approve' && isFinal) {
        await mintGrant(tx, record.id, freshRecord, conditions, now, cfg);
      } else if (decision === 'approve') {
        await routeToStage(tx, record.id, now, cfg, freshRecord.holderId);
      } else if (decision === 'reject') {
        await tx.query('DELETE FROM timers WHERE request_id = $1', [record.id]);
        await queueMail(tx, decisionMail(cfg, record.id, 'Rejected', comment, record.requesterEmail), now);
      } else {
        await tx.query('DELETE FROM timers WHERE request_id = $1', [record.id]);
        await tx.query(`UPDATE requests SET holder_id = $2 WHERE id = $1`, [record.id, record.requesterId]);
        await queueMail(tx, decisionMail(cfg, record.id, 'Changes requested', comment, record.requesterEmail), now);
      }
      await notifyRequest(tx, record.id, 'decided');
      return newState;
    });
    void result;
    return requestDetail(record.id, cfg, principal);
  });

  router.add('POST', '/requests/:id/conditions', async (ctx) => {
    const principal = requireSession(ctx);
    const now = await readClock(cfg);
    const record = await loadRequest(ctx.params.id);
    if (!record) throw notFound();
    if (!canSeeRequest(principal, record)) throw notFound();
    const stages = await loadStages(record.id);
    const open = stages.find((s) => s.decision === null);
    if (open && open.assigneeId !== principal.id && principal.role !== 'owner') {
      const holderName = await assigneeName(open.assigneeId);
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'condition.added',
          resourceType: 'condition',
          resourceId: record.id,
          requestId: record.id,
        },
        now,
      );
      throw notStageHolder(holderName);
    }
    if (!open && principal.role !== 'owner') throw forbidden();
    const body = asRecord(ctx.body.json);
    const kind = str(body.kind) as ConditionKind;
    if (!['clear_space', 'no_recolour', 'attribution', 'proof_required', 'territory', 'expiry_override'].includes(kind)) {
      throw invalidBody();
    }
    const value = body.value === null || body.value === undefined ? null : String(body.value);
    validateCondition(kind, value);
    const text = conditionText(kind, kind === 'territory' ? (value ?? '').split(',').map((c) => c.trim()).join(', ') : value);
    const inserted = await withTransaction(async (tx) => {
      await tx.query('SELECT id FROM requests WHERE id = $1 FOR UPDATE', [record.id]);
      const freshRecord = await loadRequestTx(tx, record.id);
      if (freshRecord.state !== 'under_review') {
        throw wrongStateRequest(record.id, requestStateLabel(freshRecord.state));
      }
      const freshStages = await loadStagesTx(tx, record.id);
      const freshOpen = freshStages.find((s) => s.decision === null);
      if (freshOpen && freshOpen.assigneeId !== principal.id && principal.role !== 'owner') {
        throw notStageHolder(await assigneeName(freshOpen.assigneeId));
      }
      const conditionId = await nextConditionId(tx);
      const position = (await txRows(tx, 'SELECT COUNT(*)::int AS c FROM conditions WHERE request_id = $1', [record.id]))[0].c;
      await tx.query(
        `INSERT INTO conditions (id, request_id, kind, value, text, added_by, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [conditionId, record.id, kind, value, text, principal.id, position],
      );
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'condition.added',
        resourceType: 'condition',
        resourceId: conditionId,
        requestId: record.id,
        before: null,
        after: { kind, text },
        outcome: 'success',
      });
      await notifyRequest(tx, record.id, 'condition');
      return { id: conditionId, kind, text };
    });
    return created(inserted);
  });
}

async function mintGrant(
  tx: Tx,
  requestId: string,
  record: { requesterId: string; assetId: string; variantId: string | null; cardName: string; requesterEmail: string; campaignEndsOn: string },
  conditions: { kind: string; value: string | null }[],
  now: Date,
  cfg: Config,
): Promise<void> {
  const grantId = await nextGrantId(tx);
  const approvalDate = localDate(now, cfg);
  const licence = await tx.query<{ default_duration_days: number }>(
    'SELECT l.default_duration_days FROM licences l JOIN assets a ON a.licence_id = l.id WHERE a.id = $1',
    [record.assetId],
  );
  const engagement = await tx.query<{ engagement_ends_on: string | null }>(
    'SELECT o.engagement_ends_on::text FROM organisations o JOIN principals p ON p.organisation_id = o.id WHERE p.id = $1',
    [record.requesterId],
  );
  const expiryOverride = conditions.find((c) => c.kind === 'expiry_override')?.value ?? null;
  const window = grantWindow({
    campaignEndsOn: record.campaignEndsOn,
    approvalDate,
    defaultDurationDays: licence.rows[0]?.default_duration_days ?? 90,
    expiryOverride,
    engagementEndsOn: engagement.rows[0]?.engagement_ends_on ?? null,
  });
  const proofRequired = conditions.some((c) => c.kind === 'proof_required');
  const status = window.zeroLength ? 'zero_length' : proofRequired ? 'pending_proof' : 'active';
  await tx.query(
    `INSERT INTO grants (id, holder_type, holder_principal_id, holder_group_id, asset_id, variant_id,
        request_id, status, not_before, not_after, cap, created_at)
     VALUES ($1,'principal',$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      grantId,
      record.requesterId,
      record.assetId,
      record.variantId,
      requestId,
      status,
      status === 'pending_proof' ? null : window.notBefore,
      window.notAfter,
      window.cap,
      now,
    ],
  );
  await tx.query(`UPDATE requests SET state = 'granted', holder_id = $2 WHERE id = $1`, [
    requestId,
    record.requesterId,
  ]);
  await appendAudit(tx, {
    occurredAt: now,
    actorId: record.requesterId,
    actorRole: 'agency',
    action: 'grant.minted',
    resourceType: 'grant',
    resourceId: grantId,
    requestId,
    before: null,
    after: {
      notAfter: window.notAfter,
      notBefore: status === 'pending_proof' ? null : window.notBefore,
      status,
    },
    outcome: 'success',
  });
  const conditionTexts = await txRows<{ text: string }>(
    tx,
    'SELECT text FROM conditions WHERE request_id = $1 ORDER BY position',
    [requestId],
  );
  if (status === 'zero_length') {
    await queueMail(tx, zeroLengthMail(cfg, requestId, record.requesterEmail), now);
  } else {
    await queueMail(
      tx,
      grantMail(
        cfg,
        requestId,
        grantId,
        record.cardName,
        window.notAfter,
        status === 'pending_proof' ? 'Pending proof' : 'Active',
        conditionTexts.map((c) => c.text),
        record.requesterEmail,
      ),
      now,
    );
  }
}

function localDate(now: Date, cfg: Config): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.appTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

async function reopenStage(tx: Tx, requestId: string, now: Date, cfg: Config): Promise<void> {
  void now;
  void cfg;
  const stages = await loadStagesTx(tx, requestId);
  const rejected = stages.find((s) => s.decision === 'request_changes');
  if (!rejected) return;
  const undecided = stages.filter((s) => s.decision === null);
  for (const stage of stages) {
    if (stage.n >= rejected.n) {
      await tx.query(
        `UPDATE request_stages SET decision = NULL, decided_at = NULL, comment = NULL WHERE request_id = $1 AND n = $2`,
        [requestId, stage.n],
      );
    }
  }
  void undecided;
}

export async function validateRequestFields(
  cfg: Config,
  viewer: { context: { principalId: string; role: string } },
  fields: {
    applicationClass: ApplicationClass;
    territories: string[];
    campaignStartsOn: string;
    campaignEndsOn: string;
    citedRules: string[];
    note: string;
    assetId: string;
  },
): Promise<void> {
  const licence = await query<{
    permitted_applications: string[];
    prohibited_applications: string[];
    territories: string[];
    audiences: string[];
  }>(
    'SELECT permitted_applications, prohibited_applications, territories, audiences FROM licences l JOIN assets a ON a.licence_id = l.id WHERE a.id = $1',
    [fields.assetId],
  );
  const lic = licence[0];
  if (!lic) throw notFound();
  const prohibited = lic.prohibited_applications.includes(fields.applicationClass);
  const permitted = lic.permitted_applications.includes(fields.applicationClass);
  if (prohibited || !permitted) {
    throw applicationProhibited(APPLICATION_LABELS[fields.applicationClass]);
  }
  const org = await query<{ territories: string[] }>(
    'SELECT engagement_territories AS territories FROM organisations o JOIN principals p ON p.organisation_id = o.id WHERE p.id = $1',
    [viewer.context.principalId],
  );
  const engagementTerritories = org[0]?.territories ?? [];
  if (fields.territories.length === 0) {
    throw territoryInvalid(engagementTerritories.join(', '));
  }
  for (const territory of fields.territories) {
    if (!engagementTerritories.includes(territory)) {
      throw territoryInvalid(engagementTerritories.join(', '));
    }
  }
  if (fields.campaignEndsOn < fields.campaignStartsOn) throw campaignDates();
  if (fields.citedRules.length === 0) throw rulesRequired();
  for (const identifier of fields.citedRules) {
    const rule = await query<{ identifier: string }>('SELECT identifier FROM rule_events WHERE identifier = $1 AND event = \'live\'', [identifier]);
    if (rule.length === 0) throw ruleUnknown(identifier);
  }
  if (fields.note.length > 2000) throw noteTooLong();
}

function validateCondition(kind: ConditionKind, value: string | null): void {
  switch (kind) {
    case 'clear_space':
      if (!['0.5', '1', '1.5', '2'].includes(value ?? '')) throw conditionInvalidClearSpace();
      break;
    case 'attribution':
      if (!value || value.trim().length === 0) throw conditionInvalidAttribution();
      break;
    case 'territory':
      if (!value || value.trim().length === 0) throw conditionInvalidTerritory();
      break;
    case 'expiry_override':
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw conditionInvalidExpiry();
      break;
    default:
      break;
  }
}

interface ResubmitFields {
  applicationClass?: ApplicationClass;
  territories?: string[];
  campaignStartsOn?: string;
  campaignEndsOn?: string;
  citedRules?: string[];
  note?: string;
}

function resubmitFields(body: Record<string, unknown>): ResubmitFields | null {
  const keys = ['applicationClass', 'territories', 'campaignStartsOn', 'campaignEndsOn', 'citedRules', 'note'];
  const present = keys.filter((k) => body[k] !== undefined);
  if (present.length === 0) return null;
  const out: ResubmitFields = {};
  if (body.applicationClass !== undefined) out.applicationClass = str(body.applicationClass) as ApplicationClass;
  if (body.territories !== undefined) out.territories = stringArray(body.territories);
  if (body.campaignStartsOn !== undefined) out.campaignStartsOn = str(body.campaignStartsOn);
  if (body.campaignEndsOn !== undefined) out.campaignEndsOn = str(body.campaignEndsOn);
  if (body.citedRules !== undefined) out.citedRules = stringArray(body.citedRules);
  if (body.note !== undefined) out.note = typeof body.note === 'string' ? body.note : '';
  return out;
}

async function applyResubmit(tx: Tx, requestId: string, updates: ResubmitFields, now: Date): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.applicationClass) {
    params.push(updates.applicationClass);
    sets.push(`application_class = $${params.length}`);
  }
  if (updates.territories) {
    params.push(updates.territories);
    sets.push(`territories = $${params.length}`);
  }
  if (updates.campaignStartsOn) {
    params.push(updates.campaignStartsOn);
    sets.push(`campaign_starts_on = $${params.length}`);
  }
  if (updates.campaignEndsOn) {
    params.push(updates.campaignEndsOn);
    sets.push(`campaign_ends_on = $${params.length}`);
  }
  if (updates.note !== undefined) {
    params.push(updates.note);
    sets.push(`note = $${params.length}`);
  }
  if (updates.citedRules) {
    params.push(JSON.stringify(updates.citedRules.map((identifier) => ({ identifier, version: 1 }))));
    sets.push(`cited_rules = $${params.length}`);
  }
  if (sets.length === 0) return;
  params.push(now);
  const updatedAtIndex = params.length;
  params.push(requestId);
  const requestIdIndex = params.length;
  await tx.query(
    `UPDATE requests SET ${sets.join(', ')}, updated_at = $${updatedAtIndex} WHERE id = $${requestIdIndex}`,
    params,
  );
}

async function ruleVersionsFor(tx: Tx, identifiers: string[]): Promise<{ identifier: string; version: number }[]> {
  const out: { identifier: string; version: number }[] = [];
  for (const identifier of identifiers) {
    const published = await tx.query<{ version: number }>(
      `SELECT e.version_number AS version FROM rule_events e
        WHERE e.identifier = $1 AND e.event = 'live'`,
      [identifier],
    );
    out.push({ identifier, version: published.rows[0]?.version ?? 1 });
  }
  return out;
}

async function loadRequestTx(tx: Tx, id: string) {
  const rows = await tx.query<{
    id: string;
    requester_id: string;
    requester_email: string;
    requester_name: string;
    asset_id: string;
    asset_class: string;
    variant_id: string | null;
    asset_name: string;
    variant_label: string | null;
    application_class: string;
    state: string;
    holder_id: string;
    campaign_starts_on: string;
    campaign_ends_on: string;
    deadline: Date | null;
  }>(
    `SELECT r.id, r.requester_id, p.email AS requester_email, p.display_name AS requester_name,
            r.asset_id, a.class AS asset_class, r.variant_id, a.name AS asset_name, v.label AS variant_label,
            r.application_class, r.state, r.holder_id, r.campaign_starts_on::text, r.campaign_ends_on::text,
            r.deadline
       FROM requests r
       JOIN principals p ON p.id = r.requester_id
       JOIN assets a ON a.id = r.asset_id
       LEFT JOIN variants v ON v.id = r.variant_id
      WHERE r.id = $1`,
    [id],
  );
  const row = rows.rows[0];
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    organisationName: '',
    assetId: row.asset_id,
    assetClass: row.asset_class,
    variantId: row.variant_id,
    cardName: row.variant_id ? `${row.asset_name} — ${row.variant_label}` : row.asset_name,
    applicationClass: row.application_class as ApplicationClass,
    territories: [],
    campaignStartsOn: row.campaign_starts_on,
    campaignEndsOn: row.campaign_ends_on,
    citedRules: [],
    note: '',
    state: row.state as RequestState,
    escalation: null as null | 'no_eligible_reviewer' | 'deadline_missed',
    holderId: row.holder_id,
    submittedAt: null as Date | null,
    deadline: row.deadline,
    deadlineSubmittedAt: null as Date | null,
  };
}

async function loadStagesTx(tx: Tx, requestId: string) {
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
    decision: (r.decision as Decision | null) ?? null,
    decidedAt: r.decided_at,
    comment: r.comment,
  }));
}

async function txRows<T extends Record<string, unknown>>(tx: Tx, sql: string, params: readonly unknown[]): Promise<T[]> {
  const res = await tx.query(sql, params as unknown[]);
  return res.rows as T[];
}

async function assigneeName(assigneeId: string | null): Promise<string> {
  if (!assigneeId) return 'the stage holder';
  const rows = await query<{ display_name: string }>('SELECT display_name FROM principals WHERE id = $1', [assigneeId]);
  return rows[0]?.display_name ?? 'the stage holder';
}

function requestStateLabel(state: string): string {
  const labels: Record<string, string> = {
    draft: 'Draft',
    routed: 'Routed',
    under_review: 'Under review',
    changes_requested: 'Changes requested',
    approved: 'Approved',
    granted: 'Granted',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    expired: 'Expired',
  };
  return labels[state] ?? state;
}

function decisionLabel(decision: string): string {
  const labels: Record<string, string> = {
    approve: 'Approved',
    reject: 'Rejected',
    request_changes: 'Changes requested',
  };
  return labels[decision] ?? decision;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw invalidBody();
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalidBody();
  return value.filter((v): v is string => typeof v === 'string');
}

export { formatDay, localEndOfDay, ApiError };
