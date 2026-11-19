// What a caller may see of a request, and its detail projection (brief: Projected shapes / Request detail).
import { CARD_NAME_SQL } from "./availability.ts";
import type { Tx } from "./db.ts";
import { grantStatusLabel, previewFor, visibleStatus, type GrantRow } from "./grants.ts";
import { loadStages, openStage, type RequestRow } from "./requestWorkflow.ts";
import { stageLabel, stageReason } from "./routing.ts";
import { liveRules } from "./rules.ts";
import {
  DECISION_LABELS,
  PROOF_STATUS_LABELS,
  REQUEST_STATE_LABELS,
  REVIEW_ROLES,
  applicationOf,
  type AssetClass,
  type ConditionKind,
  type ProofStatus,
} from "../shared/domain.ts";
import type { Principal, RequestDetail } from "../shared/api.ts";

/** The requester, brand and legal reviewers and the owner may open a request; everyone else sees nothing. */
export const canSeeRequest = (principal: Principal, req: Pick<RequestRow, "requester_id">): boolean =>
  REVIEW_ROLES.includes(principal.role) || principal.id === req.requester_id;

interface Names {
  requester_name: string;
  organisation_name: string;
  holder_name: string;
  class: AssetClass;
  card_name: string;
}

export async function requestDetail(tx: Tx, principal: Principal, req: RequestRow): Promise<RequestDetail> {
  const names = (await tx.one<Names>(
    `SELECT r.display_name AS requester_name, o.name AS organisation_name, h.display_name AS holder_name, a.class,
            ${CARD_NAME_SQL} AS card_name
       FROM principals r JOIN organisations o ON o.id = r.organisation_id
       JOIN principals h ON h.id = $2 JOIN assets a ON a.id = $3 LEFT JOIN variants v ON v.id = $4
      WHERE r.id = $1`,
    [req.requester_id, req.holder_id, req.asset_id, req.variant_id],
  ))!;
  const stages = await loadStages(tx, req.id);
  const people = new Map(
    (await tx.q<{ id: string; display_name: string }>("SELECT id, display_name FROM principals")).map((p) => [p.id, p.display_name]),
  );
  const kinds = stages.map((s) => s.kind);
  const live = new Set((await liveRules(tx)).map((r) => r.identifier));
  const conditions = await tx.q<{ id: string; kind: ConditionKind; text: string }>("SELECT id, kind, text FROM conditions WHERE request_id = $1 ORDER BY position", [req.id]);
  const grant = await tx.one<GrantRow>("SELECT * FROM grants WHERE request_id = $1 ORDER BY id LIMIT 1", [req.id]);
  const grantConditions = grant
    ? await tx.q<{ kind: ConditionKind; text: string }>("SELECT kind, text FROM grant_conditions WHERE grant_id = $1 ORDER BY position", [grant.id])
    : [];
  const proofs = grant
    ? await tx.q<{ id: string; file_name: string; status: ProofStatus; reason: string | null; uploaded_at: string }>(
        "SELECT id, file_name, status, reason, uploaded_at FROM proofs WHERE grant_id = $1 ORDER BY uploaded_at, id", [grant.id])
    : [];
  const detail: RequestDetail = {
    id: req.id,
    state: req.state,
    stateLabel: REQUEST_STATE_LABELS[req.state],
    holder: { id: req.holder_id, displayName: names.holder_name },
    requester: { id: req.requester_id, displayName: names.requester_name, organisationName: names.organisation_name },
    cardName: names.card_name,
    assetId: req.asset_id,
    variantId: req.variant_id,
    applicationClass: req.application_class,
    applicationLabel: applicationOf(req.application_class)!.label,
    territories: req.territories,
    campaignStartsOn: req.campaign_starts_on,
    campaignEndsOn: req.campaign_ends_on,
    citedRules: req.cited_rules.map((identifier) => ({ identifier, status: live.has(identifier) ? "live" : "withdrawn" })),
    note: req.note,
    submittedAt: req.submitted_at,
    deadline: req.deadline,
    escalation: req.escalation,
    stages: stages.map((s) => ({
      n: s.n,
      kind: s.kind,
      label: stageLabel(kinds, s.n, names.class),
      assigneeName: s.assignee_id ? people.get(s.assignee_id)! : null,
      decision: s.decision,
      decisionLabel: s.decision ? DECISION_LABELS[s.decision] : null,
      decidedByName: s.decided_by ? (s.decided_by === "system" ? "System" : people.get(s.decided_by)!) : null,
      decidedAt: s.decided_at,
      comment: s.comment,
    })),
    conditions,
    grant: grant ? {
      id: grant.id,
      status: visibleStatus(grant, tx.now),
      statusLabel: grantStatusLabel(grant, tx.now),
      notBefore: grant.not_before,
      notAfter: grant.not_after,
      conditions: grantConditions,
      cap: grant.cap,
    } : null,
    proofs: proofs.map((p) => ({
      id: p.id,
      fileName: p.file_name,
      status: p.status,
      statusLabel: PROOF_STATUS_LABELS[p.status],
      reason: p.reason,
      uploadedAt: p.uploaded_at,
    })),
  };
  const open = openStage(stages);
  if (req.state === "under_review" && open && (principal.role === "owner" || open.assignee_id === principal.id)) {
    detail.stageReason = stageReason(kinds, open.n, names.class, detail.applicationLabel);
    detail.grantPreview = await previewFor(tx, req);
  }
  return detail;
}
