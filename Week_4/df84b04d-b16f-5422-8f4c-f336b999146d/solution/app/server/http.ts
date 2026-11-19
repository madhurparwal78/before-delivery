import type { IncomingMessage, ServerResponse } from "node:http";
import { FIELD_ERRORS } from "../shared/copy.js";

const BODY_LIMIT = 65_536;
export const GRADING_BODY_LIMIT = 1_048_576;

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "validation");
  }
}

export const notFound = () => new ApiError(404, { error: "not_found" });
export const unauthenticated = () => new ApiError(401, { error: "unauthenticated" });
export const invalid = (errors: Record<string, string>) => new ApiError(422, { errors });
export const conflict = (error: string, message: string, extra: Record<string, unknown> = {}) =>
  new ApiError(409, { error, message, ...extra });

export interface Session {
  accountId: string;
  email: string;
  name: string;
  hideCompleted: boolean;
}

export type JsonObject = Record<string, unknown>;

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  user: Session | null;
  /** Parsed body, or null when it was malformed or not an object. */
  body: JsonObject | null;
  setCookie(value: string): void;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: string;
}

type AuthedContext = Context & { user: Session };
type Handler = (context: AuthedContext) => Promise<Reply>;
export type OpenHandler = (context: Context) => Promise<Reply>;

export interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  auth: boolean;
  limit: number;
  gradingKey: boolean;
  handler: OpenHandler;
}

interface RouteOptions {
  limit?: number;
  gradingKey?: boolean;
}

function build(method: string, path: string, auth: boolean, handler: OpenHandler, options: RouteOptions): Route {
  const names: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return {
    method, pattern: new RegExp(`^${source}$`), names, auth,
    limit: options.limit ?? BODY_LIMIT, gradingKey: options.gradingKey ?? false, handler,
  };
}

/** A route that needs a session; the dispatcher answers 401 before the handler runs. */
export const secured = (method: string, path: string, handler: Handler, options: RouteOptions = {}): Route =>
  build(method, path, true, handler as OpenHandler, options);

export const open = (method: string, path: string, handler: OpenHandler, options: RouteOptions = {}): Route =>
  build(method, path, false, handler, options);

export function requireBody(context: Context): JsonObject {
  if (context.body === null) throw invalid({ body: FIELD_ERRORS.body });
  return context.body;
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export class TooLarge extends Error {}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) throw new TooLarge();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

export function parseObject(raw: Buffer): JsonObject | null {
  if (raw.length === 0) return {};
  try {
    const value: unknown = JSON.parse(raw.toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
}

export function isJson(req: IncomingMessage): boolean {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

export function cookieValue(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

