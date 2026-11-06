import type { Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { toInstant } from "../../shared/instants.js";
import { OFFICE_META, type Office } from "../../shared/domain.js";
import { autoReleaseInstant } from "./time.js";
import { queueEmail } from "./outbox.js";
import { formatDay } from "../../shared/format.js";
import type { SessionMember } from "./sessions.js";

export interface OptionRow {
  id: string;
  talent_id: string;
  client_id: string;
  date: string | Date;
  job_title: string;
  note: string | null;
  rank: number | null;
  state: string;
  auto_release_at: Date;
  hold_until: Date | null;
  release_at: Date;
  challenge_deadline: Date | null;
  placed_by: string;
  placed_at: Date;
  released_at: Date | null;
  release_reason: string | null;
  booked_booking_id: string | null;
  version: number;
  sequence: number;
}

export function optionView(row: OptionRow & { client_company: string; placed_by_name: string; office: string }): Record<string, unknown> {
  const state = row.state === "confirmed" ? "confirmed" : row.state === "challenged" ? "challenged" : row.state === "placed" ? "placed" : row.state === "expired" ? "expired" : "released";
  return {
    id: row.id,
    talentId: row.talent_id,
    clientId: row.client_id,
    clientCompany: row.client_company,
    date: iso(row.date as string | Date),
    jobTitle: row.job_title,
    note: row.note,
    rank: row.rank,
    state,
    autoReleaseAt: toInstant(row.auto_release_at),
    holdUntil: row.hold_until ? toInstant(row.hold_until) : null,
    holdUntilLocal: row.hold_until ? holdUntilLocal(row.hold_until, row.office) : null,
    releaseAt: toInstant(row.release_at),
    challengeDeadline: row.challenge_deadline ? toInstant(row.challenge_deadline) : null,
    placedBy: { id: row.placed_by, name: row.placed_by_name },
    placedAt: toInstant(row.placed_at),
    releasedAt: row.released_at ? toInstant(row.released_at) : null,
    releaseReason: row.release_reason,
    version: row.version,
  };
}

function iso(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

function holdUntilLocal(instant: Date, office: string): string {
  const tz = OFFICE_META[office as Office].timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

export interface QueryRow { date: string }
export interface ClosuresQuery { query(text: string, params?: unknown[]): Promise<QueryRow[]> }

export async function closuresFor(tx: ClosuresQuery, office: Office): Promise<Set<string>> {
  const rows = await tx.query(`SELECT to_char(date, 'YYYY-MM-DD') AS date FROM office_closures WHERE office = $1`, [office]);
  return new Set(rows.map((r) => r.date));
}

export async function ladderForDay(tx: Tx, talentId: string, date: string | Date): Promise<Array<OptionRow & { client_company: string; placed_by_name: string; office: string }>> {
  const rows = await tx.query<OptionRow & { client_company: string; placed_by_name: string; office: string }>(
    `SELECT o.*, c.company AS client_company, m.name AS placed_by_name, t.office AS office
     FROM options o
     JOIN clients c ON c.id = o.client_id
     JOIN members m ON m.id = o.placed_by
     JOIN talent t ON t.id = o.talent_id
     WHERE o.talent_id = $1 AND o.date = $2::date
     ORDER BY (CASE WHEN o.state IN ('placed','challenged') THEN 0 ELSE 1 END), o.rank NULLS LAST, o.sequence`,
    [talentId, date]
  );
  return rows;
}

export function liveStates(): string[] {
  return ["placed", "challenged"];
}

/** Renumbers the live options of a talent-day so ranks stay 1..n with no gaps. */
export async function reladder(tx: Tx, talentId: string, date: string | Date): Promise<void> {
  const rows = await ladderForDay(tx, talentId, date);
  const live = rows.filter((r) => liveStates().includes(r.state));
  let rank = 1;
  for (const row of live) {
    if (row.rank !== rank) {
        await tx.query(`UPDATE options SET rank = $2::int, version = version + 1 WHERE id = $1 AND rank IS DISTINCT FROM $2::int`, [row.id, rank]);
    }
    rank += 1;
  }
}

export interface PlaceInput {
  talentId: string;
  clientId: string;
  date: string;
  jobTitle: string;
  note: string | null;
  holdUntil: Date | null;
  member: SessionMember;
  now: Date;
}

export async function placeOption(tx: Tx, input: PlaceInput): Promise<{ row: OptionRow; conflicts: string | null }> {
  const talent = await tx.one<{ id: string; office: string; state: string; display_name: string }>(`SELECT id, office, state, display_name FROM talent WHERE id = $1`, [input.talentId]);
  if (!talent || talent.state === "erased") throw errors.notFound();
  const office = talent.office as Office;
  const closures = await closuresFor(tx, office);
  const dayRows = await ladderForDay(tx, input.talentId, input.date);
  const live = dayRows.filter((r) => liveStates().includes(r.state));
  if (live.length >= 3) throw errors.conflict("ladder_full");
  if (live.some((r) => r.client_id === input.clientId)) throw errors.conflict("client_already_holds");
  if (dayRows.some((r) => r.state === "confirmed")) throw errors.conflict("day_booked");
  const auto = autoReleaseInstant(input.date, office, closures);
  if (auto.getTime() <= input.now.getTime()) {
    throw errors.validation({ date: "Options can be placed only while this day's automatic release is still ahead, up to 31 Dec 2027." });
  }
  if (input.date > "2027-12-31") {
    throw errors.validation({ date: "Options can be placed only while this day's automatic release is still ahead, up to 31 Dec 2027." });
  }
  const rank = live.length + 1;
  const id = `opt_${Math.random().toString(36).slice(2, 12)}`;
  const sequence = await nextSequence(tx);
  const releaseAt = input.holdUntil && input.holdUntil < auto ? input.holdUntil : auto;
  const row = await tx.one<OptionRow>(
    `INSERT INTO options (id, talent_id, client_id, date, job_title, note, rank, state, auto_release_at, hold_until, release_at, placed_by, sequence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'placed', $8, $9, $10, $11, $12) RETURNING *`,
    [id, input.talentId, input.clientId, input.date, input.jobTitle, input.note, rank, auto, input.holdUntil, releaseAt, input.member.id, sequence]
  );
  if (!row) throw new Error("insert failed");
  return { row, conflicts: null };
}

async function nextSequence(tx: Tx): Promise<number> {
  const row = await tx.one<{ value: number }>(`UPDATE counters SET value = value + 1 WHERE name = 'option_sequence' RETURNING value`);
  if (!row) {
    await tx.query(`INSERT INTO counters (name, value) VALUES ('option_sequence', 1) ON CONFLICT DO NOTHING`);
    const again = await tx.one<{ value: number }>(`UPDATE counters SET value = value + 1 WHERE name = 'option_sequence' RETURNING value`);
    return again ? again.value : 1;
  }
  return row.value;
}

export async function releaseOption(tx: Tx, optionId: string, now: Date, reason: string): Promise<OptionRow> {
  const row = await loadOption(tx, optionId);
  await tx.query(
    `UPDATE options SET state = 'released', released_at = $2, release_reason = $3, rank = NULL, version = version + 1, challenge_deadline = NULL WHERE id = $1`,
    [optionId, now, reason]
  );
  await reladder(tx, row.talent_id, row.date);
  const fresh = await loadOption(tx, optionId);
  return fresh;
}

export async function expireOption(tx: Tx, optionId: string, now: Date, reason: string): Promise<OptionRow> {
  const row = await loadOption(tx, optionId);
  await tx.query(
    `UPDATE options SET state = 'expired', released_at = $2, release_reason = $3, rank = NULL, version = version + 1 WHERE id = $1`,
    [optionId, now, reason]
  );
  await reladder(tx, row.talent_id, row.date);
  return await loadOption(tx, optionId);
}

export async function loadOption(tx: Tx, id: string): Promise<OptionRow> {
  const row = await tx.one<OptionRow>(`SELECT * FROM options WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  return row;
}

export function optionWithClient(tx: Tx, id: string): Promise<(OptionRow & { client_company: string; placed_by_name: string; office: string }) | null> {
  return tx.one<OptionRow & { client_company: string; placed_by_name: string; office: string }>(
    `SELECT o.*, c.company AS client_company, m.name AS placed_by_name, t.office AS office
     FROM options o JOIN clients c ON c.id = o.client_id JOIN members m ON m.id = o.placed_by JOIN talent t ON t.id = o.talent_id
     WHERE o.id = $1`,
    [id]
  );
}

/** Challenge outcome emails, sent exactly once per release. */
export async function queueChallengeOutcomeEmails(
  tx: Tx,
  input: { releasedOption: { talentId: string; clientId: string; date: string; state: string; rank: number | null }; promotedClientId: string | null; booked: boolean; talentName: string }
): Promise<void> {
  const clients = await tx.query<{ id: string; company: string; contact_email: string }>(
    `SELECT id, company, contact_email FROM clients WHERE id = ANY($1::text[])`,
    [[input.releasedOption.clientId, input.promotedClientId].filter((x): x is string => !!x)]
  );
  const day = formatDay(input.releasedOption.date);
  const subject = `Option update: ${input.talentName} on ${day}`;
  for (const client of clients) {
    const isReleasedClient = client.id === input.releasedOption.clientId;
    let line: string;
    if (input.booked) line = "This day is now booked.";
    else if (isReleasedClient) line = "Your 1st option was released.";
    else line = "Your option is now 1st.";
    const body = [`Hello,`, ``, line, ``, `Talent: ${input.talentName}`, `Day: ${day}`, ``, `Vesper & Rowe Talent`].join("\r\n");
    await queueEmail({ to: client.contact_email, subject, body });
  }
}

export function addDaysStr(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

