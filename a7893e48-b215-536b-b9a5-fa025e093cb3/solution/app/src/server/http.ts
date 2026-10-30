import type { IncomingMessage, ServerResponse } from "node:http";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

const MESSAGES: Record<string, string> = {
  invalid_json: "The request body is not valid JSON.",
  unauthenticated: "Sign in to continue.",
  invalid_credentials: "Email or password is wrong.",
  not_found: "Nothing was found at that address.",
  forbidden: "Your role can't do that here.",
  idempotency_key_required: "Send an Idempotency-Key header of 8 to 128 letters, digits, hyphens or underscores.",
  idempotency_key_reused: "That Idempotency-Key was already used with a different request.",
  request_in_progress: "A request with that Idempotency-Key is still running.",
  invalid_transition: "That action isn't allowed in the current state.",
  billing_unavailable: "Billing is unreachable, so nothing was charged or refunded.",
  cross_origin: "Requests from another origin are refused.",
  body_too_large: "The request body is too large.",
  unsupported_media_type: "Send this request as JSON.",
  validation: "Some fields need attention.",
  slot_taken: "Another claim already covers that station time.",
  hold_expired: "The hold ran out before confirmation. Nothing was charged.",
  certificate_required: "A liability certificate must cover every date of the booking.",
  pay_now_required: "This booking starts too soon to pay later.",
  pack_insufficient: "The pack no longer covers these hours.",
  outside_check_in_window: "Check-in opens 30 minutes before start.",
  cleaning_fee_already_charged: "A cleaning fee was already charged for this booking.",
  email_taken: "A user with that email already exists.",
  policy_date_taken: "A policy already starts on that date.",
  file_too_large: "Files must be 5,000,000 bytes or smaller.",
  unsupported_file_type: "Files must be PDF, PNG or JPEG.",
  link_not_found: "This binder link is no longer valid.",
  read_only: "Binder links are read-only.",
};

/** Every API error in the brief's one shape: {"error", "message", ...extra}. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: JsonObject = {},
    message?: string,
  ) {
    super(message ?? MESSAGES[code] ?? code);
  }

  body(): JsonObject {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation", { fields });
}

export function invalidTransition(from: string, action: string): ApiError {
  return new ApiError(409, "invalid_transition", { from, action }, `A ${from.replace(/_/g, " ")} record can't take the ${action.replace(/_/g, " ")} action.`);
}

export interface Reply {
  status: number;
  body?: Json;
  raw?: { data: Buffer | string; type: string; headers?: Record<string, string> };
  headers?: Record<string, string>;
}

export const json = (status: number, body: Json, headers?: Record<string, string>): Reply =>
  headers ? { status, body, headers } : { status, body };

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  params: Record<string, string>;
  body: Json;
  raw: Buffer;
}

type BodyKind = "json" | "multipart" | "none";

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  body: BodyKind;
  handler: (request: ApiRequest) => Promise<Reply>;
}

const JSON_LIMIT = 64000;
const MULTIPART_LIMIT = 5100000;
const routes: Route[] = [];

/** Registers a route; `:name` segments become params. */
export function route(method: string, path: string, handler: Route["handler"], body: BodyKind = method === "GET" || method === "DELETE" ? "none" : "json"): void {
  const names: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:([a-z_]+)/g, (_match, name: string) => { names.push(name); return "([^/]+)"; })}$`);
  routes.push({ method, pattern, names, body, handler });
}

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method && !(method === "HEAD" && candidate.method === "GET")) continue;
    const found = candidate.pattern.exec(path);
    if (!found) continue;
    const params: Record<string, string> = {};
    candidate.names.forEach((name, index) => { params[name] = decodeURIComponent(found[index + 1] ?? ""); });
    return { route: candidate, params };
  }
  return null;
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (declared > limit) {
    request.resume();
    throw new ApiError(413, "body_too_large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) {
      request.resume();
      throw new ApiError(413, "body_too_large");
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function mediaType(request: IncomingMessage): string {
  return (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Same-origin rule: a write's Origin must equal the origin the request was addressed to. */
function crossOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin || !WRITES.has(request.method ?? "")) return false;
  const host = request.headers.host ?? "";
  return origin !== `http://${host}` && origin !== `https://${host}`;
}

