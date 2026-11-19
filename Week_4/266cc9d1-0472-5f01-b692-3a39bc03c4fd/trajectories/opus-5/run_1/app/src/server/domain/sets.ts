/**
 * Findings sets: the state machine, submit and freeze, the evidence pack,
 * review links and forester decisions.
 */

import { config } from "../config.js";
import { isUniqueViolation, query, queryOne, withTransaction, type Tx } from "../db.js";
import {
  FIELD_MESSAGES,
  conflict,
  illegalTransition,
  notFound,
  validationFailed,
  type FieldErrors,
  type SetAction,
} from "../errors.js";
import { newId, newReviewToken } from "../ids.js";
import { linkEmailState, recordEmail, type EmailState } from "../services/mail.js";
import {
  evidenceObjectKey,
  getObject,
  putObject,
  sha256Hex,
} from "../services/storage.js";
import { findingPayload, type FindingRow } from "./findings.js";
import { activeAssets, listAssetFiles } from "./assets.js";
import { countOf, linkExpiryLine } from "../../shared/format.js";
import type { CorridorRow } from "./corridors.js";

export type SetState =
  | "draft"
  | "submitted"
  | "under_review"
  | "accepted"
  | "disputed"
  | "closed";

export interface SetRow {
  id: string;
  tenant_id: string;
  corridor_id: string;
  revision: number;
  state: SetState;
  previous_set_id: string | null;
  label_seq: number;
  submitted_at: Date | null;
  submitted_by: string | null;
  frozen_finding_count: number | null;
  frozen_violation_count: number | null;
  created_at: Date;
}

