// Restatement storage: reading, the audit-writing change primitive, and the view shape.

import { many, numberOrNull, numberValue, one, text, textOrNull, toTimestamp, type Queryable, type Row } from "./db.ts";
import { rowsJson, rowsOf, type StoredRows } from "./restatementRows.ts";
import type { Facts } from "../shared/restatementRules.ts";
import type { AuditAction, AuditEntryView, RestatementState, RestatementView, ShareEventView } from "../shared/domain.ts";
import { formatInstant } from "../shared/newyork.ts";

export interface StoredShareEvent {
  id: string;
  kind: ShareEventView["kind"];
  shares: string;
  effectiveDate: string;
}

export interface Restatement {
  id: string;
  version: number;
  weekEnding: string;
  state: RestatementState;
  supersedes: string | null;
  correctionReason: string | null;
  rows: StoredRows;
  shareEvents: StoredShareEvent[];
  accession: string | null;
  exhibitPage: number | null;
  exhibit: { status: "verified" | "rejected"; sha256: string; bytes: number; key: string | null } | null;
  preparedBy: string;
  clearedBy: string | null;
  releasedBy: string | null;
  returnNote: string | null;
  releaseAt: number | null;
  publishedAt: number | null;
  supersededBy: string | null;
  createdAt: number;
  updatedAt: number;
}

const COLUMNS = `id, version, week_ending::text AS week_ending, state, supersedes, correction_reason, rows, accession,
  exhibit_page, exhibit_status, exhibit_sha256, exhibit_bytes, exhibit_key, prepared_by, cleared_by, released_by,
  return_note, release_at, published_at, superseded_by, created_at, updated_at`;

function stateOf(value: string): RestatementState {
  switch (value) {
    case "draft":
    case "in_review":
    case "returned":
    case "cleared":
    case "queued":
    case "published":
    case "superseded":
      return value;
    default:
      throw new TypeError("unknown restatement state");
  }
}

function kindOf(value: string): StoredShareEvent["kind"] {
  switch (value) {
    case "atm_settlement":
    case "warrant_exercise":
    case "buyback":
      return value;
    default:
      throw new TypeError("unknown share event kind");
  }
}

async function shareEventsOf(q: Queryable, id: string): Promise<StoredShareEvent[]> {
  const rows = await many(q, "SELECT id, kind, shares, effective_date::text AS effective_date FROM share_events WHERE restatement_id = $1 ORDER BY position", [id]);
  return rows.map((row) => ({ id: text(row, "id"), kind: kindOf(text(row, "kind")), shares: text(row, "shares"), effectiveDate: text(row, "effective_date") }));
}

async function restatementOf(q: Queryable, row: Row): Promise<Restatement> {
  const status = textOrNull(row, "exhibit_status");
  return {
    id: text(row, "id"),
    version: numberValue(row, "version"),
    weekEnding: text(row, "week_ending"),
    state: stateOf(text(row, "state")),
    supersedes: textOrNull(row, "supersedes"),
    correctionReason: textOrNull(row, "correction_reason"),
    rows: rowsOf(row["rows"]),
    shareEvents: await shareEventsOf(q, text(row, "id")),
    accession: textOrNull(row, "accession"),
    exhibitPage: numberOrNull(row, "exhibit_page"),
    exhibit:
      status === "verified" || status === "rejected"
        ? { status, sha256: text(row, "exhibit_sha256"), bytes: numberValue(row, "exhibit_bytes"), key: textOrNull(row, "exhibit_key") }
        : null,
    preparedBy: text(row, "prepared_by"),
    clearedBy: textOrNull(row, "cleared_by"),
    releasedBy: textOrNull(row, "released_by"),
    returnNote: textOrNull(row, "return_note"),
    releaseAt: numberOrNull(row, "release_at"),
    publishedAt: numberOrNull(row, "published_at"),
    supersededBy: textOrNull(row, "superseded_by"),
    createdAt: numberValue(row, "created_at"),
    updatedAt: numberValue(row, "updated_at"),
  };
}

