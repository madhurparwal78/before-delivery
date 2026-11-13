import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { replayLog, rulesFor } from "../shared/engine";
import type { RunScore } from "../shared/engine";
import { fromHundredths, numberHundredths, ratioHundredths } from "../shared/numbers";
import type { HistoryRow, Mode, RefusalCode, StoredRun } from "../shared/protocol";
import type { QuoteId } from "../shared/texts";
import { HISTORY_PAGE_SIZE, config } from "./config";
import { pool, transaction } from "./db";
import type { Viewer } from "./auth";
import { bestRunId, lengthOf } from "./boards";
import { fail, isRecord, json } from "./http";
import type { Reply } from "./http";
import { judgeRun } from "./runCheck";
import type { RunKind } from "./runCheck";
import { publishCountedRun } from "./live";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TicketRow {
  typist_id: string | null;
  mode: Mode;
  length: string | null;
  punctuation: boolean;
  numbers: boolean;
  words: string[];
  quote_id: QuoteId | null;
  expired: boolean;
}

function runKindOf(mode: Mode, length: string | null): RunKind {
  return mode === "time" ? { kind: "timed", lengthMs: Number(length) * 1000 } : { kind: "untimed" };
}

function hundredthsOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? fromHundredths(numberHundredths(value)) : null;
}

/** The figures a refused run keeps: what was submitted, rounded, with null for anything missing or not a number. */
function submittedFigures(body: unknown): { duration: number | null; speed: number | null; raw: number | null; accuracy: number | null; consistency: number | null; characters: Record<string, number | null> | null } {
  const input = isRecord(body) ? body : {};
  const characters = isRecord(input.characters) ? input.characters : null;
  return {
    duration: hundredthsOrNull(input.duration),
    speed: hundredthsOrNull(input.speed),
    raw: hundredthsOrNull(input.raw),
    accuracy: hundredthsOrNull(input.accuracy),
    consistency: hundredthsOrNull(input.consistency),
    characters: characters && Object.fromEntries(["correct", "incorrect", "extra", "missed"].map((key) => [key, hundredthsOrNull(characters[key])])),
  };
}

