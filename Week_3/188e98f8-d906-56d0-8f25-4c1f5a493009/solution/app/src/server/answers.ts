import type { Answer } from "../shared/api-types";
import { searchForm } from "../shared/text";
import type { Ctx, Reply } from "./context";
import { json, requireRole, roundNumber } from "./context";
import { LOCK, pool, tx } from "./db";
import { Fields, conflict, notFound, tooManySubmits, unavailable } from "./errors";
import { ANSWER_COLUMNS, ANSWER_FROM, loadAnswer } from "./query";
import type { Json, JsonObject } from "./validate";
import { asObject, checkText, depth, positiveInteger, sameJson } from "./validate";

const SUBMITS_PER_WINDOW = 6;
const WINDOW_SECONDS = 60;
const QUESTIONS = 8;
const KEY_PATTERN = /^[\x21-\x7e]{1,64}$/;
const ARCHIVE_DEFAULT = 25;
const ARCHIVE_CAP = 100;
const SEARCH_CAP = 100;
const SEARCH_DEPTH_MAX = 4;
const SEARCH_BUDGET_MS = 1200;

function theRound(ctx: Ctx): number {
  const number = roundNumber(ctx.params[0]);
  if (number === null) throw notFound();
  return number;
}

/** Captains see no marks until the round is marked. */
function forViewer(answers: Answer[], viewer: "staff" | "captain", marked: boolean): Answer[] {
  if (viewer === "staff" || marked) return answers;
  return answers.map((answer) => ({ ...answer, mark: null, ruled: null }));
}

/** The submit allowance: 6 submits in any rolling 60 seconds, counted per team. */
async function consumeSubmitAllowance(teamId: number): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [LOCK.submitLog, teamId]);
    await client.query("DELETE FROM submit_log WHERE team_id = $1 AND at <= clock_timestamp() - make_interval(secs => $2)", [
      teamId,
      WINDOW_SECONDS,
    ]);
    const counted = await client.query<{ age: number }>(
      "SELECT extract(epoch FROM (clock_timestamp() - at))::float8 AS age FROM submit_log WHERE team_id = $1 ORDER BY at",
      [teamId],
    );
    const oldest = counted.rows[0];
    if (counted.rows.length >= SUBMITS_PER_WINDOW && oldest !== undefined) {
      throw tooManySubmits(Math.max(1, Math.ceil(WINDOW_SECONDS - oldest.age)));
    }
    await client.query("INSERT INTO submit_log (team_id, at) VALUES ($1, clock_timestamp())", [teamId]);
  });
}

interface Item {
  question: number;
  text: string;
}

function checkSubmit(body: JsonObject, key: string | undefined): Item[] {
  const fields = new Fields();
  if (key !== undefined && !KEY_PATTERN.test(key)) fields.set("idempotency_key", "invalid");
  const list = body["answers"];
  const items: Item[] = [];
  if (list === undefined || list === null) fields.set("answers", "required");
  else if (!Array.isArray(list)) fields.set("answers", "invalid");
  else if (list.length === 0) fields.set("answers", "required");
  else if (list.length > QUESTIONS) fields.set("answers", "invalid");
  else {
    const seen = new Set<number>();
    for (const entry of list) {
      const item = asObject(entry);
      const question = positiveInteger(item["question"]);
      if (question === null || question > QUESTIONS || seen.has(question)) {
        fields.set("answers", "invalid");
        continue;
      }
      seen.add(question);
      const text = checkText(item["text"], "answer");
      if (text.ok) items.push({ question, text: text.text });
      else fields.set(`question_${question}`, text.error);
    }
  }
  fields.assertEmpty();
  return items;
}

export async function submitAnswers(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  const session = requireRole(ctx, "captain");
  const teamId = session.teamId as number;
  await consumeSubmitAllowance(teamId);
  const body = asObject(ctx.body);
  const keyHeader = ctx.req.headers["idempotency-key"];
  const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK.answers]);
    if (key !== undefined && KEY_PATTERN.test(key)) {
      const stored = await client.query<{ round: number; body: Json; response: unknown }>(
        "SELECT round, body, response FROM idempotency WHERE team_id = $1 AND key = $2",
        [teamId, key],
      );
      const earlier = stored.rows[0];
      if (earlier !== undefined) {
        if (earlier.round !== number || !sameJson(earlier.body, body)) throw conflict("idempotency_conflict");
        return json(201, earlier.response, { "Idempotent-Replayed": "true" });
      }
    }
    await client.query("UPDATE rounds SET status = 'closed', closed_at = closes_at WHERE number = $1 AND status = 'open' AND closes_at <= clock_timestamp()", [number]);
    const state = await client.query<{ status: string }>("SELECT status FROM rounds WHERE number = $1 FOR SHARE", [number]);
    const status = state.rows[0]?.status;
    if (status === "drafted") throw conflict("round_not_open");
    if (status !== "open") throw conflict("round_closed");
    const items = checkSubmit(body, key);
    const accepted: Answer[] = [];
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const submittedAt = (clock.rows[0] as { now: Date }).now;
    for (const item of items) {
      await client.query("UPDATE answers SET current = false WHERE round = $1 AND team_id = $2 AND question = $3 AND current", [
        number,
        teamId,
        item.question,
      ]);
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO answers (round, team_id, question, text, search_text, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [number, teamId, item.question, item.text, searchForm(item.text), submittedAt],
      );
      accepted.push((await loadAnswer(client, (inserted.rows[0] as { id: number }).id)) as Answer);
    }
    const response = { round: number, accepted };
    if (key !== undefined) {
      await client.query("INSERT INTO idempotency (team_id, key, round, body, response) VALUES ($1, $2, $3, $4, $5)", [
        teamId,
        key,
        number,
        JSON.stringify(body),
        JSON.stringify(response),
      ]);
    }
    return json(201, response);
  });
}

