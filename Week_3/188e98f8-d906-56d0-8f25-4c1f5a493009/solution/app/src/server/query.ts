import type { Answer, Dispute, Round, Sheet } from "../shared/api-types";
import type { Db } from "./db";

/** ISO 8601 in UTC with milliseconds and a trailing Z. */
const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** From closes_at on, an open round is closed, whether or not any request arrived. */
export async function sweepRounds(db: Db): Promise<void> {
  await db.query("UPDATE rounds SET status = 'closed', closed_at = closes_at WHERE status = 'open' AND closes_at <= clock_timestamp()");
}

const ROUND_COLUMNS = `
  number, title, kind, status,
  ${iso("opened_at")} AS opened_at, ${iso("closes_at")} AS closes_at, ${iso("closed_at")} AS closed_at,
  CASE WHEN status = 'open' THEN ceil(extract(epoch FROM (closes_at - clock_timestamp())))::int END AS seconds_left,
  sheet_key, sheet_size, sheet_sha256, sheet_width, sheet_height`;

interface RoundRow {
  number: number;
  title: string;
  kind: Round["kind"];
  status: Round["status"];
  opened_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  seconds_left: number | null;
  sheet_key: string | null;
  sheet_size: number | null;
  sheet_sha256: string | null;
  sheet_width: number | null;
  sheet_height: number | null;
}

function sheetOf(row: RoundRow): Sheet | null {
  if (row.kind === "standard") return null;
  return {
    status: row.sheet_key === null ? "not_stored" : "stored",
    key: row.sheet_key,
    size: row.sheet_size,
    sha256: row.sheet_sha256,
    width: row.sheet_width,
    height: row.sheet_height,
  };
}

function toRound(row: RoundRow): Round {
  return {
    number: row.number,
    title: row.title,
    kind: row.kind,
    status: row.status,
    opened_at: row.opened_at,
    closes_at: row.closes_at,
    closed_at: row.closed_at,
    seconds_left: row.seconds_left,
    sheet: sheetOf(row),
  };
}

export async function loadRounds(db: Db): Promise<Round[]> {
  const result = await db.query<RoundRow>(`SELECT ${ROUND_COLUMNS} FROM rounds ORDER BY number`);
  return result.rows.map(toRound);
}

export async function loadRound(db: Db, number: number): Promise<Round | null> {
  const result = await db.query<RoundRow>(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE number = $1`, [number]);
  const row = result.rows[0];
  return row === undefined ? null : toRound(row);
}

export const ANSWER_COLUMNS = `
  ra.id, ra.round, ra.team_id, t.name AS team_name, ra.question, ra.text,
  ${iso("ra.submitted_at")} AS submitted_at, ra.current, ra.mark, ra.ruled`;
export const ANSWER_FROM = "ruled_answers ra JOIN teams t ON t.id = ra.team_id";

export async function loadAnswer(db: Db, id: number): Promise<Answer | null> {
  const result = await db.query<Answer>(`SELECT ${ANSWER_COLUMNS} FROM ${ANSWER_FROM} WHERE ra.id = $1`, [id]);
  return result.rows[0] ?? null;
}

const DISPUTE_COLUMNS = `
  d.id, d.answer_id, d.team_id, a.round, a.question, a.text AS answer_text, d.reason, d.status,
  ${iso("d.raised_at")} AS raised_at, ${iso("d.ruled_at")} AS ruled_at, d.note`;
const DISPUTE_FROM = "disputes d JOIN answers a ON a.id = d.answer_id";

export async function loadDispute(db: Db, id: number): Promise<Dispute | null> {
  const result = await db.query<Dispute>(`SELECT ${DISPUTE_COLUMNS} FROM ${DISPUTE_FROM} WHERE d.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function loadDisputes(db: Db, teamId: number | null): Promise<Dispute[]> {
  const result = await db.query<Dispute>(
    `SELECT ${DISPUTE_COLUMNS} FROM ${DISPUTE_FROM} WHERE ($1::int IS NULL OR d.team_id = $1) ORDER BY d.id`,
    [teamId],
  );
  return result.rows;
}
