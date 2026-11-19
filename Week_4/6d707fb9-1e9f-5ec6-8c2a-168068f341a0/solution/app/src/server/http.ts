import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { config } from "./config";
import { now, pool } from "./db";
import { rateCheck, type RateKind } from "./rate";

const BODY_LIMIT = 1_000_000;
const FILE_LIMIT = 5_000_000;
const WHOLE_LIMIT = 10_000_000;
/** An upload past every limit is read no further than this before its 413 goes out. */
const DRAIN_LIMIT = 64_000_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function fieldErrors(fields: Record<string, string>): ApiError {
  const first = Object.values(fields)[0] as string;
  return new ApiError(422, "validation_failed", first, fields);
}

export function refused(message: string): ApiError {
  return new ApiError(422, "validation_failed", message);
}

export function conflict(message: string): ApiError {
  return new ApiError(409, "conflict", message);
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "We couldn't find that.");
}

export interface Answer {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  text?: string;
  headers?: Record<string, string>;
}

export interface Session {
  assessorId: string;
  name: string;
  email: string;
  endsAt: Date;
  tokenHash: string;
}

export interface Call {
  method: string;
  path: string;
  params: string[];
  query: URLSearchParams;
  request: IncomingMessage;
  raw: Buffer;
  session: Session | null;
  body: unknown;
}

type Input = "none" | "json" | "emptyOrJson" | "csv" | "multipart";

interface RouteSpec<R> {
  auth?: boolean;
  rate?: RateKind;
  input?: Input;
  /** Step 5: the resource, 404 or 410. */
  resource?: (call: Call) => Promise<R>;
  /** Replays a stored Request-Key response right after step 5. */
  replay?: (call: Call, resource: R) => Promise<Answer | null>;
  handle: (call: Call, resource: R) => Promise<Answer>;
}

interface Route {
  method: string;
  pattern: RegExp;
  spec: RouteSpec<unknown>;
}

const routes: Route[] = [];

export function route<R = undefined>(method: string, path: string, spec: RouteSpec<R>): void {
  const pattern = new RegExp(`^${path.replace(/:[a-zA-Z]+/g, "([^/]+)")}$`);
  routes.push({ method, pattern, spec: spec as RouteSpec<unknown> });
}

export function ok(json: unknown, status = 200): Answer {
  return { status, json };
}

export function empty(): Answer {
  return { status: 204 };
}

/** A path segment as text the database can hold: a broken escape stays as typed, and a NUL matches no id. */
export function pathParam(segment: string): string {
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch {
    // Not an escape at all, so it is looked up as typed and found nowhere.
  }
  return text.replaceAll("\0", "\uFFFD");
}

function holdsNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\0");
  if (Array.isArray(value)) return value.some(holdsNul);
  return typeof value === "object" && value !== null && Object.values(value).some(holdsNul);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export { hashToken };

function cookieOf(request: IncomingMessage): string | null {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === "fioSession" && value) return value;
  }
  return null;
}

type SessionLookup = { kind: "none" } | { kind: "ended" } | { kind: "live"; session: Session };

export async function lookUpSession(request: IncomingMessage): Promise<SessionLookup> {
  const token = cookieOf(request);
  if (!token) return { kind: "none" };
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(
    `SELECT s.ends_at, s.ended, a.id, a.name, a.email FROM sessions s JOIN assessors a ON a.id = s.assessor_id
     WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return { kind: "none" };
  if (row.ended || now() >= row.ends_at) return { kind: "ended" };
  return {
    kind: "live",
    session: { assessorId: row.id, name: row.name, email: row.email, endsAt: row.ends_at, tokenHash },
  };
}

export function sessionCookie(token: string): string {
  return `fioSession=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

/** Reads the body up to its limit, always to the end of the request, so a refusal is a complete answer. */
async function readBody(request: IncomingMessage, limit: number): Promise<{ raw: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      tooLarge = true;
      chunks.length = 0;
      if (size > DRAIN_LIMIT) break;
    } else {
      chunks.push(chunk);
    }
  }
  return { raw: Buffer.concat(chunks), tooLarge };
}

export function multipartFile(raw: Buffer, contentType: string): { fileName: string; data: Buffer } | null {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let at = raw.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (raw.subarray(start, start + 2).toString() === "--") return null;
    const next = raw.indexOf(delimiter, start);
    if (next < 0) return null;
    const headerEnd = raw.indexOf("\r\n\r\n", start);
    if (headerEnd < 0 || headerEnd > next) return null;
    const headers = raw.subarray(start, headerEnd).toString("utf8");
    if (/name="file"/i.test(headers)) {
      const name = (/filename="([^"]*)"/i.exec(headers)?.[1] ?? "evidence").replaceAll("\0", "");
      return { fileName: name, data: raw.subarray(headerEnd + 4, next - 2) };
    }
    at = next;
  }
  return null;
}

