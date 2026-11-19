import type { IncomingMessage, ServerResponse } from "node:http";
import { JSON_LIMIT_BYTES } from "./config";

/** Every error leaves the API through these two builders. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "validation");
  }
}

const DRAIN_FACTOR = 64;

export const fail = {
  signIn: () => new ApiError(401, { error: "Please sign in." }),
  credentials: () => new ApiError(401, { error: "That email or password is not right." }),
  notFound: () => new ApiError(404, { error: "Not found." }),
  conflict: (error: string, extra: Record<string, unknown> = {}) => new ApiError(409, { error, ...extra }),
  invalid: (errors: Record<string, string>) => new ApiError(422, { errors }),
  unavailable: (error: string) => new ApiError(503, { error }),
  tooLarge: (error: string) => new ApiError(413, { error }),
  notJson: () => new ApiError(415, { error: "Send JSON." }),
  other: (status: number, error: string) => new ApiError(status, { error }),
};

export interface Reply {
  status: number;
  handled?: boolean;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export const ok = (json: unknown, status = 200): Reply => ({ status, json });

export function send(res: ServerResponse, reply: Reply): void {
  if (reply.handled) return;
  const headers: Record<string, string | number> = { ...reply.headers, "Cache-Control": "no-store" };
  if (reply.bytes) {
    headers["Content-Type"] = reply.contentType ?? "application/octet-stream";
    headers["Content-Length"] = reply.bytes.length;
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  if (reply.json === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.json));
  headers["Content-Type"] = "application/json; charset=utf-8";
  headers["Content-Length"] = payload.length;
  res.writeHead(reply.status, headers);
  res.end(payload);
}

/** Reads a body, keeping at most `limit` bytes. A longer one is read to its end and thrown away, so the connection stays usable. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too-large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) chunks.length = 0;
    else chunks.push(chunk);
    if (size > limit * DRAIN_FACTOR) {
      req.destroy();
      break;
    }
  }
  return size > limit ? "too-large" : Buffer.concat(chunks);
}

/** A path segment decoded, or not found when its escapes are broken. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw fail.notFound();
  }
}

export const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON body of a request, or an empty object when none was sent. */
export async function jsonBody(req: IncomingMessage): Promise<JsonObject> {
  const length = req.headers["content-length"];
  const chunked = req.headers["transfer-encoding"] !== undefined;
  const type = req.headers["content-type"] ?? "";
  if ((length === undefined || length === "0") && !chunked) return {};
  if (!/^application\/json\b/i.test(type)) throw fail.notJson();
  const body = await readBody(req, JSON_LIMIT_BYTES);
  if (body === "too-large") throw fail.tooLarge("That request is too large.");
  const source = body.toString("utf8");
  if (/\\u0000|\u0000/i.test(source)) throw fail.other(400, "Send valid JSON.");
  try {
    const parsed: unknown = JSON.parse(source);
    return isObject(parsed) ? parsed : {};
  } catch {
    throw fail.other(400, "Send valid JSON.");
  }
}

export function stringField(body: JsonObject, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value.trim() : "";
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const found: Record<string, string> = {};
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0) found[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return found;
}
