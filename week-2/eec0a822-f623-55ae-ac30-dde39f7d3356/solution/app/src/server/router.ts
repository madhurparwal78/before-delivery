// The API's single error ladder. The router answers rungs 1 to 3 (unknown path, wrong method, rate limit,
// session); each handler continues in ladder order with ctx.forbid / ctx.json / domain refusals.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticate, type Member, type Role } from "./auth";
import { ApiError, forbidden, notFound, readJson, sendJson, type Json, type Reply } from "./http";

export class Ctx {
  member!: Member;
  readonly now = Date.now();

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly url: URL,
    readonly params: Record<string, string>,
  ) {}

  /** Rung 5: refuse a role that may not act. */
  allow(roles: readonly Role[]): void {
    if (this.member.role !== "fleet_director" && !roles.includes(this.member.role)) throw forbidden();
  }

  /** Rungs 6 to 8: size, content type, parse. */
  json(): Promise<unknown> {
    return readJson(this.req);
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }
}

interface RouteOptions {
  staff?: boolean;
  limit?: (ctx: Ctx) => Promise<void>;
  handle: (ctx: Ctx) => Promise<Reply | RawReply>;
}

interface RawReply {
  raw: true;
  status: number;
  headers: Record<string, string>;
  body: Buffer | string;
}

interface Route {
  pattern: RegExp;
  keys: string[];
  methods: Map<string, RouteOptions>;
}

const routes: Route[] = [];

export function route(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: RouteOptions): void {
  let entry = routes.find((r) => r.pattern.source === compile(path).pattern.source);
  if (!entry) {
    entry = { ...compile(path), methods: new Map() };
    routes.push(entry);
  }
  entry.methods.set(method, options);
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

/** A path segment that is not valid UTF-8 or holds a control character names nothing: rung 1. */
function decodeParam(segment: string): string {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    throw notFound();
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw notFound();
  return value;
}

export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    let found: Route | undefined;
    let match: RegExpExecArray | null = null;
    for (const candidate of routes) {
      match = candidate.pattern.exec(url.pathname);
      if (match) {
        found = candidate;
        break;
      }
    }
    if (!found || !match) throw notFound();
    const options = found.methods.get(req.method ?? "GET");
    if (!options) {
      throw new ApiError(405, { error: "method_not_allowed" }, { Allow: [...found.methods.keys()].join(", ") });
    }
    const params: Record<string, string> = {};
    found.keys.forEach((key, index) => {
      params[key] = decodeParam(match![index + 1]);
    });
    const ctx = new Ctx(req, res, url, params);
    if (options.limit) await options.limit(ctx);
    if (options.staff) {
      ctx.member = await authenticate(req);
      if (params.ws !== undefined && params.ws !== ctx.member.workspaceSlug) throw notFound();
    }
    const reply = await options.handle(ctx);
    if ("raw" in reply) {
      res.writeHead(reply.status, reply.headers);
      res.end(reply.body);
    } else {
      sendJson(res, reply.status, reply.body, reply.headers);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body, error.headers);
      return;
    }
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: "server_error" } as Json);
  }
}
