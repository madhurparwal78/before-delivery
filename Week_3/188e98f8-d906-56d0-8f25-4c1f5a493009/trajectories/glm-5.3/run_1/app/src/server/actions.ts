import type { DbStore } from "./db";
import {
  answerToApi,
  disputeToApi,
  loadRound,
  loadRoundScores,
  loadTable,
  roundToApi,
  secondsLeftFrom,
  type RoundLoad,
  type SheetLoad,
} from "./repo";
import { fieldProblem, limitFor, normalise } from "../domain/text";
import { ID_KEY_MAX, QUESTIONS_PER_ROUND } from "../domain/constants";
import { foldText } from "../domain/services";
import { isQuestionNumber } from "../domain/numbers";
import { HttpError, conflict, providerUnavailable, tooManySubmits, unprocessable } from "./errors";
import { sameIdempotentRequest } from "./idempotency";
import { submitWait } from "./rate";
import type { Answer, Dispute, RulingValue, Table } from "../domain/types";
import type { SheetStorage } from "./storage";

export interface SubmitItem {
  readonly question: number;
  readonly text: string;
}

export interface OpenOutcome {
  readonly round: RoundLoad;
  readonly sheet: SheetLoad | null;
}

export interface Clock {
  now(): Date;
}

export function serverClock(): Clock {
  return { now: () => new Date() };
}

/** The one late-submit rule: the submit must reach the server before closed_at. */
export async function effectiveStatus(store: DbStore, round: number, clock: Clock): Promise<{ row: RoundLoad; sheet: SheetLoad | null }> {
  const { row, sheet } = await loadRound(store, round);
  if (row === null) throw new HttpError(404, "not_found");
  const now = clock.now();
  if (row.status === "open" && (row.closes_at === null || row.closes_at.getTime() <= now.getTime())) {
    await closeExpired(store, round, row.closes_at, clock);
    const reload = await loadRound(store, round);
    return { row: reload.row!, sheet: reload.sheet };
  }
  return { row, sheet };
}

async function closeExpired(store: DbStore, round: number, closesAt: Date | null, clock: Clock): Promise<void> {
  const client = await store.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE rounds SET status = 'closed', closed_at = $1
        WHERE number = $2 AND status = 'open' AND closes_at <= $1`,
      [closesAt, round],
    );
    await client.query("COMMIT");
    void result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  void clock;
}

export async function openRound(
  store: DbStore,
  storage: SheetStorage,
  round: number,
  roundSeconds: number,
  clock: Clock,
): Promise<OpenOutcome> {
  const { row, sheet } = await loadRound(store, round);
  if (row === null) throw new HttpError(404, "not_found");
  if (row.status !== "drafted") throw conflict("round_not_drafted");
  const openResult = await store.query(
    `SELECT number FROM rounds WHERE status = 'open' AND number <> $1`,
    [round],
  );
  if (openResult.rowCount > 0) throw conflict("another_round_open");
  if (row.kind === "picture") {
    if (sheet === null) throw conflict("sheet_not_stored");
    const confirmed = await storage.confirmStored(sheet.key, sheet.sha256, sheet.size).catch(() => false);
    if (!confirmed) throw providerUnavailable("storage_unavailable");
  }
  const now = clock.now();
  const closesAt = new Date(now.getTime() + roundSeconds * 1000);
  const client = await store.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE rounds SET status = 'open', opened_at = $1, closes_at = $2
        WHERE number = $3 AND status = 'drafted'
          AND NOT EXISTS (SELECT 1 FROM rounds r WHERE r.status = 'open' AND r.number <> $3)`,
      [now.toISOString(), closesAt.toISOString(), round],
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      const recheck = await loadRound(store, round);
      if (recheck.row === null) throw new HttpError(404, "not_found");
      if (recheck.row.status !== "drafted") throw conflict("round_not_drafted");
      throw conflict("another_round_open");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const after = await loadRound(store, round);
  return { round: after.row!, sheet: after.sheet };
}

