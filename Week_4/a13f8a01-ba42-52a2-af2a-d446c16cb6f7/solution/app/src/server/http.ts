import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { User } from "../shared/types.js";
import { requireSignedIn } from "./access.js";
import { config } from "./config.js";
import { Ctx, STREAMED, type Reply } from "./context.js";
import { ApiError, MailUnavailable, notFound, StorageUnavailable } from "./errors.js";
import { claimFor, stored } from "./idempotency.js";
import { assetReply, shellReply } from "./static.js";

type SignedInCtx = Ctx & { viewer: User; sessionToken: string };
type Handler<C> = (ctx: C) => Promise<Reply | typeof STREAMED>;

export interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  signedIn: boolean;
  lazyViewer: boolean;
  idempotent: boolean;
  outage: ((ctx: Ctx) => string) | null;
  handler: Handler<Ctx>;
}

interface Options {
  lazyViewer?: boolean;
  idempotent?: boolean;
  outage?: (ctx: Ctx) => string;
}

function compile(method: string, path: string, signedIn: boolean, handler: Handler<Ctx>, options: Options): Route {
  const names: string[] = [];
  const source = path.replace(/:([a-z]+)/g, (_match, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return {
    method,
    pattern: new RegExp(`^${source}$`),
    names,
    signedIn,
    lazyViewer: options.lazyViewer ?? false,
    idempotent: options.idempotent ?? false,
    outage: options.outage ?? null,
    handler,
  };
}

export const open = (method: string, path: string, handler: Handler<Ctx>, options: Options = {}): Route =>
  compile(method, path, false, handler, options);

export const signedIn = (method: string, path: string, handler: Handler<SignedInCtx>, options: Options = {}): Route =>
  compile(method, path, true, (ctx) => handler(ctx as SignedInCtx), options);

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface Body {
  data: Buffer;
  tooLarge: boolean;
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= config.bodyLimitBytes) chunks.push(chunk);
    });
    req.on("end", () => resolve({ data: Buffer.concat(chunks), tooLarge: size > config.bodyLimitBytes }));
    req.on("error", reject);
  });
}

function sameSite(origin: string): boolean {
  try {
    return new URL(origin).origin === new URL(config.publicUrl).origin;
  } catch {
    return false;
  }
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw notFound();
  }
}

function write(res: ServerResponse, reply: Reply, headOnly: boolean): void {
  const payload = reply.raw ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
  const bytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const headers: Record<string, string | string[] | number> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    ...(reply.body !== undefined || reply.raw !== undefined ? { "Content-Type": reply.type ?? "application/json; charset=utf-8" } : {}),
    ...reply.headers,
    "Content-Length": bytes.length,
  };
  if (reply.status !== 204 && reply.type === undefined) headers["Cache-Control"] ??= "no-store";
  res.writeHead(reply.status, headers);
  res.end(headOnly || reply.status === 204 ? undefined : bytes);
}

function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body };
}

function failure(error: unknown, route: Route | null, ctx: Ctx | null): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageUnavailable) {
    return new ApiError("storage_unavailable", ctx && route?.outage ? route.outage(ctx) : error.message);
  }
  if (error instanceof MailUnavailable) return new ApiError("mail_unavailable", error.message);
  console.error(error);
  return new ApiError("internal_error", "Something went wrong on our side.");
}

export function startServer(routes: readonly Route[]): Server {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://ashlar.local");
    const lookup = method === "HEAD" ? "GET" : method;
    const headOnly = method === "HEAD";
    let route: Route | null = null;
    let ctx: Ctx | null = null;
    try {
      let params: Record<string, string> = {};
      for (const candidate of routes) {
        const match = candidate.method === lookup ? candidate.pattern.exec(url.pathname) : null;
        if (match) {
          route = candidate;
          params = Object.fromEntries(candidate.names.map((name, index) => [name, decoded(match[index + 1] as string)]));
          break;
        }
      }
      if (route === null) {
        if (url.pathname.startsWith("/api/")) throw notFound();
        write(res, (lookup === "GET" ? assetReply(url.pathname) : null) ?? shellReply(404, false), headOnly);
        return;
      }
      const body = WRITES.has(lookup) ? await readBody(req) : { data: Buffer.alloc(0), tooLarge: false };
      if (body.tooLarge) throw new ApiError("body_too_large", "The request body is too large.");
      ctx = new Ctx(req, res, url, params, body.data);
      const origin = req.headers.origin;
      if (WRITES.has(lookup) && url.pathname.startsWith("/api/") && ctx.sessionToken !== undefined && origin !== undefined && !sameSite(origin)) {
        throw new ApiError("forbidden", "Cross-site request refused.");
      }
      if (!route.lazyViewer) await ctx.resolveViewer();
      if (route.signedIn) requireSignedIn(ctx.viewer);
      if (route.idempotent && ctx.viewer) {
        ctx.claim = claimFor(ctx.viewer.id, lookup, url.pathname, ctx.header("idempotency-key"), ctx.parsedBody());
        const replay = ctx.claim ? await stored(ctx.claim) : null;
        if (replay) {
          write(res, { status: replay.status, raw: replay.response, type: "application/json; charset=utf-8" }, headOnly);
          return;
        }
      }
      const reply = await route.handler(ctx);
      if (reply !== STREAMED) write(res, reply, headOnly);
    } catch (error) {
      const problem = failure(error, route, ctx);
      if (res.headersSent) res.end();
      else write(res, errorReply(problem), headOnly);
    }
  };
  return createServer((req, res) => {
    void handle(req, res);
  }).listen(config.port, "0.0.0.0");
}
