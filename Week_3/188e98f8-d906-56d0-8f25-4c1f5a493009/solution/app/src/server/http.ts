import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors";
import type { Ctx, Reply } from "./context";
import { findSession } from "./sessions";
import { ROUTES, health } from "./routes";
import type { Method } from "./routes";
import { isReady } from "./db";
import { sweepRounds } from "./query";
import { pool } from "./db";
import { SHEET_MAX_BYTES, SHEET_TYPES } from "./sheet";
import type { Json } from "./validate";

const JSON_MAX_BYTES = 16_384;
const METHODS = new Set<Method>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Reads a body; reports an oversize body only after the rest of it has been drained. */
function readBody(req: IncomingMessage, limit: number): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve({ bytes: Buffer.concat(chunks), tooLarge }));
    req.on("error", reject);
  });
}

const tooLarge = () => new ApiError(413, { error: "too_large" });
const unsupported = () => new ApiError(415, { error: "unsupported_media_type" });

/** Boundary checks of the error precedence: size, declared content type, malformed JSON. */
async function readRequestBody(req: IncomingMessage, kind: "none" | "json" | "sheet"): Promise<{ body: Json | undefined; bytes: Buffer }> {
  if (kind === "none") {
    req.resume();
    return { body: undefined, bytes: Buffer.alloc(0) };
  }
  const limit = kind === "json" ? JSON_MAX_BYTES : SHEET_MAX_BYTES;
  const { bytes, tooLarge: over } = await readBody(req, limit);
  if (over) throw tooLarge();
  if (kind === "sheet") {
    if (!(SHEET_TYPES as readonly string[]).includes(mediaType(req))) throw unsupported();
    return { body: undefined, bytes };
  }
  if (bytes.length === 0) return { body: undefined, bytes };
  if (mediaType(req) !== "application/json") throw unsupported();
  try {
    return { body: JSON.parse(bytes.toString("utf8")) as Json, bytes };
  } catch {
    throw new ApiError(400, { error: "bad_json" });
  }
}

export async function dispatchApi(req: IncomingMessage, url: URL): Promise<Reply> {
  const route = ROUTES.map((candidate) => ({ candidate, match: candidate.pattern.exec(url.pathname) })).find((entry) => entry.match !== null);
  if (route === undefined || route.match === null) {
    req.resume();
    throw new ApiError(404, { error: "not_found" });
  }
  const method = (req.method === "HEAD" ? "GET" : req.method) as Method;
  const endpoint = METHODS.has(method) ? route.candidate.methods[method] : undefined;
  if (endpoint === undefined) {
    req.resume();
    const allow = Object.keys(route.candidate.methods).flatMap((name) => (name === "GET" ? ["GET", "HEAD"] : [name]));
    throw new ApiError(405, { error: "method_not_allowed" }, { Allow: allow.join(", ") });
  }
  const { body, bytes } = await readRequestBody(req, endpoint.body);
  if (!isReady() && endpoint.run !== health) throw new ApiError(503, { error: "starting" });
  const session = await findSession(req);
  if (endpoint.session && session === null) throw new ApiError(401, { error: "signed_out" });
  await sweepRounds(pool);
  const ctx: Ctx = { req, session, params: route.match.slice(1), query: url.searchParams, body, bytes };
  return endpoint.run(ctx);
}

export function writeReply(req: IncomingMessage, res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.image !== undefined) {
    res.writeHead(reply.status, { ...headers, "Content-Type": reply.image.contentType, "Content-Length": reply.image.bytes.length });
    res.end(req.method === "HEAD" ? undefined : reply.image.bytes);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body));
  res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": payload.length });
  res.end(req.method === "HEAD" ? undefined : payload);
}