export async function closeRound(store: DbStore, round: number, clock: Clock): Promise<OpenOutcome> {
  const { row, sheet } = await loadRound(store, round);
  if (row === null) throw new HttpError(404, "not_found");
  const now = clock.now();
  const result = await store.query(
    `UPDATE rounds SET status = 'closed',
       closed_at = CASE WHEN closes_at IS NOT NULL AND closes_at <= $1 THEN closes_at ELSE $1 END
     WHERE number = $2 AND status = 'open'`,
    [now.toISOString(), round],
  );
  if (result.rowCount === 0) {
    if (row.status === "open" && row.closes_at !== null && row.closes_at.getTime() <= now.getTime()) {
      const after = await loadRound(store, round);
      return { round: after.row!, sheet: after.sheet };
    }
    throw conflict("round_not_open");
  }
  const after = await loadRound(store, round);
  return { round: after.row!, sheet: after.sheet };
}

export async function markAnswer(
  store: DbStore,
  round: number,
  answerId: number,
  points: number,
  clock: Clock,
): Promise<Answer> {
  const { row } = await loadRound(store, round);
  if (row === null) throw new HttpError(404, "not_found");
  await closeExpired(store, round, row.status === "open" ? row.closes_at : null, clock);
  const recheck = await loadRound(store, round);
  if (recheck.row === null) throw new HttpError(404, "not_found");
  if (recheck.row.status !== "closed") throw conflict("round_not_closed");
  const result = await store.query(
    `UPDATE answers SET mark = $1, ruled = $1
      WHERE id = $2 AND round = $3 AND current = true`,
    [points, answerId, round],
  );
  if (result.rowCount === 0) {
    const answer = await store.query(
      `SELECT id FROM answers WHERE id = $1 AND round = $2`,
      [answerId, round],
    );
    if (answer.rowCount === 0) throw new HttpError(404, "not_found");
    throw conflict("answer_superseded");
  }
  return await loadAnswer(store, answerId);
}

export async function loadAnswer(store: DbStore, answerId: number): Promise<Answer> {
  const result = await store.query(
    `SELECT a.id, a.round, a.team_id, t.name AS team_name, a.question, a.text,
            a.submitted_at, a.current, a.mark, a.ruled
       FROM answers a JOIN teams t ON t.id = a.team_id
      WHERE a.id = $1`,
    [answerId],
  );
  if (result.rowCount === 0) throw new HttpError(404, "not_found");
  return answerToApi(result.rows[0] as unknown as Parameters<typeof answerToApi>[0]);
}

export async function finishMarking(store: DbStore, round: number, clock: Clock): Promise<OpenOutcome> {
  const { row } = await loadRound(store, round);
  if (row === null) throw new HttpError(404, "not_found");
  await closeExpired(store, round, row.status === "open" ? row.closes_at : null, clock);
  const recheck = await loadRound(store, round);
  if (recheck.row === null) throw new HttpError(404, "not_found");
  if (recheck.row.status !== "closed") throw conflict("round_not_closed");
  const unmarked = await countUnmarked(store, round);
  if (unmarked > 0) throw conflict("unmarked_answers", { count: unmarked });
  const result = await store.query(
    `UPDATE rounds SET status = 'marked' WHERE number = $1 AND status = 'closed'`,
    [round],
  );
  if (result.rowCount === 0) throw conflict("round_not_closed");
  const after = await loadRound(store, round);
  return { round: after.row!, sheet: after.sheet };
}

export async function countUnmarked(store: DbStore, round: number): Promise<number> {
  const result = await store.query(
    `SELECT COUNT(*)::int AS count FROM answers WHERE round = $1 AND current = true AND mark IS NULL`,
    [round],
  );
  const row = result.rows[0] as unknown as { count: number };
  return row["count"];
}

export interface SubmitOutcome {
  readonly round: number;
  readonly accepted: readonly Answer[];
  readonly replayed: boolean;
}

