import { NIGHT_NUMBER } from "../domain/constants";
import { tableOrder } from "../domain/services";
import type { Answer, Dispute, Round, Table, TableTeam } from "../domain/types";
import type { DbClient, DbStore } from "./db";
import type { PoolClient } from "pg";

export function toIsoTime(date: Date): string {
  return date.toISOString();
}

export function secondsLeftFrom(closesAt: Date | null, now: Date): number | null {
  if (closesAt === null) return null;
  const diff = closesAt.getTime() - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / 1000);
}

export function roundToApi(
  row: {
    readonly number: number;
    readonly title: string;
    readonly kind: "standard" | "picture";
    readonly status: "drafted" | "open" | "closed" | "marked" | "published";
    readonly opened_at: Date | null;
    readonly closes_at: Date | null;
    readonly closed_at: Date | null;
  },
  sheet: {
    readonly key: string;
    readonly sha256: string;
    readonly size: number;
    readonly width: number;
    readonly height: number;
  } | null,
  now: Date,
): Round {
  return {
    number: row.number,
    title: row.title,
    kind: row.kind,
    status: row.status,
    opened_at: row.opened_at === null ? null : toIsoTime(row.opened_at),
    closes_at: row.closes_at === null ? null : toIsoTime(row.closes_at),
    closed_at: row.closed_at === null ? null : toIsoTime(row.closed_at),
    seconds_left: row.status === "open" ? secondsLeftFrom(row.closes_at, now) : null,
    sheet:
      row.kind === "picture"
        ? sheet === null
          ? { status: "not_stored", key: null, size: null, sha256: null, width: null, height: null }
          : {
              status: "stored",
              key: sheet.key,
              size: sheet.size,
              sha256: sheet.sha256,
              width: sheet.width,
              height: sheet.height,
            }
        : null,
  };
}

export function answerToApi(row: {
  readonly id: number | string;
  readonly round: number | string;
  readonly team_id: number | string;
  readonly team_name: string;
  readonly question: number | string;
  readonly text: string;
  readonly submitted_at: Date;
  readonly current: boolean;
  readonly mark: number | null;
  readonly ruled: number | null;
}): Answer {
  return {
    id: Number(row.id),
    round: Number(row.round),
    team_id: Number(row.team_id),
    team_name: row.team_name,
    question: Number(row.question),
    text: row.text,
    submitted_at: toIsoTime(row.submitted_at),
    current: row.current,
    mark: row.mark,
    ruled: row.ruled,
  };
}

export function disputeToApi(row: {
  readonly id: number | string;
  readonly answer_id: number | string;
  readonly team_id: number | string;
  readonly round: number | string;
  readonly question: number | string;
  readonly answer_text: string;
  readonly reason: string;
  readonly status: "raised" | "upheld" | "dismissed";
  readonly raised_at: Date;
  readonly ruled_at: Date | null;
  readonly note: "queued" | "sent" | null;
}): Dispute {
  return {
    id: Number(row.id),
    answer_id: Number(row.answer_id),
    team_id: Number(row.team_id),
    round: Number(row.round),
    question: Number(row.question),
    answer_text: row.answer_text,
    reason: row.reason,
    status: row.status,
    raised_at: toIsoTime(row.raised_at),
    ruled_at: row.ruled_at === null ? null : toIsoTime(row.ruled_at),
    note: row.note,
  };
}

export async function loadRounds(
  store: DbStore,
): Promise<{ rows: RoundLoad[]; sheets: Map<number, SheetLoad> }> {
  const result = await store.query(
    `SELECT number, title, kind, status, opened_at, closes_at, closed_at FROM rounds ORDER BY number`,
  );
  const sheetResult = await store.query(
    `SELECT round, key, sha256, size, width, height, content_type FROM sheets ORDER BY round`,
  );
  const sheets = new Map<number, SheetLoad>();
  for (const row of sheetResult.rows) sheets.set(Number(row["round"]), row as unknown as SheetLoad);
  return {
    rows: result.rows as unknown as RoundLoad[],
    sheets,
  };
}

