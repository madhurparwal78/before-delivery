// Routing, bounded body reading and the one writer of API responses (success and error alike).
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, refuse } from "./errors.js";
import { parseMoneyJson, stringifyMoneyJson } from "../shared/json.js";

const JSON_LIMIT = 64_000;

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
}

export interface Ctx {
  readonly req: IncomingMessage;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly params: Record<string, string>;
  /** The body as received, cut at the route's limit (see bodyTooLarge). */
  readonly body: Buffer;
  readonly bodyTooLarge: boolean;
  header(name: string): string | undefined;
  cookie(name: string): string | undefined;
  /** Rungs 6 to 8 of the ladder for a JSON body: 413, 415, then 400. */
  json(): unknown;
  /** Rungs 6 and 7 for any body with a published content type. */
  expectBody(type: string): void;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  bodyLimit: number;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, bodyLimit = JSON_LIMIT): void {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler, bodyLimit });
  }

  /** The best-matching routes for a path: literal segments beat parameters. */
  match(path: string): { routes: Route[]; params: Record<string, string> } | null {
    const parts = path.split("/").filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return "\u0000";
      }
    });
    let best: { score: number; routes: Route[]; params: Record<string, string> } | null = null;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let score = 0;
      const fits = route.segments.every((segment, i) => {
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = parts[i];
          return true;
        }
        score += 1;
        return segment === parts[i];
      });
      if (!fits) continue;
      if (!best || score > best.score) best = { score, routes: [route], params };
      else if (score === best.score) best.routes.push(route);
    }
    return best && { routes: best.routes, params: best.params };
  }
}

function mediaType(value: string | undefined): string {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

function readBody(req: IncomingMessage, limit: number): Promise<{ body: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve({ body: Buffer.concat(chunks), tooLarge }));
    req.on("error", reject);
  });
}

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0) out.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
  return out;
}

export function errorReply(error: ApiError): Reply {
  return {
    status: error.status,
    json: { error: { code: error.code, message: error.message, fields: error.fields } },
    headers: error.headers,
  };
}

export function write(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  let payload: Buffer | string = "";
  if (reply.json !== undefined) {
    payload = stringifyMoneyJson(reply.json);
    headers["Content-Type"] = "application/json; charset=utf-8";
  } else if (reply.body !== undefined) {
    payload = reply.body;
  }
  if (reply.status !== 204) headers["Content-Length"] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(reply.status === 204 ? undefined : payload);
}

export async function dispatch(router: Router, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const found = router.match(url.pathname);
  if (!found) {
    req.resume();
    write(res, errorReply(refuse.notFound()));
    return;
  }
  const route = found.routes.find((r) => r.method === method || (method === "HEAD" && r.method === "GET"));
  if (!route) {
    req.resume();
    write(res, errorReply(refuse.methodNotAllowed([...new Set(found.routes.map((r) => r.method))])));
    return;
  }
  const { body, tooLarge } = await readBody(req, route.bodyLimit);
  const cookies = parseCookies(req.headers.cookie);
  const header = (name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  const expectBody = (type: string): void => {
    if (tooLarge) throw refuse.tooLarge();
    if (mediaType(header("content-type")) !== type) throw refuse.unsupportedMediaType();
  };
  const ctx: Ctx = {
    req, method, path: url.pathname, query: url.searchParams, params: found.params, body, bodyTooLarge: tooLarge,
    header,
    cookie: (name) => cookies.get(name),
    expectBody,
    json: () => {
      expectBody("application/json");
      try {
        return parseMoneyJson(body.toString("utf8"));
      } catch {
        throw refuse.badJson();
      }
    },
  };
  try {
    write(res, await route.handler(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      write(res, errorReply(error));
      return;
    }
    console.error(`${method} ${url.pathname} failed`, error);
    write(res, errorReply(new ApiError(500, "internal", "Something went wrong on the desk. Try again.")));
  }
}

/** A JSON object body, or a 422 naming the body itself. */
export function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw refuse.invalid({ body: "Send a JSON object." });
}
