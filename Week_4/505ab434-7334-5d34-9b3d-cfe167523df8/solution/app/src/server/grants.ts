// Grants: the window of a minted grant, derived status, minting and the grant projection
// (brief: Business rules / Grant window, Proofs).
import { CARD_NAME_SQL } from "./availability.ts";
import type { Tx } from "./db.ts";
import { config } from "./config.ts";
import { addDays, endOfDay, localDate } from "../shared/dates.ts";
import {
  GRANT_CAPS,
  GRANT_STATUS_LABELS,
  type ConditionKind,
  type GrantCap,
  type GrantStatus,
  type Role,
} from "../shared/domain.ts";
import type { GrantPreview, GrantView } from "../shared/api.ts";

export interface GrantRow {
  id: string;
  holder_type: "principal" | "group";
  holder_id: string;
  asset_id: string;
  variant_id: string | null;
  request_id: string | null;
  not_before: string | null;
  not_after: string;
  status: GrantStatus;
  cap: GrantCap | null;
  revoked_reason: string | null;
}

interface WindowInput {
  approvalDate: string;
  campaignEndsOn: string;
  defaultDurationDays: number;
  expiryOverrides: readonly string[];
  engagementEndsOn: string | null;
}

/** The earliest of the four caps (ties keep the first cap in the published order) and whether it falls before the start. */
export function grantWindow(input: WindowInput): GrantPreview {
  const candidates: { cap: GrantCap; date: string }[] = [
    { cap: "campaign end", date: input.campaignEndsOn },
    { cap: "licence term", date: addDays(input.approvalDate, input.defaultDurationDays) },
    ...input.expiryOverrides.map((date) => ({ cap: "expiry override" as const, date })),
    ...(input.engagementEndsOn ? [{ cap: "engagement end" as const, date: input.engagementEndsOn }] : []),
  ];
  const earliest = candidates.reduce((best, next) =>
    next.date < best.date || (next.date === best.date && GRANT_CAPS.indexOf(next.cap) < GRANT_CAPS.indexOf(best.cap)) ? next : best,
  );
  return { notBefore: input.approvalDate, notAfter: earliest.date, cap: earliest.cap, zeroLength: earliest.date < input.approvalDate };
}

/** The status callers see: an active grant past the end of its last day is Expired. */
export function visibleStatus(grant: Pick<GrantRow, "status" | "not_after">, now: string): GrantStatus {
  return grant.status === "active" && now > endOfDay(grant.not_after, config.timeZone) ? "expired" : grant.status;
}

export const grantStatusLabel = (grant: Pick<GrantRow, "status" | "not_after">, now: string): string =>
  GRANT_STATUS_LABELS[visibleStatus(grant, now)];

/** Window of a request about to be approved at the app clock. */
export async function previewFor(
  tx: Tx,
  request: { id: string; requester_id: string; asset_id: string; campaign_ends_on: string },
): Promise<GrantPreview> {
  const licence = (await tx.one<{ default_duration_days: number }>(
    "SELECT l.default_duration_days FROM assets a JOIN licences l ON l.id = a.licence_id WHERE a.id = $1", [request.asset_id]))!;
  const org = (await tx.one<{ engagement_ends_on: string | null }>(
    "SELECT o.engagement_ends_on FROM principals p JOIN organisations o ON o.id = p.organisation_id WHERE p.id = $1", [request.requester_id]))!;
  const overrides = await tx.q<{ value: string }>("SELECT value FROM conditions WHERE request_id = $1 AND kind = 'expiry_override'", [request.id]);
  return grantWindow({
    approvalDate: localDate(tx.now, config.timeZone),
    campaignEndsOn: request.campaign_ends_on,
    defaultDurationDays: licence.default_duration_days,
    expiryOverrides: overrides.map((o) => o.value),
    engagementEndsOn: org.engagement_ends_on,
  });
}

/** Mints the grant of an approved request, copying its conditions, and records `grant.minted`. */
export async function mintGrant(
  tx: Tx,
  request: { id: string; requester_id: string; asset_id: string; variant_id: string | null; campaign_ends_on: string },
  actor: { id: string; role: Role | "system" },
): Promise<GrantRow> {
  const preview = await previewFor(tx, request);
  const conditions = await tx.q<{ kind: ConditionKind; text: string }>("SELECT kind, text FROM conditions WHERE request_id = $1 ORDER BY position", [request.id]);
  const needsProof = conditions.some((c) => c.kind === "proof_required");
  const status: GrantStatus = preview.zeroLength ? "zero_length" : needsProof ? "pending_proof" : "active";
  const notBefore = needsProof ? null : preview.notBefore;
  const id = `GR-${String(await tx.next("grant")).padStart(4, "0")}`;
  await tx.q(
    `INSERT INTO grants (id, holder_type, holder_id, asset_id, variant_id, request_id, not_before, not_after, status, cap)
     VALUES ($1,'principal',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, request.requester_id, request.asset_id, request.variant_id, request.id, notBefore, preview.notAfter, status, preview.cap],
  );
  for (const [i, c] of conditions.entries()) {
    await tx.q("INSERT INTO grant_conditions (grant_id, position, kind, text) VALUES ($1,$2,$3,$4)", [id, i + 1, c.kind, c.text]);
  }
  tx.audit({
    actorId: actor.id,
    actorRole: actor.role,
    action: "grant.minted",
    resourceType: "grant",
    resourceId: id,
    requestId: request.id,
    before: null,
    after: { notAfter: preview.notAfter, notBefore, status },
  });
  return (await tx.one<GrantRow>("SELECT * FROM grants WHERE id = $1", [id]))!;
}

/** The full grant projection for the admin screens and the holder. */
export async function grantView(tx: Tx, grant: GrantRow): Promise<GrantView> {
  const card = await tx.one<{ card_name: string }>(
    `SELECT ${CARD_NAME_SQL} AS card_name
       FROM assets a LEFT JOIN variants v ON v.id = $2 WHERE a.id = $1`,
    [grant.asset_id, grant.variant_id],
  );
  const holder =
    grant.holder_type === "principal"
      ? (await tx.one<{ name: string }>("SELECT display_name AS name FROM principals WHERE id = $1", [grant.holder_id]))!
      : (await tx.one<{ name: string }>("SELECT name FROM groups WHERE id = $1", [grant.holder_id]))!;
  const conditions = await tx.q<{ kind: ConditionKind; text: string }>("SELECT kind, text FROM grant_conditions WHERE grant_id = $1 ORDER BY position", [grant.id]);
  const status = visibleStatus(grant, tx.now);
  return {
    id: grant.id,
    status,
    statusLabel: GRANT_STATUS_LABELS[status],
    holder: { type: grant.holder_type, id: grant.holder_id, displayName: holder.name },
    cardName: card!.card_name,
    requestId: grant.request_id,
    notBefore: grant.not_before,
    notAfter: grant.not_after,
    cap: grant.cap,
    conditions,
    revokedReason: grant.revoked_reason,
  };
}

/** Principals who hold a grant: the holder, or every member of the holding group. */
export async function holderPrincipals(tx: Tx, grant: Pick<GrantRow, "holder_type" | "holder_id">): Promise<string[]> {
  if (grant.holder_type === "principal") return [grant.holder_id];
  return (await tx.q<{ principal_id: string }>("SELECT principal_id FROM group_members WHERE group_id = $1", [grant.holder_id])).map((m) => m.principal_id);
}
