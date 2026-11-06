// One error shape and one precedence order for every route (brief: API → Error body, Error precedence).
// Steps 1–3 (origin, envelope, session) run here before any handler; handlers raise steps 4–9 in order.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import type { ErrorBody, User } from "../shared/api.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly remaining?: number,
  ) {
    super(message);
  }

  body(): ErrorBody {
    return {
      error: this.code,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {}),
      ...(this.remaining !== undefined ? { remaining: this.remaining } : {}),
    };
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "That record isn't available to you.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "Your role can't do that.");
export const conflict = (code: string, message: string, remaining?: number): ApiError =>
  new ApiError(409, code, message, undefined, remaining);
export const gone = (code: "link_signed" | "link_expired" | "file_link_expired", message: string): ApiError =>
  new ApiError(410, code, message);
export const billingUnavailable = (): ApiError =>
  new ApiError(503, "billing_unavailable", "Billing is unreachable. Try again in a minute.");
export const storageUnavailable = (): ApiError =>
  new ApiError(503, "storage_unavailable", "File storage is unreachable. Try again in a minute.");

/** Collects 422 field messages; the first message for a field wins. */
export class FieldErrors {
  private readonly messages: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.messages)) this.messages[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.messages).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw new ApiError(422, "validation_failed", "Some fields need attention.", { ...this.messages });
  }
}

const JSON_LIMIT = 64_000;

export interface Reply {
  status: number;
  json?: unknown;
  headers?: Record<string, string | string[]>;
  stream?: Readable;
}

type BodyKind = "json" | "multipart" | "none";

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  body: Record<string, unknown>;
  header(name: string): string | undefined;
  now: Date;
}

/** Routes with `auth: true` only run with a signed-in user (step 3 of the precedence). */
export interface SignedInCtx extends Ctx {
  user: User;
}

interface RouteBase {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body: BodyKind;
}

export type Route = RouteBase & ({ auth: true; handler(ctx: SignedInCtx): Promise<Reply> } | { auth: false; handler(ctx: Ctx): Promise<Reply> });

type Authenticate = (req: IncomingMessage) => Promise<User | null>;

interface Compiled {
  route: Route;
  pattern: RegExp;
  names: string[];
}

export function compile(routes: readonly Route[]): Compiled[] {
  return routes.map((route) => {
    const names: string[] = [];
    const source = route.path.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { route, pattern: new RegExp(`^${source}$`), names };
  });
}

function isForeignOrigin(req: IncomingMessage): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

/** Reads at most `limit` bytes; returns null when the body is larger (the rest is drained). */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? "0");
  const chunks: Buffer[] = [];
  let size = 0;
  let over = declared > limit;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) over = true;
    if (!over) chunks.push(chunk);
  }
  return over ? null : Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, JSON_LIMIT);
  if (raw === null) throw new ApiError(413, "payload_too_large", "Request bodies must be 64,000 bytes or smaller.");
  if (raw.length === 0) return {};
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const unsupported = new ApiError(415, "unsupported_media_type", "Send the request body as JSON.");
  if (type !== "application/json") throw unsupported;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw unsupported;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

const API_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { ...API_HEADERS, ...reply.headers };
  if (reply.stream) {
    res.writeHead(reply.status, headers);
    reply.stream.pipe(res);
    return;
  }
  if (reply.json === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.json);
  res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  send(res, { status: error.status, json: error.body() });
}

/** Runs the shared pipeline for one /api or /files request. */
export async function dispatch(
  compiled: readonly Compiled[],
  authenticate: Authenticate,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  try {
    if (isForeignOrigin(req)) throw new ApiError(403, "cross_origin", "Requests must come from Bloom Desk itself.");
    let match: { entry: Compiled; values: string[] } | null = null;
    for (const entry of compiled) {
      if (entry.route.method !== req.method) continue;
      const found = entry.pattern.exec(path);
      if (found) {
        match = { entry, values: found.slice(1) };
        break;
      }
    }
    if (match === null) {
      req.resume();
      throw new ApiError(404, "not_found", "There is nothing at that address.");
    }
    const { route } = match.entry;
    let params: Record<string, string>;
    try {
      params = Object.fromEntries(match.entry.names.map((name, index) => [name, decodeURIComponent(match.values[index])]));
    } catch {
      req.resume();
      throw notFound();
    }
    let body: Record<string, unknown> = {};
    if (route.body === "json") body = await readJson(req);
    if (route.body === "multipart" && !/^multipart\/form-data;.*boundary=/i.test(req.headers["content-type"] ?? "")) {
      req.resume();
      throw new ApiError(415, "unsupported_media_type", "Send the photo as multipart/form-data.");
    }
    if (route.body === "none") req.resume();
    const ctx: Ctx = {
      req,
      params,
      body,
      header: (name) => {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
      now: new Date(),
    };
    if (!route.auth) {
      send(res, await route.handler(ctx));
      return;
    }
    const user = await authenticate(req);
    if (user === null) throw new ApiError(401, "unauthenticated", "Your session has ended. Sign in again.");
    send(res, await route.handler({ ...ctx, user }));
  } catch (error) {
    req.resume();
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    console.error(`${req.method} ${path} failed:`, error instanceof Error ? error.message : error);
    sendError(res, new ApiError(500, "internal_error", "Something went wrong on our side. Try again in a minute."));
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A trimmed string whose length is within bounds, else null. */
export function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

export function wholeNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** A number with at most one decimal as integer tenths, within bounds (in tenths), else null. */
export function tenths(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const scaled = Math.round(value * 10);
  if (Math.abs(scaled - value * 10) > 1e-7) return null;
  return scaled >= min && scaled <= max ? scaled : null;
}
