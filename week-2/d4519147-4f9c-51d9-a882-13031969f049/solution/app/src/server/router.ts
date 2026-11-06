import type { IncomingMessage, ServerResponse } from "node:http";
import { pool } from "./db.ts";
import { ApiError, internalError, INVALID_JSON, multipartFile, parseJson, readBody, sendError, validation, type UploadedFile } from "./http.ts";
import { clientIp, passesOriginRule } from "./security.ts";
import { requireSession, resolveSession, type Session, type SessionState } from "./sessions.ts";

const JSON_LIMIT = 1_000_000;
const UPLOAD_LIMIT = 2_100_000;
const FILE_LIMIT = 2_000_000;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `session`: a live session is required. `optional`: used when present. `none`: never read. */
type Auth = "session" | "optional" | "none";

/** The `{name}` segments of a route path, so each handler sees exactly its own path parameters. */
type ParamKeys<P extends string> = P extends `${string}{${infer K}}${infer Rest}` ? K | ParamKeys<Rest> : never;

interface BaseContext<K extends string = string> {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<K, string>;
  ip: string;
  /** The request's session state, for `optional` routes. */
  sessionState: SessionState;
  /** The parsed JSON body; invalid JSON answers 422 when a handler reads it, at the validation step. */
  body(): Record<string, unknown>;
  file: UploadedFile | null;
}

type Context<A extends Auth = Auth, K extends string = string> = BaseContext<K> & (A extends "session" ? { session: Session } : { session: Session | null });

interface Route {
  method: Method;
  pattern: RegExp;
  keys: string[];
  auth: Auth;
  input: "json" | "multipart" | "none";
  /** GET-only paths answer 405 to every other method before any other check. */
  getOnly?: boolean;
  handler: (ctx: Context) => Promise<void>;
}

const routes: Route[] = [];

export function route<A extends Auth, P extends string>(method: Method, path: P, options: { auth: A; input?: Route["input"]; getOnly?: boolean }, handler: (ctx: Context<A, ParamKeys<P>>) => Promise<void>): void {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/\{(\w+)\}/g, (_m, k: string) => (keys.push(k), "([^/]+)"))}$`);
  routes.push({ method, pattern, keys, auth: options.auth, input: options.input ?? (method === "GET" || method === "DELETE" ? "none" : "json"), getOnly: options.getOnly, handler: handler as Route["handler"] });
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isJsonType(type: string | undefined): boolean {
  return (type ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";
}

/** The single error precedence for every endpoint. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method ?? "GET";
  const matching = routes.filter((r) => r.pattern.test(path));
  try {
    if (matching.some((r) => r.getOnly) && method !== "GET") {
      req.resume();
      throw new ApiError(405, "method_not_allowed", "Only GET is allowed here.", undefined, { Allow: "GET" });
    }
    if (matching.length === 0) {
      req.resume();
      throw new ApiError(404, "not_found", "Nothing was found at this address.");
    }
    const found = matching.find((r) => r.method === method);
    if (!found) {
      req.resume();
      throw new ApiError(405, "method_not_allowed", "This method is not allowed here.", undefined, { Allow: [...new Set(matching.map((r) => r.method))].join(", ") });
    }
    const params = Object.fromEntries(found.keys.map((k, i) => [k, decodeSegment(found.pattern.exec(path)![i + 1]!)]));

    if (STATE_CHANGING.has(method) && !passesOriginRule(req)) {
      req.resume();
      throw new ApiError(403, "cross_site_request", "Cross-site requests are refused.");
    }

    let raw: Buffer = Buffer.alloc(0);
    let file: UploadedFile | null = null;
    if (found.input === "json") {
      const body = await readBody(req, JSON_LIMIT);
      if (body === null) throw new ApiError(413, "payload_too_large", "The request body is too large.");
      if (body.length > 0 && !isJsonType(req.headers["content-type"])) throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
      raw = body;
    } else if (found.input === "multipart") {
      const body = await readBody(req, UPLOAD_LIMIT);
      if (body === null) throw new ApiError(413, "file_too_large", "This file is too large to import.");
      const type = req.headers["content-type"] ?? "";
      if (!/^multipart\/form-data/i.test(type)) throw new ApiError(415, "unsupported_media_type", "Send the file as multipart/form-data.");
      file = multipartFile(body, type);
      if (file && file.bytes.length > FILE_LIMIT) throw new ApiError(413, "file_too_large", "This file is too large to import.");
    } else {
      req.resume();
    }

    const sessionState: SessionState = found.auth === "none" ? { kind: "none" } : await resolveSession(pool, req, true);
    const session = found.auth === "session" ? requireSession(sessionState) : sessionState.kind === "active" ? sessionState.session : null;
    if (STATE_CHANGING.has(method) && found.auth !== "none" && sessionState.kind === "active") {
      if (req.headers["x-csrf-token"] !== sessionState.session.csrfToken) throw new ApiError(403, "csrf_token_invalid", "The CSRF token is missing or does not belong to this session.");
    }

    let parsed: unknown = null;
    const ctx: BaseContext & { session: Session | null } = {
      req, res, params, ip: clientIp(req), session, sessionState, file,
      body() {
        parsed ??= parseJson(raw);
        if (parsed === INVALID_JSON || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw validation({ body: "invalid_json" });
        return parsed as Record<string, unknown>;
      },
    };
    await found.handler(ctx as Context);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof ApiError) return sendError(res, error);
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    console.error(`unexpected error on ${method} ${routeLabel(path)}${code ? ` (${code})` : ""}`);
    sendError(res, internalError());
  }
}

/** A path segment; malformed percent-encoding names nothing, so it answers not-found. */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ApiError(404, "not_found", "Nothing was found at this address.");
  }
}

/** The route pattern for logs: never the raw path, which can carry tokens. */
function routeLabel(path: string): string {
  const r = routes.find((x) => x.pattern.test(path));
  return r ? r.pattern.source : "unknown route";
}
