// The append-only activity log, newest first through an opaque keyset cursor (adapted from kit/modules/cursor).
import { db, newId, type Db } from "./db.js";
import { FIELD, invalid } from "./errors.js";

type ActivityAction =
  | "workshop.created"
  | "workshop.transitioned"
  | "join_link.rotated"
  | "join_link.turned_off"
  | "invites.sent"
  | "frame.trashed"
  | "frame.restored"
  | "frame.purged"
  | "version.restored"
  | "note.facilitator_only_changed"
  | "plan.changed"
  | "plan.change_scheduled"
  | "payment.retried"
  | "sponsor.invoiced"
  | "recap.completed";

const SYSTEM_ACTIONS: readonly ActivityAction[] = ["frame.purged", "sponsor.invoiced", "recap.completed"];

export async function record(t: Db, facilitatorId: string, action: ActivityAction, workshopId: string | null): Promise<void> {
  await t.run("INSERT INTO activity (id, facilitator_id, actor, action, workshop_id) VALUES ($1, $2, $3, $4, $5)", [
    newId(),
    facilitatorId,
    SYSTEM_ACTIONS.includes(action) ? "system" : "facilitator",
    action,
    workshopId,
  ]);
}

function encodeCursor(seq: number): string {
  return Buffer.from(JSON.stringify([seq])).toString("base64url");
}

function decodeCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(value) && value.length === 1 && Number.isInteger(value[0]) ? (value[0] as number) : null;
  } catch {
    return null;
  }
}

export async function listActivity(facilitatorId: string, query: URLSearchParams) {
  const fields: Record<string, string> = {};
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? 20 : /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!(limit >= 1 && limit <= 100)) fields.limit = FIELD.other;
  const rawCursor = query.get("cursor");
  const before = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && before === null) fields.cursor = FIELD.cursor;
  if (Object.keys(fields).length) invalid(fields);
  const rows = await db.rows<{ id: string; seq: number; at: Date; actor: string; action: string; workshop_id: string | null }>(
    `SELECT id, seq, at, actor, action, workshop_id FROM activity
     WHERE facilitator_id = $1 AND ($2::bigint IS NULL OR seq < $2) ORDER BY seq DESC LIMIT $3`,
    [facilitatorId, before, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    entries: page.map((r) => ({ id: r.id, seq: r.seq, at: r.at.toISOString(), actor: r.actor, action: r.action, workshopId: r.workshop_id })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.seq) : null,
  };
}
