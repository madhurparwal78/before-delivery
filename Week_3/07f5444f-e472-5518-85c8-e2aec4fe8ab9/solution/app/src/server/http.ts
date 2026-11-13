// HTTP plumbing: the router, the server-boundary checks and the single error order.
//   1. boundary (403 cross_origin, 413, 415)  2. 401  3. 404  4. 403  5. replay  6. 409  7. 422
// Steps 1 run here before a handler; handlers run 2-7 in that order through the helpers in errors.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, invalid, notFound } from "./errors.js";
import { parseMultipart, type Multipart } from "./multipart.js";

const JSON_LIMIT = 65_536;
const UPLOAD_LIMIT = 20_100_000;
const FILE_LIMIT = 20_000_000;

type Body =
  | { kind: "none" }
  | { kind: "json"; value: unknown }
  | { kind: "malformed" }
  | { kind: "multipart"; form: Multipart | null };

export interface Request {
  method: string;
  path: string;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  body: Body;
}

interface Reply {
  status: number;
  json?: unknown;
  bytes?: { data: Buffer; contentType: string; disposition: string };
  cookie?: string;
}

type Handler = (request: Request) => Promise<Reply>;
type BodyKind = "none" | "json" | "multipart";

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  body: BodyKind;
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, body: BodyKind, handler: Handler): void {
  const names: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/\{(\w+)\}/g, (_, name: string) => (names.push(name), "([^/]+)")) + "$",
  );
  routes.push({ method, pattern, names, body, handler });
}

/** The JSON body of a request, or the 422 for a malformed one (validation is the last step). */
export function jsonBody(request: Request): unknown {
  if (request.body.kind === "json") return request.body.value;
  if (request.body.kind === "malformed") throw invalid({ body: "The request body is not valid JSON." });
  return undefined;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/** Reads up to `limit` bytes; null when the body is larger (the rest is drained, not kept). */
async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers["content-length"]);
  const chunks: Buffer[] = [];
  let size = 0;
  let over = Number.isFinite(declared) && declared > limit;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) over = true;
    if (!over) chunks.push(chunk);
  }
  return over ? null : Buffer.concat(chunks);
}

function mediaType(request: IncomingMessage): string {
  return (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function boundary(request: IncomingMessage, kind: BodyKind): Promise<Body> {
  const method = request.method ?? "GET";
  if (["POST", "PUT", "DELETE"].includes(method) && !sameOrigin(request)) {
    throw new ApiError(403, { error: "cross_origin", message: "Requests must come from this site." });
  }
  if (kind === "json") {
    const raw = await readBody(request, JSON_LIMIT);
    if (raw === null) {
      throw new ApiError(413, { error: "body_too_large", message: "The request body is larger than 65,536 bytes." });
    }
    if (mediaType(request) !== "application/json") {
      throw new ApiError(415, { error: "unsupported_media_type", message: "Send the request body as application/json." });
    }
    try {
      return { kind: "json", value: JSON.parse(raw.toString("utf8")) as unknown };
    } catch {
      return { kind: "malformed" };
    }
  }
  if (kind === "multipart") {
    const raw = await readBody(request, UPLOAD_LIMIT);
    if (raw === null) throw fileTooLarge();
    const contentType = request.headers["content-type"] ?? "";
    if (mediaType(request) !== "multipart/form-data") {
      throw new ApiError(415, { error: "unsupported_media_type", message: "Send scans as multipart/form-data." });
    }
    const form = parseMultipart(raw, contentType);
    if (form?.file && form.file.data.length > FILE_LIMIT) throw fileTooLarge();
    return { kind: "multipart", form };
  }
  await readBody(request, JSON_LIMIT);
  return { kind: "none" };
}

function fileTooLarge(): ApiError {
  return new ApiError(413, { error: "file_too_large", message: "The file is larger than 20,000,000 bytes." });
}

function sendJson(response: ServerResponse, status: number, payload: unknown, cookie?: string): void {
  const text = JSON.stringify(payload);
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  response.writeHead(status, headers);
  response.end(text);
}

export async function handleApi(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  try {
    const method = request.method ?? "GET";
    let matched: { route: Route; params: Record<string, string> } | undefined;
    for (const candidate of routes) {
      const found = candidate.method === method ? candidate.pattern.exec(path) : null;
      if (found) {
        const params = Object.fromEntries(candidate.names.map((name, i) => [name, decodeURIComponent(found[i + 1] ?? "")]));
        matched = { route: candidate, params };
        break;
      }
    }
    if (!matched) {
      await readBody(request, JSON_LIMIT);
      throw notFound();
    }
    const body = await boundary(request, matched.route.body);
    const reply = await matched.route.handler({ method, path, params: matched.params, headers: request.headers, body });
    if (reply.bytes) {
      response.writeHead(reply.status, {
        "Content-Type": reply.bytes.contentType,
        "Content-Length": reply.bytes.data.length,
        "Content-Disposition": reply.bytes.disposition,
        "Cache-Control": "private, no-store",
      });
      response.end(reply.bytes.data);
    } else if (reply.json === undefined) {
      response.writeHead(reply.status, reply.cookie ? { "Set-Cookie": reply.cookie } : {});
      response.end();
    } else {
      sendJson(response, reply.status, reply.json, reply.cookie);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body);
    } else {
      console.error(error);
      sendJson(response, 500, { error: "internal", message: "Something went wrong on the server." });
    }
  }
}
