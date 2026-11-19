import type { Ctx, Method, Principal } from './http';
import { requireSession } from './http';
import { withTransaction, query, type Tx } from './db';
import {
  applicationProhibited,
  campaignDates,
  commentRequired,
  duplicateOpenRequest,
  forbidden,
  idempotencyConflict,
  invalidBody,
  notFound,
  notRequestable,
  noteTooLong,
  reasonRequired,
  ruleUnknown,
  rulesRequired,
  territoryInvalid,
  wrongStateRequest,
  notStageHolder,
  alreadyDecided,
  withdrawnBy,
  wrongStateGrant,
  conditionInvalidClearSpace,
  conditionInvalidAttribution,
  conditionInvalidTerritory,
  conditionInvalidExpiry,
  unauthenticated,
} from './errors';
import type { Config } from './config';
import { readClock } from './clock';
import {
  APPLICATION_LABELS,
  CONDITION_LABELS,
  DECISION_LABELS,
  REQUEST_STATE_LABELS,
  isApplicationClass,
  type ApplicationClass,
  type ConditionKind,
  type Decision,
  type RequestState,
} from '../shared/domain';
import { decideFor } from './routes-library';
import { loadViewer, cardTarget, openRequestsFor } from './data';
import { appendAudit } from './audit';
import { queueMail, decisionMail } from './mail';
import {
  loadRequest,
  loadStages,
  openStage,
  routeToStage,
  submitRequest,
  notifyRequest,
} from './requests-flows';
import { nextRequestId, stageKinds, conditionText, tierHours } from './requests-core';
import { grantWindow } from './grant-window';
import { sha256 } from './crypto';
import { formatDateTime, formatDay } from './datetime';

export function canSeeRequest(principal: Principal, record: { requesterId: string }): boolean {
  if (principal.role === 'owner' || principal.role === 'brand_reviewer' || principal.role === 'legal_reviewer') return true;
  return record.requesterId === principal.id;
}

export async function requestDetail(id: string, cfg: Config, viewerPrincipal: Principal): Promise<unknown> {
  const record = await loadRequest(id);
  if (!record) throw notFound();
  if (!canSeeRequest(viewerPrincipal, record)) throw notFound();
  const stages = await loadStages(id);
  const conditions = await query<{ id: string; kind: string; value: string | null; text: string }>(
    'SELECT id, kind, value, text FROM conditions WHERE request_id = $1 ORDER BY position',
    [id],
  );
  const grant = await query<{
    id: string;
    status: string;
    not_before: string | null;
    not_after: string;
    cap: string | null;
    revoked_reason: string | null;
  }>(
    'SELECT id, status, not_before::text, not_after::text, cap, revoked_reason FROM grants WHERE request_id = $1',
    [id],
  );
  const proofs =
    grant.length > 0
      ? await query<{ id: string; file_name: string; status: string; reason: string | null; uploaded_at: Date }>(
          'SELECT id, file_name, status, reason, uploaded_at FROM proofs WHERE grant_id = $1 ORDER BY uploaded_at',
          [grant[0].id],
        )
      : [];
  const holder = await query<{ display_name: string }>('SELECT display_name FROM principals WHERE id = $1', [
    record.holderId,
  ]);
  const stageRows = await Promise.all(
    stages.map(async (stage) => {
      const assignee = stage.assigneeId
        ? await query<{ display_name: string }>('SELECT display_name FROM principals WHERE id = $1', [stage.assigneeId])
        : [];
      const decider = stage.decidedAt
        ? await query<{ display_name: string }>('SELECT display_name FROM principals WHERE id = $1', [stage.assigneeId])
        : [];
      void decider;
      const stageDecidedBy = stage.decision
        ? await query<{ display_name: string }>('SELECT display_name FROM principals WHERE id = $1', [stage.assigneeId])
        : [];
      const kinds = stageKinds(record.assetClass, record.applicationClass);
      return {
        n: stage.n,
        kind: stage.kind,
        label: stageLabel(stage.n, kinds),
        assigneeName: assignee[0]?.display_name ?? null,
        decision: stage.decision,
        decisionLabel: stage.decision ? DECISION_LABELS[stage.decision] : null,
        decidedByName: stage.decision ? stageDecidedBy[0]?.display_name ?? null : null,
        decidedAt: stage.decidedAt ? stage.decidedAt.toISOString() : null,
        comment: stage.comment,
      };
    }),
  );
  const open = stages.find((s) => s.decision === null) ?? null;
  const detail: Record<string, unknown> = {
    id: record.id,
    state: record.state,
    stateLabel: REQUEST_STATE_LABELS[record.state],
    holder: { id: record.holderId, displayName: holder[0]?.display_name ?? '' },
    requester: {
      id: record.requesterId,
      displayName: record.requesterName,
      organisationName: record.organisationName,
    },
    cardName: record.cardName,
    assetId: record.assetId,
    variantId: record.variantId,
    applicationClass: record.applicationClass,
    applicationLabel: APPLICATION_LABELS[record.applicationClass],
    territories: record.territories,
    campaignStartsOn: record.campaignStartsOn,
    campaignEndsOn: record.campaignEndsOn,
    citedRules: record.citedRules.map((r) => ({ identifier: r.identifier, status: 'live' })),
    note: record.note,
    submittedAt: record.submittedAt ? record.submittedAt.toISOString() : null,
    deadline: record.deadline ? record.deadline.toISOString() : null,
    escalation: record.escalation,
    stages: stageRows,
    conditions: conditions.map((c) => ({ id: c.id, kind: c.kind, text: c.text })),
    grant:
      grant.length > 0
        ? {
            id: grant[0].id,
            status: grant[0].status,
            statusLabel: grantStatusLabel(grant[0].status),
            notBefore: grant[0].not_before,
            notAfter: grant[0].not_after,
            cap: grant[0].cap,
            conditions: conditions.map((c) => ({ kind: c.kind, text: c.text })),
            revokedReason: grant[0].revoked_reason,
          }
        : null,
    proofs: proofs.map((p) => ({
      id: p.id,
      fileName: p.file_name,
      status: p.status,
      statusLabel: proofStatusLabel(p.status),
      reason: p.reason,
      uploadedAt: p.uploaded_at.toISOString(),
    })),
  };
  const openStageRow = open
    ? (await query<{ assignee_id: string | null }>('SELECT assignee_id FROM request_stages WHERE request_id = $1 AND n = $2', [id, open.n]))[0]
    : null;
  if (open && (viewerPrincipal.role === 'owner' || viewerPrincipal.id === openStageRow?.assignee_id)) {
    const kinds = stageKinds(record.assetClass, record.applicationClass);
    const preview = await grantPreviewFor(
      record,
      conditions.map((c) => ({ kind: c.kind as ConditionKind, value: c.value })),
      cfg,
    );
    detail['stageReason'] = stageReasonText(kinds, open.n, record.applicationClass);
    detail['grantPreview'] = preview;
  }
  return detail;
}

function grantStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Active',
    pending_proof: 'Pending proof',
    revoked: 'Revoked',
    expired: 'Expired',
    zero_length: 'Zero-length',
  };
  return labels[status] ?? status;
}

function proofStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_review: 'Pending review',
    accepted: 'Accepted',
    rejected: 'Rejected',
  };
  return labels[status] ?? status;
}

function stageLabel(n: number, kinds: ('brand' | 'legal')[]): string {
  const total = kinds.length;
  if (kinds[n - 1] === 'legal') return `Legal review`;
  if (total === 3 && n === 1) return `First brand review`;
  if (total === 3 && n === 2) return `Second brand review`;
  return `Brand review`;
}

function stageReasonText(kinds: ('brand' | 'legal')[], n: number, applicationClass: ApplicationClass): string {
  const total = kinds.length;
  if (kinds[n - 1] === 'legal') {
    return `Stage ${n} of ${total}: legal review (${APPLICATION_LABELS[applicationClass]}).`;
  }
  if (total === 3 && n === 1) return `Stage ${n} of ${total}: first brand review (mark asset).`;
  if (total === 3 && n === 2) return `Stage ${n} of ${total}: second brand review (mark asset).`;
  return `Stage ${n} of ${total}: brand review.`;
}

async function grantPreviewFor(
  record: { campaignEndsOn: string; requesterId: string; assetId: string },
  conditions: { kind: ConditionKind; value: string | null }[],
  cfg: Config,
): Promise<{ notBefore: string | null; notAfter: string; cap: string; zeroLength: boolean }> {
  const now = await readClock(cfg);
  const approvalDate = localDateOf(now, cfg);
  const licence = await query<{ default_duration_days: number }>(
    'SELECT l.default_duration_days FROM licences l JOIN assets a ON a.licence_id = l.id WHERE a.id = $1',
    [record.assetId],
  );
  const engagement = await query<{ engagement_ends_on: string | null }>(
    'SELECT o.engagement_ends_on::text FROM organisations o JOIN principals p ON p.organisation_id = o.id WHERE p.id = $1',
    [record.requesterId],
  );
  const expiryOverride = conditions.find((c) => c.kind === 'expiry_override')?.value ?? null;
  const window = grantWindow({
    campaignEndsOn: record.campaignEndsOn,
    approvalDate,
    defaultDurationDays: licence[0]?.default_duration_days ?? 90,
    expiryOverride,
    engagementEndsOn: engagement[0]?.engagement_ends_on ?? null,
  });
  return window;
}

function localDateOf(now: Date, cfg: Config): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.appTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(now);
}

export { tierHours, formatDateTime, formatDay };
