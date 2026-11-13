import express, { type NextFunction, type Request, type Response, type Express } from "express";
import type { CookieOptions, Request as ExRequest } from "express";
import type { DbStore } from "./db";
import type { SheetStorage } from "./storage";
import type { NoteDelivery } from "./mail";
import { HttpError, badJson, badCode, conflict, errorBody, forbidden, methodNotAllowed, notFound, providerUnavailable, signedOut, tooLarge, unsupportedType, unprocessable } from "./errors";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, deskPathFor, hashSessionToken, newSessionToken } from "./sessions";
import { NIGHT_NUMBER, TOTAL_ROUNDS } from "../domain/constants";
import {
  closeRound,
  finishMarking,
  markAnswer,
  openRound,
  publishRound,
  raiseDispute,
  ruleOnDispute,
  searchAnswers,
  serverClock,
  submitAnswers,
  validateDisputeReason,
  validateIdempotencyKey,
  validateSubmitItems,
  jsonDepthGuard,
} from "./actions";
import {
  answerToApi,
  disputeToApi,
  loadRound,
  loadRounds,
  loadTable,
  roundToApi,
  toIsoTime,
  type RoundLoad,
  type SheetLoad,
} from "./repo";
import { isRoundNumber } from "../domain/numbers";
import { decodeCursor, encodeCursor, resolveLimit, foldText } from "../domain/services";
import { fieldProblem, limitFor, normalise } from "../domain/text";
import { SEARCH_MAX_DEPTH, SEARCH_TIME_BUDGET_MS } from "../domain/constants";
import { checkSheetBytes, dimensionsInRange, SHEET_MAX_BYTES, type SheetContentType } from "../domain/sheets";
import { applySchemaAndSeed } from "./seed";
import { registerPages, servePage } from "./pages";

const JSON_BODY_LIMIT = 16_384;

export interface SessionContext {
  readonly role: "quizmaster" | "marker" | "captain";
  readonly teamId: number | null;
}

export interface ServerDeps {
  readonly store: DbStore;
  readonly storage: SheetStorage;
  readonly notes: NoteDelivery;
  readonly roundSeconds: number;
  readonly isReady: () => boolean;
}

export interface RequestWithSession extends Request {
  session?: SessionContext;
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const headerValue = Array.isArray(header) ? header.join("; ") : header;
  const out: Record<string, string> = {};
  if (headerValue === undefined) return out;
  for (const part of headerValue.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key !== "") out[key] = decodeURIComponent(value);
  }
  return out;
}

export async function loadSession(deps: ServerDeps, request: RequestWithSession): Promise<SessionContext | undefined> {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token === undefined || token === "") return undefined;
  const result = await deps.store.query(
    `SELECT role, team_id FROM sessions WHERE token_hash = $1`,
    [hashSessionToken(token)],
  );
  if (result.rowCount === 0) return undefined;
  const row = result.rows[0] as unknown as { role: string; team_id: number | null };
  return { role: row["role"] as SessionContext["role"], teamId: row["team_id"] === null ? null : Number(row["team_id"]) };
}