export interface RoundLoad {
  readonly number: number;
  readonly title: string;
  readonly kind: "standard" | "picture";
  readonly status: "drafted" | "open" | "closed" | "marked" | "published";
  readonly opened_at: Date | null;
  readonly closes_at: Date | null;
  readonly closed_at: Date | null;
}

export interface SheetLoad {
  readonly round: number;
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly content_type: string;
}

export async function loadRound(store: DbStore, number: number): Promise<{ row: RoundLoad | null; sheet: SheetLoad | null }> {
  const result = await store.query(
    `SELECT number, title, kind, status, opened_at, closes_at, closed_at FROM rounds WHERE number = $1`,
    [number],
  );
  if (result.rowCount === 0) return { row: null, sheet: null };
  const row = result.rows[0] as unknown as RoundLoad;
  if (row.kind !== "picture") return { row, sheet: null };
  const sheetResult = await store.query(
    `SELECT round, key, sha256, size, width, height, content_type FROM sheets WHERE round = $1`,
    [number],
  );
  const sheet = sheetResult.rowCount === 0 ? null : (sheetResult.rows[0] as unknown as SheetLoad);
  return { row, sheet };
}

export async function loadTeams(store: DbStore): Promise<{ id: number; name: string; total: number }[]> {
  const result = await store.query(`SELECT id, name FROM teams`);
  const scoreResult = await store.query(
    `SELECT team_id, SUM(score) AS total FROM published_scores GROUP BY team_id`,
  );
  const totals = new Map<number, number>();
  for (const row of scoreResult.rows) totals.set(Number(row["team_id"]), Number(row["total"]));
  return result.rows.map((row) => ({
    id: Number(row["id"]),
    name: String(row["name"]),
    total: totals.get(Number(row["id"])) ?? 0,
  }));
}

export async function loadLastPublishedRound(store: DbStore): Promise<number | null> {
  const result = await store.query(
    `SELECT value FROM league_meta WHERE key = 'last_published_round'`,
  );
  const value = result.rows[0]?.["value"];
  return typeof value === "string" && value !== "" ? Number.parseInt(value, 10) : null;
}

export async function loadTableVersion(store: DbStore): Promise<number> {
  const result = await store.query(`SELECT value FROM league_meta WHERE key = 'table_version'`);
  const value = result.rows[0]?.["value"];
  return typeof value === "string" && Number.parseInt(value, 10) >= 1 ? Number.parseInt(value, 10) : 1;
}

export async function loadRoundScores(store: DbStore, round: number): Promise<{ team_id: number; score: number }[]> {
  const result = await store.query(
    `SELECT a.team_id, SUM(COALESCE(a.ruled, 0)) AS score
       FROM answers a
      WHERE a.round = $1 AND a.current = true
      GROUP BY a.team_id`,
    [round],
  );
  return result.rows.map((row) => ({ team_id: Number(row["team_id"]), score: Number(row["score"]) }));
}

/** The one league table: totals are the sum of published scores, ordered by the tie rule. */
export async function loadTable(store: DbStore): Promise<Table> {
  const version = await loadTableVersion(store);
  const lastPublished = await loadLastPublishedRound(store);
  const teams = await loadTeams(store);
  const ordered = tableOrder(teams.map((t) => ({ team_id: t.id, name: t.name, total: t.total })));
  const scores =
    lastPublished === null
      ? new Map<number, number>()
      : new Map((await loadRoundScores(store, lastPublished)).map((r) => [r.team_id, r.score]));
  const teamsOut: TableTeam[] = ordered.map((entry) => ({
    position: entry.position,
    team_id: entry.team_id,
    name: entry.name,
    total: entry.total,
    last_round: lastPublished === null ? null : { round: lastPublished, score: scores.get(entry.team_id) ?? 0 },
  }));
  return { night: NIGHT_NUMBER, version, last_published_round: lastPublished, teams: teamsOut };
}

export async function withTransaction<T>(client: PoolClient, work: (client: PoolClient) => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function withStoreTransaction<T>(client: DbClient, work: (client: DbClient) => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
