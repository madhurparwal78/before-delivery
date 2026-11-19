/** The HTTP pipeline: body cap, route lookup, content-type gate, database gate, session, handler. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { BODY_CAP_BYTES } from "../shared/rules.js";
import { DatabaseUnavailable, databaseState } from "./db.js";
import { authenticate } from "./domain/auth.js";
import { ApiError, internal, methodNotAllowed, notFound, payloadTooLarge, serviceUnavailable, unauthorized, unsupportedMediaType } from "./http/errors.js";
import { HANDLED, json, type Reply } from "./http/reply.js";
import { Router } from "./http/router.js";
import type { Context } from "./http/context.js";
import { healthReply, routes } from "./routes.js";

const router = new Router(routes);
const DRAIN_LIMIT_BYTES = 1_048_576;

/** Reads the body, refusing anything over the cap without keeping it. */
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const declared = Number.parseInt(req.headers["content-length"] ?? "0", 10);
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = declared > BODY_CAP_BYTES;
  let drained = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > BODY_CAP_BYTES) tooLarge = true;
    if (tooLarge) {
      drained += chunk.length;
      if (drained > DRAIN_LIMIT_BYTES) break;
    } else chunks.push(chunk);
  }
  if (tooLarge) throw payloadTooLarge();
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, reply: Reply, head: boolean): void {
  res.writeHead(reply.status, {
    "Content-Type": reply.contentType,
    "Content-Length": Buffer.byteLength(reply.body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...reply.headers,
  });
  res.end(head ? undefined : reply.body);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  let failure: ApiError;
  if (error instanceof ApiError) failure = error;
  else if (error instanceof DatabaseUnavailable) failure = serviceUnavailable();
  else {
    console.error(error);
    failure = internal();
  }
  const reply = json(failure.status, failure.body);
  reply.headers = { ...failure.headers, ...(failure.status === 413 ? { Connection: "close" } : {}) };
  send(res, reply, false);
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    const body = await readBody(req);
    const matched = router.match(url.pathname);
    if (!matched) throw notFound();
    const method = req.method ?? "GET";
    const route = matched.routes.find((candidate) => candidate.method === method);
    if (!route) throw methodNotAllowed(matched.routes.map((candidate) => candidate.method));
    if (body.length > 0 && mediaType(req.headers["content-type"]) !== "application/json") throw unsupportedMediaType();
    if (url.pathname === "/api/health") {
      send(res, healthReply(), false);
      return;
    }
    if (!databaseState.ready || !databaseState.reachable) throw serviceUnavailable();
    let user = null;
    if (route.auth) {
      const token = route.tokenInQuery ? url.searchParams.get("token") : bearer(req);
      user = token ? await authenticate(token) : null;
      if (!user) throw unauthorized();
    }
    const key = req.headers["idempotency-key"];
    const ctx = {
      req,
      res,
      method,
      params: Object.fromEntries(Object.entries(matched.params).map(([name, value]) => [name, safeDecode(value)])),
      query: url.searchParams,
      body,
      user,
      idempotencyKey: typeof key === "string" && key !== "" ? key : undefined,
    } as Context;
    const reply = await route.handle(ctx);
    if (reply !== HANDLED) send(res, reply, false);
  } catch (error) {
    sendError(res, error);
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
