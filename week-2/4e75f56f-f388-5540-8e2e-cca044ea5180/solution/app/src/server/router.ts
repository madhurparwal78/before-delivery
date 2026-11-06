// One route table and one precedence driver for the whole API:
// cross_origin → payload_too_large → unauthenticated → idempotent replay → forbidden → body parse → handler
// (the handler raises 404, then 409, then 422, then file and dependency errors, in that order).
import type { IncomingMessage, ServerResponse } from "node:http";
import { accountForSession, sessionToken, type Account, type Role } from "./auth.js";
import {
  ApiError,
  JSON_LIMIT,
  REQUEST_LIMIT,
  isSameOrigin,
  notFound,
  parseJson,
  parseMultipart,
  readBody,
  sendError,
  sendJson,
  type MultipartBody,
} from "./http.js";
import { fingerprint, keyIsValid, remember, replayOf } from "./idempotency.js";
import { pool } from "./db.js";

export interface Result {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
}

interface BaseCtx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  now: Date;
  body: unknown;
  multipart: MultipartBody | null;
  idempotencyKey: string | null;
  fingerprint: string;
}

interface PublicCtx extends BaseCtx {
  account: Account | null;
}

export interface Ctx extends BaseCtx {
  account: Account;
}

interface PublicRoute {
  method: string;
  path: string;
  access: "public";
  body?: "json";
  handle: (ctx: PublicCtx) => Promise<Result>;
}

interface SignedInRoute {
  method: string;
  path: string;
  access: "signed-in" | readonly Role[];
  body?: "json" | "multipart";
  idempotent?: boolean;
  handle: (ctx: Ctx) => Promise<Result>;
}

type Route = PublicRoute | SignedInRoute;

const routes: { route: Route; pattern: RegExp; keys: string[] }[] = [];

/** A route anyone may call (signed in or not). */
export function publicRoute(definition: Omit<PublicRoute, "access">): void {
  register({ ...definition, access: "public" });
}

/** A route for signed-in accounts; `access` lists the roles that may ever pass it. */
export function route(definition: SignedInRoute): void {
  register(definition);
}

function register(definition: Route): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${definition.path.replace(/:([a-z]+)/g, (_m, key: string) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ route: definition, pattern, keys });
}

function bodyForPrint(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return raw.toString("utf8");
  }
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function match(method: string, path: string) {
  for (const entry of routes) {
    if (entry.route.method !== method) continue;
    const found = entry.pattern.exec(path);
    if (!found) continue;
    const params: Record<string, string> = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1] ?? "");
    });
    return { route: entry.route, params };
  }
  return null;
}

export async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://app.invalid");
  const method = (req.method ?? "GET").toUpperCase();
  try {
    if (STATE_CHANGING.has(method) && !isSameOrigin(req)) {
      throw new ApiError(403, "cross_origin", "Requests must come from this site.");
    }
    const found = match(method, url.pathname);
    const raw = await readBody(req, found?.route.body === "multipart" ? REQUEST_LIMIT : JSON_LIMIT);
    if (!found) throw notFound();
    const { route: definition, params } = found;
    const account = await accountForSession(sessionToken(req));
    const header = req.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header : null;
    const print = fingerprint(method, url.pathname, bodyForPrint(raw));
    const parse = async (): Promise<BaseCtx> => {
      const multipart = definition.body === "multipart" ? parseMultipart(req, raw) : null;
      const body = definition.body === "multipart" ? {} : parseJson(req, raw);
      return { req, params, query: url.searchParams, now: new Date(), body, multipart, idempotencyKey, fingerprint: print };
    };
    let result: Result;
    if (definition.access === "public") {
      result = await definition.handle({ ...(await parse()), account });
    } else {
      if (!account) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
      const replayable = definition.idempotent === true && keyIsValid(idempotencyKey);
      if (replayable) {
        const replay = await replayOf(pool, account.id, idempotencyKey, print);
        if (replay) return sendJson(res, replay.status, replay.body);
      }
      if (Array.isArray(definition.access) && !definition.access.includes(account.role)) {
        throw new ApiError(403, "forbidden", "Your account cannot do this.");
      }
      result = await definition.handle({ ...(await parse()), account });
      if (replayable && (result.status === 200 || result.status === 201)) {
        await remember(account.id, idempotencyKey, print, result.status, result.body);
      }
    }
    sendJson(res, result.status, result.body, result.headers);
  } catch (error) {
    if (error instanceof ApiError) return sendError(res, error);
    console.error(`${method} ${url.pathname} failed:`, error instanceof Error ? error.message : "unknown error");
    sendError(res, new ApiError(500, "internal", "Something went wrong on our side."));
  }
}