export interface ReviewLinkRow {
  id: string;
  set_id: string;
  token: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export type LinkStatus = "live" | "revoked" | "expired";

/** Link liveness and expiry are judged by the server clock, on every read. */
export function linkStatus(link: ReviewLinkRow, now = new Date()): LinkStatus {
  if (link.revoked_at !== null) return "revoked";
  if (link.expires_at.getTime() <= now.getTime()) return "expired";
  return "live";
}

export interface ReviewLinkPayload {
  url: string;
  expires_at: string;
  status: LinkStatus;
  email_state: EmailState;
}

export async function reviewLinkPayload(link: ReviewLinkRow): Promise<ReviewLinkPayload> {
  return {
    url: `${config.publicUrl}/review/${link.token}`,
    expires_at: link.expires_at.toISOString(),
    status: linkStatus(link),
    email_state: await linkEmailState(link.id),
  };
}

export async function findSet(setId: string): Promise<SetRow | null> {
  return queryOne<SetRow>("SELECT * FROM findings_sets WHERE id = $1", [setId]);
}

export async function latestLink(setId: string): Promise<ReviewLinkRow | null> {
  return queryOne<ReviewLinkRow>(
    "SELECT * FROM review_links WHERE set_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
    [setId],
  );
}

export async function decisionsFor(
  setId: string,
): Promise<Record<string, { decision: string; note: string }>> {
  const rows = await query<{ finding_id: string; decision: string; note: string }>(
    "SELECT finding_id, decision, note FROM decisions WHERE set_id = $1",
    [setId],
  );
  const map: Record<string, { decision: string; note: string }> = {};
  for (const row of rows) map[row.finding_id] = { decision: row.decision, note: row.note };
  return map;
}

export interface SetPayload {
  id: string;
  corridor_id: string;
  revision: number;
  state: SetState;
  previous_set_id: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  frozen: { finding_count: number; violation_count: number } | null;
  review_link: ReviewLinkPayload | null;
  decisions: Record<string, { decision: string; note: string }>;
}

export async function setPayload(
  set: SetRow,
  options: { includeLink: boolean } = { includeLink: true },
): Promise<SetPayload> {
  const link = options.includeLink ? await latestLink(set.id) : null;
  return {
    id: set.id,
    corridor_id: set.corridor_id,
    revision: set.revision,
    state: set.state,
    previous_set_id: set.previous_set_id,
    submitted_at: set.submitted_at ? set.submitted_at.toISOString() : null,
    submitted_by: set.submitted_by,
    frozen:
      set.frozen_finding_count === null || set.frozen_violation_count === null
        ? null
        : {
            finding_count: set.frozen_finding_count,
            violation_count: set.frozen_violation_count,
          },
    review_link: link ? await reviewLinkPayload(link) : null,
    decisions: await decisionsFor(set.id),
  };
}

/** The only place that decides whether a set action is legal. */
function assertTransition(state: SetState, action: SetAction): void {
  const allowed: Record<SetAction, SetState[]> = {
    submit: ["draft"],
    close: ["accepted"],
    revise: ["disputed"],
    regenerate: ["submitted", "under_review", "accepted", "disputed"],
  };
  if (!allowed[action].includes(state)) throw illegalTransition(state, action);
}

export async function createSet(tenantId: string, corridorId: string): Promise<SetRow> {
  try {
    return await withTransaction(async (tx) => {
      const highest = await tx.queryOne<{ revision: number }>(
        "SELECT coalesce(max(revision), 0) AS revision FROM findings_sets WHERE corridor_id = $1",
        [corridorId],
      );
      const row = await tx.queryOne<SetRow>(
        `INSERT INTO findings_sets (id, tenant_id, corridor_id, revision, state)
         VALUES ($1,$2,$3,$4,'draft') RETURNING *`,
        [newId("set"), tenantId, corridorId, (highest?.revision ?? 0) + 1],
      );
      return row!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("open_set_exists", "This corridor already has a findings set that is open.");
    }
    throw error;
  }
}

export interface EvidencePack {
  set_id: string;
  corridor_id: string;
  revision: number;
  submitted_at: string;
  frozen: { finding_count: number; violation_count: number };
  findings: unknown[];
  assets: unknown[];
}

async function buildEvidencePack(
  set: SetRow,
  findings: FindingRow[],
  submittedAt: string,
  frozen: { finding_count: number; violation_count: number },
): Promise<EvidencePack> {
  const active = await activeAssets(set.corridor_id);
  const assets: unknown[] = [];
  for (const [kind, assetId] of Object.entries(active)) {
    if (!assetId) continue;
    const files = await listAssetFiles(assetId);
    assets.push({
      id: assetId,
      kind,
      files: files.map((file) => ({
        path: file.path,
        size_bytes: Number(file.size_bytes),
        sha256: file.sha256,
      })),
    });
  }
  return {
    set_id: set.id,
    corridor_id: set.corridor_id,
    revision: set.revision,
    submitted_at: submittedAt,
    frozen,
    findings: findings.map((row) => {
      const payload = findingPayload(row);
      return {
        label: payload.label,
        ecef_m: payload.ecef_m,
        lon_deg: payload.lon_deg,
        lat_deg: payload.lat_deg,
        ground_height_m: payload.ground_height_m,
        terrain_level: payload.terrain_level,
        canopy_top_height_m: payload.canopy_top_height_m,
        canopy_radius_m: payload.canopy_radius_m,
        chainage_m: payload.chainage_m,
        span_label: payload.span.label,
        clearance_m: payload.clearance_m,
        status: payload.status,
        comment: payload.comment,
      };
    }),
    assets,
  };
}

function reviewEmailBody(
  url: string,
  expiresAt: Date,
  timeZone: string,
  frozen: { finding_count: number; violation_count: number },
): string {
  return [
    url,
    linkExpiryLine(expiresAt.toISOString(), timeZone),
    `${countOf(frozen.finding_count, "finding")}, ${countOf(frozen.violation_count, "violation")}`,
    "",
  ].join("\n");
}

export interface SubmitResult {
  set: SetRow;
  link: ReviewLinkRow;
  emailId: string;
}

/**
 * Freezes the counts, writes the evidence pack, mints the link and records the
 * email in one transaction. The email is attempted only after commit.
 */
export async function submitSet(
  set: SetRow,
  corridor: CorridorRow,
  staffId: string,
): Promise<SubmitResult> {
  assertTransition(set.state, "submit");

  return withTransaction(async (tx) => {
    const locked = await tx.queryOne<SetRow>(
      "SELECT * FROM findings_sets WHERE id = $1 FOR UPDATE",
      [set.id],
    );
    if (!locked) throw notFound();
    assertTransition(locked.state, "submit");

    const findings = await tx.query<FindingRow>(
      "SELECT * FROM findings WHERE set_id = $1 ORDER BY chainage_m, label_n",
      [set.id],
    );
    if (findings.length === 0) {
      throw validationFailed({ findings: FIELD_MESSAGES.submitEmptyDraft });
    }

    const submittedAt = new Date();
    const frozen = {
      finding_count: findings.length,
      violation_count: findings.filter((row) => row.status === "violation").length,
    };
    const token = newReviewToken();
    const expiresAt = new Date(submittedAt.getTime() + config.reviewLinkTtlSeconds * 1000);

    const updated = await tx.queryOne<SetRow>(
      `UPDATE findings_sets SET state = 'submitted', submitted_at = $2, submitted_by = $3,
         frozen_finding_count = $4, frozen_violation_count = $5
       WHERE id = $1 RETURNING *`,
      [set.id, submittedAt.toISOString(), staffId, frozen.finding_count, frozen.violation_count],
    );
    const link = await tx.queryOne<ReviewLinkRow>(
      `INSERT INTO review_links (id, set_id, token, expires_at)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [newId("lnk"), set.id, token, expiresAt.toISOString()],
    );
    const emailId = await recordEmail(tx, {
      kind: "review_link",
      reviewLinkId: link!.id,
      to: corridor.forester_email,
      subject: `Spanwise review: ${corridor.name} revision ${locked.revision}`,
      body: reviewEmailBody(
        `${config.publicUrl}/review/${token}`,
        expiresAt,
        corridor.time_zone,
        frozen,
      ),
    });

    const pack = await buildEvidencePack(set, findings, submittedAt.toISOString(), frozen);
    const packBytes = new TextEncoder().encode(`${JSON.stringify(pack, null, 2)}\n`);
    await putObject(
      evidenceObjectKey(set.tenant_id, set.corridor_id, set.id),
      packBytes,
      sha256Hex(packBytes),
    );

    return { set: updated!, link: link!, emailId };
  });
}

export async function closeSet(set: SetRow): Promise<SetRow> {
  assertTransition(set.state, "close");
  return withTransaction(async (tx) => {
    const locked = await tx.queryOne<SetRow>(
      "SELECT * FROM findings_sets WHERE id = $1 FOR UPDATE",
      [set.id],
    );
    if (!locked) throw notFound();
    assertTransition(locked.state, "close");
    const updated = await tx.queryOne<SetRow>(
      "UPDATE findings_sets SET state = 'closed' WHERE id = $1 RETURNING *",
      [set.id],
    );
    return updated!;
  });
}

/** Closes the disputed set and opens the next revision with its findings copied. */
export async function reviseSet(set: SetRow): Promise<SetRow> {
  assertTransition(set.state, "revise");
  return withTransaction(async (tx) => {
    const locked = await tx.queryOne<SetRow>(
      "SELECT * FROM findings_sets WHERE id = $1 FOR UPDATE",
      [set.id],
    );
    if (!locked) throw notFound();
    assertTransition(locked.state, "revise");
    await tx.query("UPDATE findings_sets SET state = 'closed' WHERE id = $1", [set.id]);
    const created = await tx.queryOne<SetRow>(
      `INSERT INTO findings_sets
         (id, tenant_id, corridor_id, revision, state, previous_set_id, label_seq)
       VALUES ($1,$2,$3,$4,'draft',$5,$6) RETURNING *`,
      [
        newId("set"),
        locked.tenant_id,
        locked.corridor_id,
        locked.revision + 1,
        locked.id,
        locked.label_seq,
      ],
    );
    await tx.query(
      `INSERT INTO findings (
         id, set_id, label_n, chainage_m, offset_m, lon_deg, lat_deg,
         ecef_x, ecef_y, ecef_z, ground_height_m, terrain_level,
         canopy_height_m, canopy_top_height_m, canopy_radius_m,
         span_from, span_to, clearance_m, status, comment)
       SELECT
         'fnd-' || substr(md5(random()::text || id), 1, 24), $2, label_n, chainage_m, offset_m,
         lon_deg, lat_deg, ecef_x, ecef_y, ecef_z, ground_height_m, terrain_level,
         canopy_height_m, canopy_top_height_m, canopy_radius_m,
         span_from, span_to, clearance_m, status, comment
       FROM findings WHERE set_id = $1 ORDER BY label_n`,
      [locked.id, created!.id],
    );
    return created!;
  });
}

export async function resendLink(
  set: SetRow,
  corridor: CorridorRow,
): Promise<{ link: ReviewLinkRow; emailId: string }> {
  const link = await latestLink(set.id);
  if (!link || linkStatus(link) !== "live") {
    throw conflict("link_not_live", "This review link is no longer live.");
  }
  const emailId = await withTransaction(async (tx) =>
    recordEmail(tx, {
      kind: "review_link",
      reviewLinkId: link.id,
      to: corridor.forester_email,
      subject: `Spanwise review: ${corridor.name} revision ${set.revision}`,
      body: reviewEmailBody(
        `${config.publicUrl}/review/${link.token}`,
        link.expires_at,
        corridor.time_zone,
        {
          finding_count: set.frozen_finding_count ?? 0,
          violation_count: set.frozen_violation_count ?? 0,
        },
      ),
    }),
  );
  return { link, emailId };
}

export async function revokeLink(set: SetRow): Promise<ReviewLinkRow> {
  const link = await latestLink(set.id);
  if (!link || linkStatus(link) !== "live") {
    throw conflict("link_not_live", "This review link is no longer live.");
  }
  const updated = await queryOne<ReviewLinkRow>(
    "UPDATE review_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING *",
    [link.id],
  );
  if (!updated) throw conflict("link_not_live", "This review link is no longer live.");
  return updated;
}

/** Revokes the current link and mints exactly one replacement. */
export async function regenerateLink(
  set: SetRow,
  corridor: CorridorRow,
): Promise<{ link: ReviewLinkRow; emailId: string }> {
  assertTransition(set.state, "regenerate");
  const token = newReviewToken();
  const expiresAt = new Date(Date.now() + config.reviewLinkTtlSeconds * 1000);
  return withTransaction(async (tx) => {
    const locked = await tx.queryOne<SetRow>(
      "SELECT * FROM findings_sets WHERE id = $1 FOR UPDATE",
      [set.id],
    );
    if (!locked) throw notFound();
    assertTransition(locked.state, "regenerate");
    await tx.query(
      "UPDATE review_links SET revoked_at = now() WHERE set_id = $1 AND revoked_at IS NULL",
      [set.id],
    );
    const link = await tx.queryOne<ReviewLinkRow>(
      "INSERT INTO review_links (id, set_id, token, expires_at) VALUES ($1,$2,$3,$4) RETURNING *",
      [newId("lnk"), set.id, token, expiresAt.toISOString()],
    );
    const emailId = await recordEmail(tx, {
      kind: "review_link",
      reviewLinkId: link!.id,
      to: corridor.forester_email,
      subject: `Spanwise review: ${corridor.name} revision ${locked.revision}`,
      body: reviewEmailBody(`${config.publicUrl}/review/${token}`, expiresAt, corridor.time_zone, {
        finding_count: locked.frozen_finding_count ?? 0,
        violation_count: locked.frozen_violation_count ?? 0,
      }),
    });
    return { link: link!, emailId };
  });
}

export async function readEvidence(set: SetRow): Promise<Uint8Array | null> {
  if (set.submitted_at === null) return null;
  return getObject(evidenceObjectKey(set.tenant_id, set.corridor_id, set.id));
}

export interface DecisionInput {
  decision: "accept" | "dispute";
  note: string;
}

export function validateDecision(body: unknown): DecisionInput {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const fields: FieldErrors = {};
  const decision = record.decision;
  if (decision !== "accept" && decision !== "dispute") {
    fields.decision = FIELD_MESSAGES.decision;
  }
  const note = record.note === undefined ? "" : record.note;
  if (typeof note !== "string" || note.length > 2000) {
    fields.note = FIELD_MESSAGES.comment;
  } else if (decision === "dispute" && note.trim() === "") {
    fields.note = FIELD_MESSAGES.disputeNote;
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return { decision: decision as "accept" | "dispute", note: note as string };
}

/** Any successful review-link request moves a submitted set under review. */
export async function markUnderReview(setId: string): Promise<void> {
  await query("UPDATE findings_sets SET state = 'under_review' WHERE id = $1 AND state = 'submitted'", [
    setId,
  ]);
}

export async function storeDecision(
  set: SetRow,
  findingId: string,
  input: DecisionInput,
): Promise<DecisionInput> {
  return withTransaction(async (tx) => {
    const locked = await tx.queryOne<SetRow>(
      "SELECT * FROM findings_sets WHERE id = $1 FOR UPDATE",
      [set.id],
    );
    if (!locked) throw notFound();
    if (locked.state !== "submitted" && locked.state !== "under_review") {
      throw conflict("review_closed", "This review is already complete.");
    }
    await tx.query("UPDATE findings_sets SET state = 'under_review' WHERE id = $1 AND state = 'submitted'", [
      set.id,
    ]);
    await tx.query(
      `INSERT INTO decisions (set_id, finding_id, decision, note)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (set_id, finding_id)
       DO UPDATE SET decision = excluded.decision, note = excluded.note, decided_at = now()`,
      [set.id, findingId, input.decision, input.note],
    );
    return input;
  });
}

export interface CompleteResult {
  set: SetRow;
  summary: { accepted: number; disputed: number };
  emailId: string | null;
}

export async function completeReview(
  set: SetRow,
  corridor: CorridorRow,
): Promise<CompleteResult> {
  return withTransaction(async (tx) => {
    const locked = await tx.queryOne<SetRow>(
      "SELECT * FROM findings_sets WHERE id = $1 FOR UPDATE",
      [set.id],
    );
    if (!locked) throw notFound();
    if (locked.state !== "submitted" && locked.state !== "under_review") {
      throw conflict("review_closed", "This review is already complete.");
    }
    const findings = await tx.query<{ id: string; label_n: number }>(
      "SELECT id, label_n FROM findings WHERE set_id = $1 ORDER BY label_n",
      [set.id],
    );
    const decisions = await tx.query<{ finding_id: string; decision: string; note: string }>(
      "SELECT finding_id, decision, note FROM decisions WHERE set_id = $1",
      [set.id],
    );
    const byFinding = new Map(decisions.map((row) => [row.finding_id, row]));
    if (findings.some((finding) => !byFinding.has(finding.id))) {
      throw validationFailed({ decisions: FIELD_MESSAGES.completeUndecided });
    }

    const accepted = decisions.filter((row) => row.decision === "accept").length;
    const disputed = decisions.length - accepted;
    const nextState: SetState = disputed > 0 ? "disputed" : "accepted";
    const updated = await tx.queryOne<SetRow>(
      "UPDATE findings_sets SET state = $2 WHERE id = $1 RETURNING *",
      [set.id, nextState],
    );

    const lines = findings.map((finding) => {
      const decision = byFinding.get(finding.id)!;
      return decision.decision === "accept"
        ? `F-${finding.label_n} accepted`
        : `F-${finding.label_n} disputed: ${decision.note}`;
    });
    const analyst = locked.submitted_by
      ? await tx.queryOne<{ email: string }>("SELECT email FROM staff WHERE id = $1", [
          locked.submitted_by,
        ])
      : null;
    const emailId = analyst
      ? await recordEmail(tx, {
          kind: "decision_summary",
          reviewLinkId: null,
          to: analyst.email,
          subject: `Spanwise decision: ${corridor.name} revision ${locked.revision} ${nextState}`,
          body: `${lines.join("\n")}\n`,
        })
      : null;

    return { set: updated!, summary: { accepted, disputed }, emailId };
  });
}
