// The findings-set state machine: every legal transition is decided here.
import type { Db } from "../db.js";
import { fail } from "../http/errors.js";
import { emailState } from "../outbox.js";
import { acceptsFindingChanges, nextState, reviewOpen, type SetAction, type SetState } from "../../shared/findingsSetRules.js";
import { linkStatus, linkUrl } from "./reviewLink.js";

export type { SetState };

/** The state a set action leads to; any action the transition table does not allow answers the published 409. */
export function transition(state: SetState, action: SetAction): SetState {
  const next = nextState(state, action);
  if (next === null) {
    throw fail.conflict("illegal_transition", `Cannot ${action} a ${state} findings set.`, { from: state, action });
  }
  return next;
}

export function requireDraft(state: SetState): void {
  if (!acceptsFindingChanges(state)) throw fail.conflict("set_not_draft", "This findings set is no longer a draft.");
}

export function requireReviewOpen(state: SetState): void {
  if (!reviewOpen(state)) throw fail.conflict("review_closed", "Decisions for this revision are final.");
}

/** Complete moves the set to accepted when every decision accepts, otherwise to disputed. */
export function completionState(decisions: readonly string[]): "accepted" | "disputed" {
  return decisions.every((d) => d === "accept") ? "accepted" : "disputed";
}

/** The submitted → under_review transition, made by any successful review-link request. */
export async function markUnderReview(db: Db, setId: string): Promise<void> {
  await db.query("UPDATE findings_sets SET state = 'under_review' WHERE id = $1 AND state = 'submitted'", [setId]);
}

export interface SetRow {
  id: string;
  corridor_id: string;
  tenant_id: string;
  revision: number;
  state: SetState;
  previous_set_id: string | null;
  submitted_at: Date | null;
  submitted_by: string | null;
  frozen_finding_count: number | null;
  frozen_violation_count: number | null;
}

export interface LinkRow {
  id: string;
  set_id: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
}

const SET_SELECT = `
  SELECT s.id, s.corridor_id, c.tenant_id, s.revision, s.state, s.previous_set_id, s.submitted_at, s.submitted_by,
         s.frozen_finding_count, s.frozen_violation_count
    FROM findings_sets s JOIN corridors c ON c.id = s.corridor_id`;

/** The caller's tenant's set (locked for the transaction when `lock`); anything else answers 404. */
export async function loadSet(db: Db, tenantId: string, setId: string, lock: boolean): Promise<SetRow> {
  const found = await db.query<SetRow>(
    `${SET_SELECT} WHERE s.id = $1 AND c.tenant_id = $2 ${lock ? "FOR UPDATE OF s" : ""}`,
    [setId, tenantId],
  );
  const row = found.rows[0];
  if (row === undefined) throw fail.notFound();
  return row;
}

export async function latestLink(db: Db, setId: string): Promise<LinkRow | null> {
  const found = await db.query<LinkRow>(
    "SELECT id, set_id, token, expires_at, revoked_at FROM review_links WHERE set_id = $1 ORDER BY minted_at DESC, id DESC LIMIT 1",
    [setId],
  );
  return found.rows[0] ?? null;
}

export async function linkJson(db: Db, link: LinkRow): Promise<Record<string, unknown>> {
  return {
    url: linkUrl(link.token),
    expires_at: link.expires_at.toISOString(),
    status: linkStatus(link),
    email_state: await emailState(db, link.id),
  };
}

export async function decisionsOf(db: Db, setId: string): Promise<Record<string, { decision: string; note: string }>> {
  const found = await db.query<{ finding_id: string; decision: string; note: string }>(
    "SELECT finding_id, decision, note FROM decisions WHERE set_id = $1 ORDER BY finding_id",
    [setId],
  );
  return Object.fromEntries(found.rows.map((r) => [r.finding_id, { decision: r.decision, note: r.note }]));
}

/** The Set as the API publishes it; review routes publish it without its link. */
export async function setJson(db: Db, set: SetRow, withLink: boolean): Promise<Record<string, unknown>> {
  const link = withLink ? await latestLink(db, set.id) : null;
  return {
    id: set.id,
    corridor_id: set.corridor_id,
    revision: set.revision,
    state: set.state,
    previous_set_id: set.previous_set_id,
    submitted_at: set.submitted_at === null ? null : set.submitted_at.toISOString(),
    submitted_by: set.submitted_by,
    frozen:
      set.frozen_finding_count === null || set.frozen_violation_count === null
        ? null
        : { finding_count: set.frozen_finding_count, violation_count: set.frozen_violation_count },
    review_link: link === null ? null : await linkJson(db, link),
    decisions: await decisionsOf(db, set.id),
  };
}