/** `lock` takes the row lock that serialises every change to one restatement. */
export async function findRestatement(q: Queryable, id: string, lock = false): Promise<Restatement | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = await one(q, `SELECT ${COLUMNS} FROM restatements WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  return row ? restatementOf(q, row) : null;
}

export async function listRestatements(q: Queryable): Promise<Restatement[]> {
  const rows = await many(q, `SELECT ${COLUMNS} FROM restatements ORDER BY week_ending DESC, created_at DESC`);
  const restatements: Restatement[] = [];
  for (const row of rows) restatements.push(await restatementOf(q, row));
  return restatements;
}

export async function latestPublished(q: Queryable): Promise<Restatement | null> {
  const row = await one(q, `SELECT ${COLUMNS} FROM restatements WHERE state = 'published' ORDER BY week_ending DESC LIMIT 1`);
  return row ? restatementOf(q, row) : null;
}

export async function publishedBefore(q: Queryable, weekEnding: string): Promise<Restatement | null> {
  const row = await one(q, `SELECT ${COLUMNS} FROM restatements WHERE state = 'published' AND week_ending < $1 ORDER BY week_ending DESC LIMIT 1`, [weekEnding]);
  return row ? restatementOf(q, row) : null;
}

export function factsOf(restatement: Restatement): Facts {
  return {
    state: restatement.state,
    version: restatement.version,
    preparedBy: restatement.preparedBy,
    clearedBy: restatement.clearedBy,
    releaseAt: restatement.releaseAt,
  };
}

async function personOf(q: Queryable, id: string | null): Promise<{ id: string; name: string } | null> {
  if (id === null) return null;
  const row = await one(q, "SELECT id, name FROM staff_users WHERE id = $1", [id]);
  return row ? { id: text(row, "id"), name: text(row, "name") } : null;
}

export async function viewOf(q: Queryable, restatement: Restatement): Promise<RestatementView> {
  const prepared = await personOf(q, restatement.preparedBy);
  if (!prepared) throw new TypeError("restatement has no preparer");
  return {
    id: restatement.id,
    version: restatement.version,
    week_ending: restatement.weekEnding,
    state: restatement.state,
    supersedes: restatement.supersedes,
    correction_reason: restatement.correctionReason,
    rows: restatement.rows,
    share_events: restatement.shareEvents.map((event) => ({ id: event.id, kind: event.kind, shares: event.shares, effective_date: event.effectiveDate })),
    accession: restatement.accession,
    exhibit_page: restatement.exhibitPage,
    exhibit: restatement.exhibit,
    prepared_by: prepared,
    cleared_by: await personOf(q, restatement.clearedBy),
    released_by: await personOf(q, restatement.releasedBy),
    return_note: restatement.returnNote,
    release_at: restatement.releaseAt === null ? null : formatInstant(restatement.releaseAt),
    published_at: restatement.publishedAt === null ? null : formatInstant(restatement.publishedAt),
    superseded_by: restatement.supersededBy,
    created_at: formatInstant(restatement.createdAt),
    updated_at: formatInstant(restatement.updatedAt),
  };
}

export async function auditTrail(q: Queryable, restatementId: string): Promise<AuditEntryView[]> {
  const rows = await many(
    q,
    `SELECT a.version, a.action, a.at, a.from_state, a.to_state, a.note, a.actor_id, u.name AS actor_name
       FROM restatement_audit a LEFT JOIN staff_users u ON u.id = a.actor_id
      WHERE a.restatement_id = $1 ORDER BY a.version`,
    [restatementId],
  );
  return rows.map((row) => {
    const actorId = textOrNull(row, "actor_id");
    const fromState = textOrNull(row, "from_state");
    return {
      version: numberValue(row, "version"),
      action: auditActionOf(text(row, "action")),
      actor: actorId === null ? null : { id: actorId, name: text(row, "actor_name") },
      at: formatInstant(numberValue(row, "at")),
      from_state: fromState === null ? null : stateOf(fromState),
      to_state: stateOf(text(row, "to_state")),
      note: textOrNull(row, "note"),
    };
  });
}

function auditActionOf(value: string): AuditAction {
  switch (value) {
    case "create":
    case "edit":
    case "exhibit_pending":
    case "exhibit_verified":
    case "exhibit_rejected":
    case "submit":
    case "return":
    case "clear":
    case "release_queued":
    case "publish":
    case "withdraw":
    case "supersede":
      return value;
    default:
      throw new TypeError("unknown audit action");
  }
}

interface Change {
  action: AuditAction;
  actorId: string | null;
  at: number;
  toState: RestatementState;
  note?: string | null;
  /** Column assignments applied with the change, e.g. `{ cleared_by: id }`. Values are bound as parameters. */
  set?: Record<string, unknown>;
}

const SETTABLE = new Set([
  "correction_reason", "rows", "accession", "exhibit_page", "exhibit_status", "exhibit_sha256", "exhibit_bytes", "exhibit_key",
  "cleared_by", "released_by", "return_note", "release_at", "published_at", "superseded_by",
]);

const TIMESTAMP_COLUMNS = new Set(["release_at", "published_at"]);

/**
 * Every stored change to a restatement goes through here: the version rises by exactly one, the
 * state and listed columns change, and exactly one audit entry with that version is written.
 */
export async function applyChange(q: Queryable, current: Restatement, change: Change): Promise<Restatement> {
  const assignments: string[] = ["version = version + 1", "state = $2", "updated_at = $3"];
  const params: unknown[] = [current.id, change.toState, toTimestamp(change.at)];
  for (const [column, value] of Object.entries(change.set ?? {})) {
    if (!SETTABLE.has(column)) throw new RangeError("column cannot be changed");
    params.push(column === "rows" ? (value === null ? null : rowsJson(rowsOf(value))) : TIMESTAMP_COLUMNS.has(column) && typeof value === "number" ? toTimestamp(value) : value);
    assignments.push(`${column} = $${params.length}${column === "rows" ? "::jsonb" : TIMESTAMP_COLUMNS.has(column) ? "::timestamptz" : ""}`);
  }
  const updated = await one(q, `UPDATE restatements SET ${assignments.join(", ")} WHERE id = $1 AND version = $${params.length + 1} RETURNING version`, [...params, current.version]);
  if (!updated) throw new Error("restatement changed underneath a locked change");
  const version = numberValue(updated, "version");
  await q.query(
    `INSERT INTO restatement_audit (restatement_id, version, action, actor_id, at, from_state, to_state, note)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)`,
    [current.id, version, change.action, change.actorId, toTimestamp(change.at), change.action === "create" ? null : current.state, change.toState, change.note ?? null],
  );
  const next = await findRestatement(q, current.id);
  if (!next) throw new Error("restatement vanished");
  return next;
}

/** Replaces the share events of a restatement, in request order. */
export async function replaceShareEvents(q: Queryable, restatementId: string, events: ReadonlyArray<{ kind: string; shares: string; effectiveDate: string }>): Promise<void> {
  await q.query("DELETE FROM share_events WHERE restatement_id = $1", [restatementId]);
  let position = 0;
  for (const event of events) {
    await q.query("INSERT INTO share_events (restatement_id, position, kind, shares, effective_date) VALUES ($1, $2, $3, $4, $5)", [restatementId, position, event.kind, event.shares, event.effectiveDate]);
    position += 1;
  }
}

interface NewDraft {
  weekEnding: string;
  supersedes: string | null;
  correctionReason: string | null;
  rows: StoredRows;
  shareEvents: ReadonlyArray<{ kind: string; shares: string; effectiveDate: string }>;
  accession: string | null;
  exhibitPage: number | null;
  preparedBy: string;
  at: number;
}

/** Version 1, state draft, with its `create` audit entry. */
export async function insertDraft(q: Queryable, draft: NewDraft): Promise<Restatement> {
  const row = await one(
    q,
    `INSERT INTO restatements (version, week_ending, state, supersedes, correction_reason, rows, accession, exhibit_page, prepared_by, created_at, updated_at)
     VALUES (1, $1, 'draft', $2, $3, $4::jsonb, $5, $6, $7, $8::timestamptz, $8::timestamptz) RETURNING id`,
    [draft.weekEnding, draft.supersedes, draft.correctionReason, rowsJson(draft.rows), draft.accession, draft.exhibitPage, draft.preparedBy, toTimestamp(draft.at)],
  );
  if (!row) throw new Error("draft was not stored");
  const id = text(row, "id");
  await replaceShareEvents(q, id, draft.shareEvents);
  await q.query(
    "INSERT INTO restatement_audit (restatement_id, version, action, actor_id, at, from_state, to_state, note) VALUES ($1, 1, 'create', $2, $3::timestamptz, NULL, 'draft', NULL)",
    [id, draft.preparedBy, toTimestamp(draft.at)],
  );
  const created = await findRestatement(q, id);
  if (!created) throw new Error("draft vanished");
  return created;
}