export function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", ...reply.headers };
  if (reply.raw) {
    response.writeHead(reply.status, { "Content-Type": reply.raw.type, ...reply.raw.headers, ...headers });
    response.end(reply.raw.data);
    return;
  }
  if (reply.body === undefined) {
    response.writeHead(reply.status, { "Cache-Control": "no-store", ...headers });
    response.end();
    return;
  }
  response.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(reply.body));
}

function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body() };
}

/**
 * The single precedence order for the API: binder read-only, cross-origin writes, body limits and
 * content type, then invalid JSON; everything later (401 → 404 → 403 → key → replay → state →
 * validation → billing) is ordered inside each handler.
 */
export async function handleApi(request: IncomingMessage, url: URL, fallback: () => Promise<Reply | null>): Promise<Reply> {
  const method = request.method ?? "GET";
  const path = url.pathname;
  try {
    if ((path.startsWith("/binder/") || path.startsWith("/api/binder/")) && method !== "GET" && method !== "HEAD") {
      request.resume();
      throw new ApiError(405, "read_only");
    }
    if (crossOrigin(request)) {
      request.resume();
      throw new ApiError(403, "cross_origin");
    }
    const found = match(method, path);
    if (!found) {
      request.resume();
      const other = await fallback();
      if (other) return other;
      throw new ApiError(404, "not_found");
    }
    let body: Json = {};
    let raw: Buffer = Buffer.alloc(0);
    if (found.route.body === "json") {
      raw = await readBody(request, JSON_LIMIT);
      if (raw.length > 0) {
        if (mediaType(request) !== "application/json") throw new ApiError(415, "unsupported_media_type");
        try {
          body = JSON.parse(raw.toString("utf8")) as Json;
        } catch {
          throw new ApiError(400, "invalid_json");
        }
      }
    } else if (found.route.body === "multipart") {
      if (mediaType(request) !== "multipart/form-data") {
        request.resume();
        throw new ApiError(415, "unsupported_media_type", {}, "Send documents as multipart/form-data.");
      }
      raw = await readBody(request, MULTIPART_LIMIT);
    } else {
      request.resume();
    }
    return await found.route.handler({ method, path, query: url.searchParams, headers: request.headers, params: found.params, body, raw });
  } catch (error) {
    if (error instanceof ApiError) return errorReply(error);
    console.error(`Unhandled error on ${method} ${path}:`, error instanceof Error ? error.message : "unknown error");
    return errorReply(new ApiError(500, "internal", {}, "Something went wrong on the server."));
  }
}

/** Reads a field of a JSON object body; anything that is not an object reads as empty. */
export function field(body: Json, name: string): Json | undefined {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? body[name] : undefined;
}

export function cookie(request: ApiRequest, name: string): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export interface Part {
  name: string;
  filename: string | null;
  data: Buffer;
}

/** Splits a buffered multipart/form-data body into its parts. */
export function multipart(request: ApiRequest): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(request.headers["content-type"] ?? "");
  const token = boundary?.[1] ?? boundary?.[2];
  if (!token) return [];
  const delimiter = Buffer.from(`--${token.trim()}`);
  const parts: Part[] = [];
  let start = request.raw.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length;
    if (request.raw.subarray(headerStart, headerStart + 2).toString() === "--") break;
    const next = request.raw.indexOf(delimiter, headerStart);
    if (next === -1) break;
    const chunk = request.raw.subarray(headerStart + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = chunk.subarray(0, split).toString("utf8");
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1] ?? null;
      if (name !== undefined) parts.push({ name, filename, data: chunk.subarray(split + 4) });
    }
    start = next;
  }
  return parts;
}