function proofKeyOf(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

interface NewRun {
  readonly id: string;
  readonly typistId: string;
  readonly ticketId: string;
  readonly ticket: TicketRow;
  readonly raw: Buffer;
  readonly body: unknown;
}

/** Stores a counted run with the replay's figures and answers 201. */
async function fileCounted(client: PoolClient, run: NewRun, score: RunScore, log: unknown): Promise<Reply> {
  const proofKey = proofKeyOf(run.raw);
  const t = run.ticket;
  const figures = {
    speed: fromHundredths(ratioHundredths(score.speed)),
    raw: fromHundredths(ratioHundredths(score.raw)),
    accuracy: fromHundredths(ratioHundredths(score.accuracy)),
    consistency: fromHundredths(numberHundredths(score.consistency)),
  };
  await client.query(
    `INSERT INTO runs (id, typist_id, ticket_id, mode, length, punctuation, numbers, quote_id, words, log, duration, speed, raw, accuracy, consistency, characters, verdict, proof_key, request_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'counted', $17, $18)`,
    [run.id, run.typistId, run.ticketId, t.mode, t.length, t.punctuation, t.numbers, t.quote_id, JSON.stringify(t.words), JSON.stringify(log), score.duration, figures.speed, figures.raw, figures.accuracy, figures.consistency, JSON.stringify(score.characters), proofKey, run.raw],
  );
  const best = await bestRunId(client, run.typistId, { mode: t.mode, length: t.length, punctuation: t.punctuation, numbers: t.numbers });
  const reply = json(201, { runId: run.id, verdict: "counted", personalBest: best === run.id, ...figures, proofKey });
  await client.query("UPDATE runs SET response_status = $2, response_body = $3 WHERE id = $1", [run.id, reply.status, reply.body]);
  return reply;
}

/** Stores a refused run as not counted with the figures it submitted, and answers its single status and code. */
async function fileRefused(client: PoolClient, run: NewRun, code: RefusalCode): Promise<Reply> {
  const proofKey = proofKeyOf(run.raw);
  const t = run.ticket;
  const figures = submittedFigures(run.body);
  const log = isRecord(run.body) && run.body.log !== undefined ? run.body.log : null;
  const reply = fail(422, code, { verdict: "not_counted", runId: run.id, proofKey });
  await client.query(
    `INSERT INTO runs (id, typist_id, ticket_id, mode, length, punctuation, numbers, quote_id, words, log, duration, speed, raw, accuracy, consistency, characters, verdict, reason, proof_key, request_body, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'not_counted', $17, $18, $19, $20, $21)`,
    [run.id, run.typistId, run.ticketId, t.mode, t.length, t.punctuation, t.numbers, t.quote_id, JSON.stringify(t.words), JSON.stringify(log), figures.duration, figures.speed, figures.raw, figures.accuracy, figures.consistency, figures.characters && JSON.stringify(figures.characters), code, proofKey, run.raw, reply.status, reply.body],
  );
  return reply;
}

/**
 * Files the first submission of a ticket. The ticket row is locked for the whole decision, so of any number of parallel
 * submissions exactly one is recorded and every other receives that stored response.
 */
export async function submitRun(viewer: Viewer, raw: Buffer, body: unknown): Promise<Reply> {
  const ticketId = isRecord(body) && typeof body.ticketId === "string" && UUID.test(body.ticketId) ? body.ticketId : null;
  if (ticketId === null) return fail(404, "ticket_not_found");
  const outcome = await transaction(async (client) => {
    const found = await client.query<TicketRow>(
      "SELECT typist_id, mode, length, punctuation, numbers, words, quote_id, now() > expires_at AS expired FROM tickets WHERE id = $1 FOR UPDATE",
      [ticketId],
    );
    const ticket = found.rows[0];
    if (!ticket || ticket.typist_id !== viewer.typistId) return { reply: fail(404, "ticket_not_found"), counted: null };
    const stored = await client.query<{ response_status: number; response_body: string }>("SELECT response_status, response_body FROM runs WHERE ticket_id = $1", [ticketId]);
    if (stored.rows[0]) return { reply: { status: stored.rows[0].response_status, body: stored.rows[0].response_body }, counted: null };
    if (ticket.expired) return { reply: fail(410, "ticket_expired"), counted: null };
    await client.query("SELECT 1 FROM typists WHERE id = $1 FOR UPDATE", [viewer.typistId]);
    const run: NewRun = { id: randomUUID(), typistId: viewer.typistId, ticketId, ticket, raw, body };
    const judged = judgeRun(body, ticket.words, runKindOf(ticket.mode, ticket.length));
    if (!judged.counted) return { reply: await fileRefused(client, run, judged.code), counted: null };
    const reply = await fileCounted(client, run, judged.score, judged.log);
    return { reply, counted: { runId: run.id, ticket } };
  });
  if (outcome.counted) void publishCountedRun(outcome.counted.runId).catch(() => undefined);
  return outcome.reply;
}

interface RunRow {
  id: string;
  mode: Mode;
  length: string | null;
  punctuation: boolean;
  numbers: boolean;
  quote_id: QuoteId | null;
  words: string[];
  log: unknown;
  duration: number | null;
  speed: number | null;
  raw: number | null;
  accuracy: number | null;
  consistency: number | null;
  characters: StoredRun["characters"];
  verdict: "counted" | "not_counted";
  reason: RefusalCode | null;
  finished_at: Date;
  proof_key: string | null;
}

export async function readRun(viewer: Viewer, id: string): Promise<Reply> {
  const { rows } = UUID.test(id)
    ? await pool.query<RunRow>("SELECT * FROM runs WHERE id = $1 AND typist_id = $2", [id, viewer.typistId])
    : { rows: [] };
  const row = rows[0];
  if (!row) return fail(404, "not_found");
  const replayed = row.verdict === "counted" && row.proof_key !== null ? replayLog(row.words, row.log as { k: string; t: number }[], rulesFor(row.mode, row.length, config.maxExtraLetters)).score : null;
  const run: StoredRun = {
    runId: row.id,
    mode: row.mode,
    length: lengthOf(row.length),
    punctuation: row.punctuation,
    numbers: row.numbers,
    quoteId: row.quote_id,
    words: row.words,
    log: row.log,
    duration: row.duration,
    speed: row.speed,
    raw: row.raw,
    accuracy: row.accuracy,
    consistency: row.consistency,
    characters: row.characters,
    errorsByKey: replayed && Object.fromEntries(replayed.errorsByKey),
    perSecond: replayed && replayed.perSecond.map((second) => ({ second: second.second, speed: fromHundredths(ratioHundredths(second.speed)), raw: fromHundredths(ratioHundredths(second.raw)), errors: second.errors })),
    verdict: row.verdict,
    reason: row.reason,
    finishedAt: row.finished_at.toISOString(),
    proofKey: row.proof_key,
  };
  return json(200, run);
}

interface HistoryFilter {
  readonly mode: string | null;
  readonly length: string | null;
  readonly verdict: string | null;
  readonly page: number;
}

export async function readHistory(viewer: Viewer, filter: HistoryFilter): Promise<Reply> {
  const { rows } = await pool.query<{ id: string; finished_at: Date; mode: Mode; length: string | null; speed: number | null; raw: number | null; accuracy: number | null; consistency: number | null; verdict: "counted" | "not_counted" }>(
    `SELECT id, finished_at, mode, length, speed, raw, accuracy, consistency, verdict FROM runs
     WHERE typist_id = $1 AND ($2::text IS NULL OR mode = $2) AND ($3::text IS NULL OR length = $3) AND ($4::text IS NULL OR verdict = $4)
     ORDER BY finished_at DESC, id LIMIT $5 OFFSET $6`,
    [viewer.typistId, filter.mode, filter.length, filter.verdict, HISTORY_PAGE_SIZE + 1, (filter.page - 1) * HISTORY_PAGE_SIZE],
  );
  const runs: HistoryRow[] = rows.slice(0, HISTORY_PAGE_SIZE).map((row) => ({
    runId: row.id,
    finishedAt: row.finished_at.toISOString(),
    mode: row.mode,
    length: lengthOf(row.length),
    speed: row.speed,
    raw: row.raw,
    accuracy: row.accuracy,
    consistency: row.consistency,
    verdict: row.verdict,
  }));
  return json(200, { runs, more: rows.length > HISTORY_PAGE_SIZE });
}