function limitOf(input: Input): number {
  return input === "multipart" ? WHOLE_LIMIT : BODY_LIMIT;
}

function matches(contentType: string, wanted: string): boolean {
  return contentType.split(";")[0]?.trim().toLowerCase() === wanted;
}

/** The precedence ladder, the one path every endpoint answers through. */
async function ladder(request: IncomingMessage, url: URL): Promise<Answer> {
  const path = url.pathname;
  const onPath = routes.filter((candidate) => candidate.pattern.test(path));
  const method = request.method === "HEAD" ? "GET" : (request.method ?? "GET");
  const found = onPath.find((candidate) => candidate.method === method);

  if (!found) {
    request.resume();
    if (!onPath.length) throw notFound();
    const allow = [...new Set(onPath.map((candidate) => candidate.method))].join(", ");
    throw methodNotAllowed(allow);
  }

  const { spec } = found;
  const input = spec.input ?? "none";
  const { raw, tooLarge } = await readBody(request, limitOf(input));
  if (tooLarge) throw new ApiError(413, "too_large", "That is too large.");
  if (input === "multipart") {
    const file = multipartFile(raw, request.headers["content-type"] ?? "");
    if (file && file.data.length > FILE_LIMIT) throw new ApiError(413, "too_large", "That is too large.");
  }

  const lookup = await lookUpSession(request);
  const session = lookup.kind === "live" ? lookup.session : null;

  if (spec.rate && session) {
    await rateCheck(pool, session.assessorId, spec.rate);
  }

  if (spec.auth !== false && !session) {
    if (lookup.kind === "ended") {
      throw new ApiError(401, "session_ended", "Your session ended. Sign in again to keep going — what you typed is still here.");
    }
    throw new ApiError(401, "not_signed_in", "Sign in first.");
  }

  const params = (found.pattern.exec(path) as RegExpExecArray).slice(1).map(pathParam);
  const call: Call = { method, path, params, query: url.searchParams, request, raw, session, body: undefined };
  const resource = spec.resource ? await spec.resource(call) : undefined;

  if (spec.replay) {
    const replayed = await spec.replay(call, resource);
    if (replayed) return replayed;
  }

  const contentType = request.headers["content-type"] ?? "";
  if (input === "json" || (input === "emptyOrJson" && raw.length > 0)) {
    if (!matches(contentType, "application/json")) {
      throw new ApiError(415, "unsupported_media_type", "This endpoint takes application/json.");
    }
    try {
      call.body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new ApiError(400, "malformed_json", "That body isn't valid JSON.");
    }
    if (typeof call.body !== "object" || call.body === null || Array.isArray(call.body)) {
      throw new ApiError(400, "malformed_json", "That body isn't a JSON object.");
    }
    const withNul = Object.entries(call.body).find(([, value]) => holdsNul(value));
    if (withNul) throw fieldErrors({ [withNul[0]]: "Give a value here." });
  }
  if (input === "emptyOrJson" && raw.length === 0) call.body = {};
  if (input === "csv" && !matches(contentType, "text/csv")) {
    throw new ApiError(415, "unsupported_media_type", "This endpoint takes text/csv.");
  }

  return spec.handle(call, resource);
}

function send(response: ServerResponse, answer: Answer, head: boolean): void {
  const headers: Record<string, string | number> = { ...answer.headers };
  let payload: Buffer | undefined;
  if (answer.json !== undefined) {
    payload = Buffer.from(JSON.stringify(answer.json));
    headers["Content-Type"] = "application/json; charset=utf-8";
  } else if (answer.text !== undefined) {
    payload = Buffer.from(answer.text);
  } else if (answer.bytes) {
    payload = answer.bytes;
  }
  if (payload) headers["Content-Length"] = payload.length;
  headers["X-Content-Type-Options"] = "nosniff";
  response.writeHead(answer.status, headers);
  response.end(head ? undefined : payload);
}

/** The one error shape. */
export function errorAnswer(error: ApiError): Answer {
  const body = { code: error.code, message: error.message, ...(error.fields && { fields: error.fields }), ...error.extra };
  return { status: error.status, json: { error: body }, headers: error.headers };
}

export function methodNotAllowed(allow: string): ApiError {
  return new ApiError(405, "method_not_allowed", "That method isn't allowed here.", undefined, undefined, { Allow: allow });
}

export async function answerApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  try {
    send(response, await ladder(request, url), request.method === "HEAD");
  } catch (error) {
    if (error instanceof ApiError) {
      send(response, errorAnswer(error), false);
      return;
    }
    console.error(error);
    send(response, { status: 500, json: { error: { code: "internal", message: "Something went wrong." } } }, false);
  }
}

export function sendDocument(response: ServerResponse, answer: Answer, head: boolean): void {
  send(response, answer, head);
}

export function publicAddress(path: string): string {
  return `${config.publicUrl}${path}`;
}