export async function submitAnswers(
  store: DbStore,
  round: number,
  teamId: number,
  items: readonly SubmitItem[],
  idempotencyKey: string | undefined,
  roundSecondsUnused: number,
  clock: Clock,
): Promise<SubmitOutcome> {
  void roundSecondsUnused;
  if (idempotencyKey !== undefined) {
    const stored = await store.query(
      `SELECT round, body, status, response FROM idempotency_records WHERE team_id = $1 AND idem_key = $2`,
      [teamId, idempotencyKey],
    );
    if (stored.rowCount > 0) {
      const record = stored.rows[0] as unknown as { round: number; body: string; status: number; response: string };
      const parsedBody = JSON.parse(record.body) as { answers: readonly SubmitItem[] };
      if (sameIdempotentRequest(record.round, parsedBody, round, { answers: items })) {
        const body = JSON.parse(record.response) as { round: number; accepted: readonly Answer[] };
        return { round: body.round, accepted: body.accepted, replayed: true };
      }
      throw new HttpError(409, "idempotency_conflict");
    }
  }
  const { row } = await effectiveStatus(store, round, clock);
  if (row === null) throw new HttpError(404, "not_found");
  const refusal = row.status === "drafted" ? "round_not_open" : row.status === "open" ? undefined : "round_closed";
  if (refusal !== undefined) throw conflict(refusal);

  const now = clock.now();
  const counted = await store.query(
    `SELECT submitted_at FROM answers
      WHERE team_id = $1 AND submitted_at > $2
      GROUP BY submitted_at
      ORDER BY submitted_at DESC`,
    [teamId, new Date(now.getTime() - 60_000).toISOString()],
  );
  const submitTimes = (counted.rows as unknown as { submitted_at: Date }[]).map((r) => new Date(r["submitted_at"]));
  if (submitTimes.length >= 6) {
    throw tooManySubmits(submitWait(submitTimes, now));
  }

  const accepted: Answer[] = [];
  const client = await store.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      const result = await client.query(
        `UPDATE answers SET current = false
          WHERE round = $1 AND team_id = $2 AND question = $3 AND current = true`,
        [round, teamId, item.question],
      );
      void result;
      const insert = await client.query(
        `INSERT INTO answers (round, team_id, question, text, submitted_at, current, mark, ruled)
         VALUES ($1, $2, $3, $4, $5, true, NULL, NULL)
         RETURNING id, round, team_id, question, text, submitted_at, current, mark, ruled`,
        [round, teamId, item.question, item.text, now.toISOString()],
      );
      const inserted = insert.rows[0] as unknown as Record<string, unknown>;
      accepted.push({
        id: Number(inserted["id"]),
        round: Number(inserted["round"]),
        team_id: Number(inserted["team_id"]),
        team_name: "",
        question: Number(inserted["question"]),
        text: String(inserted["text"]),
        submitted_at: new Date(inserted["submitted_at"] as Date).toISOString(),
        current: true,
        mark: null,
        ruled: null,
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const named = await Promise.all(accepted.map((a) => loadAnswer(store, a.id)));
  if (idempotencyKey !== undefined) {
    await store.query(
      `INSERT INTO idempotency_records (team_id, idem_key, round, body, status, response, created_at)
       VALUES ($1, $2, $3, $4, 201, $5, $6)
       ON CONFLICT (team_id, idem_key) DO NOTHING`,
      [
        teamId,
        idempotencyKey,
        round,
        JSON.stringify({ answers: items }),
        JSON.stringify({ round, accepted: named }),
        now.toISOString(),
      ],
    );
  }
  return { round, accepted: named, replayed: false };
}

export async function raiseDispute(
  store: DbStore,
  teamId: number,
  answerId: number,
  reason: string,
  clock: Clock,
): Promise<Dispute> {
  const result = await store.query(
    `SELECT a.id, a.round, a.team_id, a.question, a.current, a.mark
       FROM answers a WHERE a.id = $1`,
    [answerId],
  );
  if (result.rowCount === 0) throw new HttpError(404, "not_found");
  const answer = result.rows[0] as unknown as {
    id: number;
    round: number;
    team_id: number;
    question: number;
    current: boolean;
    mark: number | null;
  };
  if (answer["team_id"] !== teamId) throw new HttpError(403, "forbidden");
  const { row } = await loadRound(store, Number(answer["round"]));
  if (row === null) throw new HttpError(404, "not_found");
  if (row.status !== "marked") throw conflict("dispute_window_closed");
  if (!answer["current"]) throw conflict("answer_superseded");
  if (answer["mark"] !== 0) throw conflict("answer_not_marked_wrong");
  const now = clock.now();
  const insert = await store.query(
    `INSERT INTO disputes (answer_id, team_id, round, question, answer_text, reason, status, raised_at, note)
     SELECT $1, $2, $3, $4, a.text, $5, 'raised', $6, NULL
       FROM answers a WHERE a.id = $1
     ON CONFLICT (answer_id) DO NOTHING
     RETURNING id, answer_id, team_id, round, question, answer_text, reason, status, raised_at, ruled_at, note`,
    [answerId, teamId, answer["round"], answer["question"], reason, now.toISOString()],
  );
  if (insert.rowCount === 0) throw conflict("dispute_exists");
  return disputeToApi(insert.rows[0] as unknown as Parameters<typeof disputeToApi>[0]);
}

export async function ruleOnDispute(
  store: DbStore,
  disputeId: number,
  ruling: RulingValue,
  clock: Clock,
): Promise<Dispute> {
  const result = await store.query(`SELECT id, status FROM disputes WHERE id = $1`, [disputeId]);
  if (result.rowCount === 0) throw new HttpError(404, "not_found");
  const dispute = result.rows[0] as unknown as { id: number; status: string };
  if (dispute["status"] !== "raised") throw conflict("dispute_already_ruled");
  const now = clock.now();
  const update = await store.query(
    `UPDATE disputes SET status = $1, ruled_at = $2, note = 'queued'
      WHERE id = $3 AND status = 'raised'
      RETURNING id, answer_id, team_id, round, question, answer_text, reason, status, raised_at, ruled_at, note`,
    [ruling, now.toISOString(), disputeId],
  );
  if (update.rowCount === 0) throw conflict("dispute_already_ruled");
  if (ruling === "upheld") {
    await store.query(
      `UPDATE answers SET ruled = 1 WHERE id = (SELECT answer_id FROM disputes WHERE id = $1)`,
      [disputeId],
    );
  }
  return disputeToApi(update.rows[0] as unknown as Parameters<typeof disputeToApi>[0]);
}

export async function publishRound(store: DbStore, round: number, clock: Clock): Promise<{ table: Table }> {
  const { row } = await loadRound(store, round);
  if (row === null) throw new HttpError(404, "not_found");
  if (row.status !== "marked") throw conflict("round_not_marked");
  const pending = await store.query(
    `SELECT COUNT(*)::int AS count FROM disputes WHERE round = $1 AND status = 'raised'`,
    [round],
  );
  const pendingCount = (pending.rows[0] as unknown as { count: number })["count"];
  if (pendingCount > 0) throw conflict("disputes_pending", { count: pendingCount });

  const client = await store.connect();
  let published = false;
  try {
    await client.query("BEGIN");
    const statusUpdate = await client.query(
      `UPDATE rounds SET status = 'published' WHERE number = $1 AND status = 'marked'`,
      [round],
    );
    if (statusUpdate.rowCount > 0) {
      const teams = await client.query(`SELECT id FROM teams`);
      for (const team of teams.rows) {
        const teamId = Number((team as unknown as { id: number })["id"]);
        await client.query(
          `INSERT INTO published_scores (team_id, round, score)
           SELECT $1, $2, COALESCE(SUM(a.ruled), 0)
             FROM answers a
            WHERE a.round = $2 AND a.team_id = $1 AND a.current = true
           ON CONFLICT (team_id, round) DO NOTHING`,
          [teamId, round],
        );
      }
      await client.query(`UPDATE league_meta SET value = $1 WHERE key = 'last_published_round'`, [round.toString()]);
      await client.query(`UPDATE league_meta SET value = (value::int + 1)::text WHERE key = 'table_version'`);
      published = true;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!published) throw conflict("round_not_marked");
  void clock;
  const table = await loadTable(store);
  return { table };
}

export interface SearchOutcome {
  readonly answers: readonly Answer[];
  readonly count: number;
  readonly truncated: boolean;
}

export async function searchAnswers(
  store: DbStore,
  query: string,
  round: number | undefined,
): Promise<SearchOutcome> {
  const folded = foldText(query);
  const result = await store.query(
    `SELECT a.id, a.round, a.team_id, t.name AS team_name, a.question, a.text,
            a.submitted_at, a.current, a.mark, a.ruled
       FROM answers a JOIN teams t ON t.id = a.team_id
      ${round === undefined ? "" : "WHERE a.round = $1"}
      ORDER BY a.id ASC`,
    round === undefined ? [] : [round],
  );
  const matched: Answer[] = [];
  let truncated = false;
  for (const row of result.rows) {
    const answer = answerToApi(row as unknown as Parameters<typeof answerToApi>[0]);
    if (!foldText(answer.text).includes(folded)) continue;
    if (matched.length >= 100) {
      truncated = true;
      break;
    }
    matched.push(answer);
  }
  return { answers: matched, count: matched.length, truncated };
}

export function validateSubmitItems(raw: unknown): { items: readonly SubmitItem[]; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (!Array.isArray(raw)) {
    fields["answers"] = "invalid";
    return { items: [], fields };
  }
  const items: SubmitItem[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fields["answers"] = "invalid";
      continue;
    }
    const record = entry as Record<string, unknown>;
    const question = record["question"];
    const text = record["text"];
    if (typeof question !== "number" || !Number.isInteger(question) || !isQuestionNumber(question)) {
      fields["answers"] = "invalid";
      continue;
    }
    if (typeof text !== "string") {
      fields[`question_${question}`] = "invalid";
      continue;
    }
    if (seen.has(question)) {
      fields["answers"] = "invalid";
      continue;
    }
    seen.add(question);
    const problem = fieldProblem(text, limitFor("answerText"));
    if (problem !== undefined) {
      fields[`question_${question}`] = problem;
      continue;
    }
    items.push({ question, text: normalise(text) });
  }
  if (raw.length === 0) fields["answers"] = "required";
  if (raw.length > QUESTIONS_PER_ROUND && fields["answers"] === undefined) fields["answers"] = "invalid";
  return { items, fields };
}

export function validateIdempotencyKey(key: string | undefined): { key: string | undefined; problem?: "invalid" } {
  if (key === undefined) return { key: undefined };
  if (key === "") return { key: undefined, problem: "invalid" };
  if (key.length > ID_KEY_MAX) return { key: undefined, problem: "invalid" };
  for (const char of key) {
    if (char.charCodeAt(0) < 0x21 || char.charCodeAt(0) > 0x7e) return { key: undefined, problem: "invalid" };
  }
  return { key };
}

export function validateDisputeReason(text: string): { reason?: string; problem?: "required" | "too_long" } {
  const problem = fieldProblem(text, limitFor("reason"));
  if (problem === "required" || problem === "too_long") return { problem };
  if (problem !== undefined) return { problem: "too_long" };
  return { reason: normalise(text) };
}

export function jsonDepthGuard(value: unknown, maxDepth: number): boolean {
  return jsonDepth(value) <= maxDepth;
}

function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(jsonDepth));
  if (typeof value === "object" && value !== null) {
    const children = Object.values(value as Record<string, unknown>).map(jsonDepth);
    return 1 + Math.max(0, ...children);
  }
  return 1;
}