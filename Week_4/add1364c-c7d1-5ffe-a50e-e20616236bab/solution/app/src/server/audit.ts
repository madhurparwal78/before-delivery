import type { Db, Tx } from "./db.js";
import { newId } from "./crypto.js";
import { now } from "./clock.js";
import { invalid } from "./http.js";
import { officeMoment, utcIso } from "./office-time.js";

export type Actor = { personId: string; name: string } | "system";

interface Subject {
  kind: "login" | "vault" | "vendor" | "person" | "rule" | "rotation" | "review" | "import";
  id: string;
  name: string;
}

interface AuditRow {
  seq: number;
  id: string;
  at: Date;
  office_day: string;
  actor_person_id: string | null;
  actor_name: string;
  action: string;
  subject_kind: string;
  subject_id: string;
  subject_name: string;
  details: Record<string, unknown>;
}

/** The only writer of audit entries. `at` is the scheduled instant for timed events. */
export async function record(
  tx: Tx,
  actor: Actor,
  action: string,
  subject: Subject,
  details: Record<string, unknown> = {},
  at: Date = now(),
): Promise<{ id: string }> {
  const id = newId();
  await tx.query(
    `INSERT INTO audit (id, at, office_day, actor_person_id, actor_name, action, subject_kind, subject_id, subject_name, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      at,
      officeMoment(at).date,
      actor === "system" ? null : actor.personId,
      actor === "system" ? "Lockset" : actor.name,
      action,
      subject.kind,
      subject.id,
      subject.name,
      JSON.stringify(details),
    ],
  );
  return { id };
}

function view(row: AuditRow): Record<string, unknown> {
  const moment = officeMoment(row.at);
  return {
    id: row.id,
    seq: row.seq,
    at: utcIso(row.at),
    office_day: row.office_day,
    office_time: moment.time,
    offset: moment.offset,
    actor: row.actor_person_id ? { person_id: row.actor_person_id, name: row.actor_name } : { system: "Lockset" },
    action: row.action,
    subject: { kind: row.subject_kind, id: row.subject_id, name: row.subject_name },
    details: row.details,
  };
}

export type AuditOrder = "oldest" | "newest";

function encodeCursor(day: string, order: AuditOrder, seq: number): string {
  return Buffer.from(JSON.stringify({ d: day, o: order, s: seq })).toString("base64url");
}

function decodeCursor(cursor: string, day: string, order: AuditOrder): number {
  const refuse = (): never => {
    throw invalid({ after: "That cursor cannot be used for this day and order." });
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return refuse();
  }
  if (typeof parsed !== "object" || parsed === null) return refuse();
  const { d, o, s } = parsed as { d?: unknown; o?: unknown; s?: unknown };
  if (d !== day || o !== order || typeof s !== "number" || !Number.isInteger(s)) return refuse();
  return s;
}

/** One office day of audit entries, paged by keyset on seq (never by position). */
export async function page(
  db: Db,
  day: string,
  order: AuditOrder,
  limit: number,
  after: string | null,
): Promise<{ office_day: string; order: AuditOrder; entries: Record<string, unknown>[]; next_cursor: string | null }> {
  const cursorSeq = after === null ? null : decodeCursor(after, day, order);
  const compare = order === "oldest" ? ">" : "<";
  const rows = await db.query<AuditRow>(
    `SELECT * FROM audit WHERE office_day = $1 ${cursorSeq === null ? "" : `AND seq ${compare} $3`}
     ORDER BY seq ${order === "oldest" ? "ASC" : "DESC"} LIMIT $2`,
    cursorSeq === null ? [day, limit + 1] : [day, limit + 1, cursorSeq],
  );
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    office_day: day,
    order,
    entries: shown.map(view),
    next_cursor: rows.length > limit && last ? encodeCursor(day, order, last.seq) : null,
  };
}