export async function listRoundAnswers(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  const session = requireRole(ctx, "quizmaster", "marker", "captain");
  const result = await pool.query<Answer & { round_status: string }>(
    `SELECT ${ANSWER_COLUMNS}, r.status AS round_status
     FROM ${ANSWER_FROM} JOIN rounds r ON r.number = ra.round
     WHERE ra.round = $1 AND ra.current AND ($2::int IS NULL OR ra.team_id = $2)
     ORDER BY ra.question, ra.team_id`,
    [number, session.role === "captain" ? session.teamId : null],
  );
  const marked = result.rows[0]?.round_status === "marked" || result.rows[0]?.round_status === "published";
  const answers = result.rows.map(({ round_status: _status, ...answer }) => answer);
  return json(200, { round: number, answers: forViewer(answers, session.role === "captain" ? "captain" : "staff", marked) });
}

function pointsOf(body: JsonObject): 0 | 1 | null {
  const points = body["points"];
  return points === 0 || points === 1 ? points : null;
}

export async function putMark(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  const body = asObject(ctx.body);
  const answerId = positiveInteger(body["answer_id"]);
  const target = answerId === null ? null : await loadAnswer(pool, answerId);
  if (answerId !== null && (target === null || target.round !== number)) throw notFound();
  requireRole(ctx, "marker");
  const points = pointsOf(body);
  const fields = new Fields();
  if (answerId === null) fields.set("answer_id", body["answer_id"] === undefined || body["answer_id"] === null ? "required" : "invalid");
  if (points === null) fields.set("points", body["points"] === undefined || body["points"] === null ? "required" : "invalid");
  return tx(async (client) => {
    const round = await client.query<{ status: string }>("SELECT status FROM rounds WHERE number = $1 FOR SHARE", [number]);
    if (round.rows[0]?.status !== "closed") throw conflict("round_not_closed");
    if (target !== null && !target.current) throw conflict("answer_superseded");
    fields.assertEmpty();
    await client.query("UPDATE answers SET mark = $2 WHERE id = $1", [answerId, points]);
    return json(200, { answer: await loadAnswer(client, answerId as number) });
  });
}

function archiveParams(query: URLSearchParams): { limit: number; after: number; round: number | null } {
  const fields = new Fields();
  let limit = ARCHIVE_DEFAULT;
  const rawLimit = query.get("limit");
  if (rawLimit !== null) {
    if (/^-?\d+$/.test(rawLimit) && Number(rawLimit) >= 1) limit = Math.min(Number(rawLimit), ARCHIVE_CAP);
    else fields.set("limit", "invalid");
  }
  let after = 0;
  const rawCursor = query.get("cursor");
  if (rawCursor !== null) {
    const decoded = /^[A-Za-z0-9_-]+$/.test(rawCursor) ? Buffer.from(rawCursor, "base64url").toString("utf8") : "";
    if (/^\d{1,15}$/.test(decoded)) after = Number(decoded);
    else fields.set("cursor", "invalid");
  }
  let round: number | null = null;
  const rawRound = query.get("round");
  if (rawRound !== null) {
    round = roundNumber(rawRound);
    if (round === null) fields.set("round", "invalid");
  }
  fields.assertEmpty();
  return { limit, after, round };
}

export async function listArchive(ctx: Ctx): Promise<Reply> {
  requireRole(ctx, "quizmaster", "marker");
  const { limit, after, round } = archiveParams(ctx.query);
  const result = await pool.query<Answer>(
    `SELECT ${ANSWER_COLUMNS} FROM ${ANSWER_FROM}
     WHERE ra.id > $1 AND ($2::int IS NULL OR ra.round = $2) ORDER BY ra.id LIMIT $3`,
    [after, round, limit + 1],
  );
  const page = result.rows.slice(0, limit);
  const last = page[page.length - 1];
  return json(200, {
    answers: page,
    limit,
    next_cursor: last === undefined ? null : Buffer.from(String(last.id)).toString("base64url"),
    has_more: result.rows.length > limit,
  });
}

export async function searchAnswers(ctx: Ctx): Promise<Reply> {
  requireRole(ctx, "quizmaster", "marker");
  const fields = new Fields();
  if (ctx.body !== undefined && depth(ctx.body) > SEARCH_DEPTH_MAX) {
    fields.set("body", "too_deep");
    fields.assertEmpty();
  }
  const body = asObject(ctx.body);
  const query = checkText(body["query"], "query");
  if (!query.ok) fields.set("query", query.error);
  const rawRound = body["round"];
  let round: number | null = null;
  if (rawRound !== undefined && rawRound !== null) {
    round = typeof rawRound === "number" && Number.isInteger(rawRound) ? roundNumber(String(rawRound)) : null;
    if (round === null) fields.set("round", "invalid");
  }
  fields.assertEmpty();
  const wanted = searchForm((query as { text: string }).text);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${SEARCH_BUDGET_MS}`);
    const found = await client.query<Answer>(
      `SELECT ${ANSWER_COLUMNS} FROM ${ANSWER_FROM}
       WHERE strpos(ra.search_text, $1) > 0 AND ($2::int IS NULL OR ra.round = $2) ORDER BY ra.id LIMIT $3`,
      [wanted, round, SEARCH_CAP + 1],
    );
    await client.query("COMMIT");
    const answers = found.rows.slice(0, SEARCH_CAP);
    return json(200, { answers, count: answers.length, truncated: found.rows.length > SEARCH_CAP });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Error && "code" in error && error.code === "57014") throw unavailable("search_timeout");
    throw error;
  } finally {
    client.release();
  }
}