function setSessionCookie(response: Response, token: string): void {
  const options: CookieOptions = { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS * 1000 };
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`);
  void options;
}

async function requireSession(deps: ServerDeps, request: RequestWithSession): Promise<SessionContext> {
  const session = await loadSession(deps, request);
  if (session === undefined) throw signedOut();
  request.session = session;
  return session;
}

async function requireRole(deps: ServerDeps, request: RequestWithSession, roles: readonly SessionContext["role"][]): Promise<SessionContext> {
  const session = await requireSession(deps, request);
  if (!roles.includes(session.role)) throw forbidden();
  return session;
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof HttpError) {
    const body = errorBody(error);
    if (error.code === "method_not_allowed") {
      const allow = (error as unknown as { allow?: string[] }).allow ?? [];
      response.setHeader("Allow", allow.join(", "));
    }
    if (error.status === 429 && typeof body["retry_after"] === "number") {
      response.setHeader("Retry-After", String(body["retry_after"]));
    }
    response.status(error.status).json(body);
    return;
  }
  response.status(500).json({ error: "internal_error" });
}

function notFoundError(): HttpError {
  return notFound();
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  const mime = contentType.split(";")[0]?.trim() ?? "";
  if (mime !== "application/json") throw unsupportedType();
  const raw = await readRawBody(request);
  if (raw.length > JSON_BODY_LIMIT) throw tooLarge();
  if (raw.length === 0) throw badJson();
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw badJson();
  }
}

function readRawBody(request: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > JSON_BODY_LIMIT + 1) {
        reject(tooLarge());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", (error: Error) => reject(error));
  });
}

function roundParam(request: Request): number {
  const raw = request.params["n"];
  const rawValue = Array.isArray(raw) ? raw.join("") : raw;
  const value = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(value) || !isRoundNumber(value)) throw notFoundError();
  return value;
}

type Queryish = unknown;

function queryValue(value: Queryish): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function wrap(handler: (request: RequestWithSession, response: Response) => Promise<void>): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    handler(request as RequestWithSession, response).catch(next);
  };
}

function requireContentJson(request: Request): void {
  const contentType = request.headers["content-type"] ?? "";
  const mime = contentType.split(";")[0]?.trim() ?? "";
  if (mime !== "application/json") throw unsupportedType();
}

export function createServer(deps: ServerDeps): Express {
  const app = express();
  const clock = serverClock();

  app.disable("x-powered-by");
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store");
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== new URL(request.url, `http://${request.headers.host}`).origin) {
      response.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });

  app.all("/api", methodGuard(["GET"]));
  app.get("/api/health", (request: Request, response: Response) => {
    if (deps.isReady()) {
      response.status(200).json({ status: "ok" });
    } else {
      response.status(503).json({ status: "starting" });
    }
  });
  app.all("/api/health", methodGuard(["GET", "HEAD"]));

  app.post("/api/session", wrap(async (request, response) => {
    requireContentJson(request);
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw unprocessable({ code: "invalid" });
    const record = body as Record<string, unknown>;
    const code = record["code"];
    if (typeof code !== "string") throw unprocessable({ code: "required" });
    const problem = code.trim().length === 0 ? "required" : undefined;
    if (problem !== undefined) throw unprocessable({ code: problem });
    const lookup = await deps.store.query(`SELECT code, role, team_id FROM desk_codes WHERE code = $1`, [code.trim()]);
    if (lookup.rowCount === 0) throw badCode();
    const row = lookup.rows[0] as unknown as { code: string; role: string; team_id: number | null };
    const token = newSessionToken();
    await deps.store.query(
      `INSERT INTO sessions (token_hash, role, team_id, created_at) VALUES ($1, $2, $3, $4)`,
      [hashSessionToken(token), row["role"], row["team_id"], new Date().toISOString()],
    );
    setSessionCookie(response, token);
    let teamName: string | null = null;
    if (row["team_id"] !== null) {
      const team = await deps.store.query(`SELECT name FROM teams WHERE id = $1`, [row["team_id"]]);
      teamName = team.rowCount === 0 ? null : String((team.rows[0] as unknown as { name: string })["name"]);
    }
    response.status(201).json({
      role: row["role"],
      team_id: row["team_id"] === null ? null : Number(row["team_id"]),
      team_name: teamName,
    });
  }));
  app.all("/api/session", methodGuard(["POST", "GET", "DELETE", "HEAD"]));

  app.get("/api/session", wrap(async (request, response) => {
    const session = await requireSession(deps, request);
    let teamName: string | null = null;
    if (session.teamId !== null) {
      const team = await deps.store.query(`SELECT name FROM teams WHERE id = $1`, [session.teamId]);
      teamName = team.rowCount === 0 ? null : String((team.rows[0] as unknown as { name: string })["name"]);
    }
    response.status(200).json({ role: session.role, team_id: session.teamId, team_name: teamName });
  }));
  app.delete("/api/session", wrap(async (request, response) => {
    await requireSession(deps, request);
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token !== undefined) {
      await deps.store.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashSessionToken(token)]);
    }
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    response.status(204).end();
  }));

  app.get("/api/rounds", wrap(async (_request, response) => {
    await ensureSweep(deps, clock);
    const { rows, sheets } = await loadRounds(deps.store);
    const now = clock.now();
    response.status(200).json({
      night: NIGHT_NUMBER,
      server_time: toIsoTime(now),
      rounds: rows.map((row) => roundToApi(row, sheets.get(row.number) ?? null, now)),
    });
  }));
  app.all("/api/rounds", methodGuard(["GET", "HEAD"]));

  app.get("/api/rounds/:n", wrap(async (request, response) => {
    const round = roundParam(request);
    await ensureSweep(deps, clock);
    const { row, sheet } = await loadRound(deps.store, round);
    if (row === null) throw notFoundError();
    response.status(200).json({ round: roundToApi(row, sheet, clock.now()) });
  }));

  app.get("/api/table", wrap(async (_request, response) => {
    const table = await loadTable(deps.store);
    response.status(200).json(table);
  }));
  app.all("/api/table", methodGuard(["GET", "HEAD"]));

  app.put("/api/rounds/:n/sheet", wrap(async (request, response) => {
    const session = await requireRole(deps, request, ["quizmaster"]);
    void session;
    const round = roundParam(request);
    const contentType = (request.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
    if (contentType !== "image/png" && contentType !== "image/jpeg") throw unsupportedType();
    const raw = await readRawBody(request);
    if (raw.length > SHEET_MAX_BYTES) throw tooLarge();
    const { row } = await loadRound(deps.store, round);
    if (row === null) throw notFoundError();
    if (row.kind !== "picture") throw conflict("not_picture_round");
    if (row.status !== "drafted") throw conflict("round_not_drafted");
    if (raw.length === 0) throw unprocessable({ body: "required" });
    const check = checkSheetBytes(contentType as SheetContentType, raw);
    if (!check.ok) throw unsupportedType();
    if (check.width === null || check.height === null || !dimensionsInRange(check.width, check.height)) {
      throw unprocessable({ body: "invalid" });
    }
    const stored = await deps.storage
      .putSheet(round, raw, contentType as SheetContentType, check.width, check.height)
      .catch(() => {
        throw providerUnavailable("storage_unavailable");
      });
    await deps.store.query(
      `INSERT INTO sheets (round, key, sha256, size, width, height, content_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (round) DO UPDATE SET key = $2, sha256 = $3, size = $4, width = $5, height = $6, content_type = $7`,
      [round, stored.key, stored.sha256, stored.size, stored.width, stored.height, stored.contentType],
    );
    const after = await loadRound(deps.store, round);
    response.status(201).json({ round: roundToApi(after.row!, after.sheet, clock.now()) });
  }));

  app.get("/api/rounds/:n/sheet", wrap(async (request, response) => {
    const session = await requireRole(deps, request, ["quizmaster", "marker", "captain"]);
    const round = roundParam(request);
    const { row, sheet } = await loadRound(deps.store, round);
    if (row === null) throw notFoundError();
    if (session.role !== "quizmaster" && row.status === "drafted") throw conflict("round_not_open");
    if (sheet === null) throw notFoundError();
    const object = await deps.storage.getSheet(sheet.key).catch(() => {
      throw providerUnavailable("storage_unavailable");
    });
    response.status(200);
    response.setHeader("Content-Type", object.contentType ?? sheet.content_type);
    response.setHeader("Cache-Control", "no-store");
    response.end(Buffer.from(object.bytes));
  }));

  app.post("/api/rounds/:n/open", wrap(async (request, response) => {
    await requireRole(deps, request, ["quizmaster"]);
    const round = roundParam(request);
    const outcome = await openRound(deps.store, deps.storage, round, deps.roundSeconds, clock).catch((error: unknown) => {
      if (error instanceof HttpError && error.status === 409 && error.code !== "round_not_drafted" && error.code !== "another_round_open" && error.code !== "sheet_not_stored") {
        throw providerUnavailable("storage_unavailable");
      }
      throw error;
    });
    response.status(200).json({ round: roundToApi(outcome.round, outcome.sheet, clock.now()) });
  }));

  app.post("/api/rounds/:n/close", wrap(async (request, response) => {
    await requireRole(deps, request, ["quizmaster"]);
    const round = roundParam(request);
    const outcome = await closeRound(deps.store, round, clock);
    response.status(200).json({ round: roundToApi(outcome.round, outcome.sheet, clock.now()) });
  }));

  app.post("/api/rounds/:n/publish", wrap(async (request, response) => {
    await requireRole(deps, request, ["quizmaster"]);
    const round = roundParam(request);
    const { table } = await publishRound(deps.store, round, clock);
    const after = await loadRound(deps.store, round);
    response.status(200).json({ round: roundToApi(after.row!, after.sheet, clock.now()), table });
  }));

  app.post("/api/disputes/:id/ruling", wrap(async (request, response) => {
    await requireRole(deps, request, ["quizmaster"]);
    const id = idParam(request);
    requireContentJson(request);
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw unprocessable({ ruling: "invalid" });
    const ruling = (body as Record<string, unknown>)["ruling"];
    if (ruling !== "upheld" && ruling !== "dismissed") throw unprocessable({ ruling: "invalid" });
    const dispute = await ruleOnDispute(deps.store, id, ruling, clock);
    void deps.notes.drain();
    response.status(200).json({ dispute });
  }));

  app.post("/api/rounds/:n/answers", wrap(async (request, response) => {
    const session = await requireRole(deps, request, ["captain"]);
    requireContentJson(request);
    const raw = await readRawBody(request);
    if (raw.length > JSON_BODY_LIMIT) throw tooLarge();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8")) as unknown;
    } catch {
      throw badJson();
    }
    const round = roundParam(request);
    const idempotencyRaw = request.headers["idempotency-key"];
    const idempotencyHeader = Array.isArray(idempotencyRaw) ? idempotencyRaw[0] : idempotencyRaw;
    const keyOutcome = validateIdempotencyKey(idempotencyHeader);
    if (keyOutcome.problem !== undefined) throw unprocessable({ idempotency_key: keyOutcome.problem });
    const bodyRecord = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    const answersRaw = bodyRecord === undefined ? undefined : bodyRecord["answers"];
    if (idempotencyHeader !== undefined && keyOutcome.key !== undefined) {
      const stored = await deps.store.query(
        `SELECT round, body, status, response FROM idempotency_records WHERE team_id = $1 AND idem_key = $2`,
        [session.teamId, keyOutcome.key],
      );
      if (stored.rowCount > 0) {
        const record = stored.rows[0] as unknown as { round: number; body: string; response: string };
        let storedBody: unknown;
        try {
          storedBody = JSON.parse(record.body);
        } catch {
          storedBody = undefined;
        }
        let incomingBody: unknown;
        try {
          incomingBody = JSON.parse(raw.toString("utf8"));
        } catch {
          incomingBody = undefined;
        }
        const sameRound = record.round === round;
        const sameBody = JSON.stringify(sortKeys(storedBody)) === JSON.stringify(sortKeys(incomingBody));
        if (sameRound && sameBody) {
          response.setHeader("Idempotent-Replayed", "true");
          response.status(201).json(JSON.parse(record.response));
          return;
        }
        throw conflict("idempotency_conflict");
      }
    }
    if (answersRaw === undefined || answersRaw === null) throw unprocessable({ answers: "required" });
    const { items, fields } = validateSubmitItems(answersRaw);
    if (Object.keys(fields).length > 0) throw unprocessable(fields);
    const outcome = await submitAnswers(deps.store, round, session.teamId!, items, keyOutcome.key, deps.roundSeconds, clock);
    response.status(201).json({ round: outcome.round, accepted: outcome.accepted });
  }));

  app.get("/api/rounds/:n/answers", wrap(async (request, response) => {
    const session = await requireRole(deps, request, ["quizmaster", "marker", "captain"]);
    const round = roundParam(request);
    await ensureSweep(deps, clock);
    const params: unknown[] = [round];
    let filter = `a.current = true`;
    if (session.role === "captain") {
      params.push(session.teamId);
      filter += ` AND a.team_id = $2`;
    }
    const result = await deps.store.query(
      `SELECT a.id, a.round, a.team_id, t.name AS team_name, a.question, a.text,
              a.submitted_at, a.current, a.mark, a.ruled
         FROM answers a JOIN teams t ON t.id = a.team_id
        WHERE a.round = $1 AND ${filter}
        ORDER BY a.question ASC, a.team_id ASC`,
      params,
    );
    const answers = result.rows.map((row) =>
      answerToApi(row as unknown as Parameters<typeof answerToApi>[0]),
    );
    const masked = session.role === "captain" ? answers.map((a) => ({ ...a, mark: null, ruled: null })) : answers;
    response.status(200).json({ round, answers: masked });
  }));

  app.put("/api/rounds/:n/marks", wrap(async (request, response) => {
    await requireRole(deps, request, ["marker"]);
    const round = roundParam(request);
    requireContentJson(request);
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw unprocessable({ points: "invalid" });
    const record = body as Record<string, unknown>;
    const answerId = record["answer_id"];
    const points = record["points"];
    const fields: Record<string, string> = {};
    if (typeof answerId !== "number" || !Number.isInteger(answerId) || answerId <= 0) fields["answer_id"] = "invalid";
    if (points !== 0 && points !== 1) fields["points"] = "invalid";
    if (Object.keys(fields).length > 0) throw unprocessable(fields);
    const answer = await markAnswer(deps.store, round, answerId as number, points as 0 | 1, clock);
    response.status(200).json({ answer });
  }));

  app.post("/api/rounds/:n/marked", wrap(async (request, response) => {
    await requireRole(deps, request, ["marker"]);
    const round = roundParam(request);
    const outcome = await finishMarking(deps.store, round, clock);
    response.status(200).json({ round: roundToApi(outcome.round, outcome.sheet, clock.now()) });
  }));

  app.get("/api/answers", wrap(async (request, response) => {
    await requireRole(deps, request, ["quizmaster", "marker"]);
    const limitRaw = request.query["limit"];
    const rawValue = queryValue(limitRaw);
    const limitOutcome = resolveLimit(rawValue);
    if ("bad" in limitOutcome) throw unprocessable({ limit: "invalid" });
    const cursorRaw = request.query["cursor"];
    const cursorValue = queryValue(cursorRaw);
    let afterId = 0;
    if (cursorValue !== undefined && cursorValue !== "") {
      const state = decodeCursor(cursorValue);
      if (state === undefined) throw unprocessable({ cursor: "invalid" });
      afterId = state.afterId;
    }
    const roundRaw = request.query["round"];
    const roundValue = queryValue(roundRaw);
    let roundFilter: number | undefined;
    if (roundValue !== undefined && roundValue !== "") {
      const parsed = Number.parseInt(roundValue, 10);
      if (!Number.isInteger(parsed) || !isRoundNumber(parsed)) throw unprocessable({ round: "invalid" });
      roundFilter = parsed;
    }
    const params: unknown[] = [afterId, limitOutcome.limit];
    let where = `a.id > $1`;
    if (roundFilter !== undefined) {
      params.push(roundFilter);
      where += ` AND a.round = $3`;
    }
    const result = await deps.store.query(
      `SELECT a.id, a.round, a.team_id, t.name AS team_name, a.question, a.text,
              a.submitted_at, a.current, a.mark, a.ruled
         FROM answers a JOIN teams t ON t.id = a.team_id
        WHERE ${where}
        ORDER BY a.id ASC
        LIMIT $2 + 1`,
      params,
    );
    const rows = result.rows;
    const hasMore = rows.length > limitOutcome.limit;
    const pageRows = hasMore ? rows.slice(0, limitOutcome.limit) : rows;
    const answers = pageRows.map((row) => answerToApi(row as unknown as Parameters<typeof answerToApi>[0]));
    const last = pageRows[pageRows.length - 1] as unknown as { id: number } | undefined;
    const nextCursor = hasMore && last !== undefined ? encodeCursor(Number(last.id)) : null;
    response.status(200).json({ answers, limit: limitOutcome.limit, next_cursor: nextCursor, has_more: hasMore });
  }));

  app.post("/api/answers/search", wrap(async (request, response) => {
    await requireRole(deps, request, ["quizmaster", "marker"]);
    requireContentJson(request);
    const raw = await readRawBody(request);
    if (raw.length > JSON_BODY_LIMIT) throw tooLarge();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8")) as unknown;
    } catch {
      throw badJson();
    }
    if (!jsonDepthGuard(parsed, SEARCH_MAX_DEPTH)) throw unprocessable({ body: "too_deep" });
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw unprocessable({ query: "required" });
    const record = parsed as Record<string, unknown>;
    const query = record["query"];
    if (typeof query !== "string") throw unprocessable({ query: "required" });
    const problem = fieldProblem(query, limitFor("query"));
    if (problem !== undefined) throw unprocessable({ query: problem });
    let roundFilter: number | undefined;
    if (record["round"] !== undefined) {
      const round = record["round"];
      if (typeof round !== "number" || !Number.isInteger(round) || !isRoundNumber(round)) {
        throw unprocessable({ round: "invalid" });
      }
      roundFilter = round;
    }
    const started = Date.now();
    const outcome = await searchAnswers(deps.store, normalise(query), roundFilter);
    if (Date.now() - started > SEARCH_TIME_BUDGET_MS) throw providerUnavailable("search_timeout");
    response.status(200).json({ answers: outcome.answers, count: outcome.count, truncated: outcome.truncated });
  }));

  app.patch("/api/teams/:id", wrap(async (request, response) => {
    const session = await requireRole(deps, request, ["captain"]);
    const id = idParam(request);
    if (session.teamId !== id) throw forbidden();
    requireContentJson(request);
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw unprocessable({ name: "invalid" });
    const name = (body as Record<string, unknown>)["name"];
    if (typeof name !== "string") throw unprocessable({ name: "required" });
    const problem = fieldProblem(name, limitFor("name"));
    if (problem !== undefined) throw unprocessable({ name: problem });
    const trimmed = normalise(name);
    const taken = await deps.store.query(
      `SELECT id FROM teams WHERE lower(name) = lower($1) AND id <> $2`,
      [trimmed, id],
    );
    if (taken.rowCount > 0) throw conflict("name_taken");
    await deps.store.query(`UPDATE teams SET name = $1 WHERE id = $2`, [trimmed, id]);
    response.status(200).json({ team: { id, name: trimmed } });
  }));

  app.post("/api/disputes", wrap(async (request, response) => {
    const session = await requireRole(deps, request, ["captain"]);
    requireContentJson(request);
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw unprocessable({ reason: "invalid" });
    const record = body as Record<string, unknown>;
    const answerId = record["answer_id"];
    if (typeof answerId !== "number" || !Number.isInteger(answerId) || answerId <= 0) {
      throw unprocessable({ answer_id: "invalid" });
    }
    const reason = record["reason"];
    if (typeof reason !== "string") throw unprocessable({ reason: "required" });
    const outcome = validateDisputeReason(reason);
    if (outcome.problem !== undefined) throw unprocessable({ reason: outcome.problem });
    const dispute = await raiseDispute(deps.store, session.teamId!, answerId, outcome.reason!, clock);
    response.status(201).json({ dispute });
  }));

  app.get("/api/disputes", wrap(async (request, response) => {
    const session = await requireRole(deps, request, ["quizmaster", "captain"]);
    const params: unknown[] = [];
    let filter = `1 = 1`;
    if (session.role === "captain") {
      params.push(session.teamId);
      filter = `d.team_id = $1`;
    }
    const result = await deps.store.query(
      `SELECT d.id, d.answer_id, d.team_id, d.round, d.question, d.answer_text,
              d.reason, d.status, d.raised_at, d.ruled_at, d.note
         FROM disputes d
        WHERE ${filter}
        ORDER BY d.id ASC`,
      params,
    );
    response.status(200).json({ disputes: result.rows.map((row) => disputeToApi(row as unknown as Parameters<typeof disputeToApi>[0])) });
  }));

  app.use("/api", (request: Request, response: Response) => {
    void request;
    response.status(404).json({ error: "not_found" });
  });

  registerPages(app, deps);

  app.use((request: Request, response: Response) => {
    const path = request.path;
    void servePage(deps, path === "/" ? "/" : path, response, request as RequestWithSession);
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendError(response, error);
  });

  return app;
}

function idParam(request: Request): number {
  const raw = request.params["id"];
  const rawValue = Array.isArray(raw) ? raw.join("") : raw;
  const value = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(value) || value <= 0) throw notFound();
  return value;
}

function encodeAnswerCursor(id: number): string {
  return encodeCursor(id);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key]);
    }
    return out;
  }
  return value;
}

function methodGuard(allow: readonly string[]): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    if (request.method === "HEAD" && allow.includes("GET")) {
      next();
      return;
    }
    if (request.method === "OPTIONS" || allow.includes(request.method)) {
      next();
      return;
    }
    const withHead = allow.includes("GET") && !allow.includes("HEAD") ? [...allow, "HEAD"] : [...allow];
    sendError(response, methodNotAllowed(withHead));
  };
}

async function ensureSweep(deps: ServerDeps, clock: { now(): Date }): Promise<void> {
  const result = await deps.store.query(
    `UPDATE rounds SET status = 'closed', closed_at = closes_at
      WHERE status = 'open' AND closes_at <= $1`,
    [clock.now().toISOString()],
  );
  void result;
}

export { foldText, applySchemaAndSeed };
