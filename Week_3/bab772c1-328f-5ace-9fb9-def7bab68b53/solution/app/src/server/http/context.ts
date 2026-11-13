/** The request context: body limits, JSON parsing and every answer the app sends. */

import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, bodyTooLarge, errorBody, invalidJson, unsupportedMediaType } from "../errors.js";
import { parseIJson } from "../../shared/ijson.js";
import type { JsonValue } from "../../shared/canonical.js";

const JSON_BODY_LIMIT = 16_384;

export type Context = {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  path: string;
  segments: string[];
  query: URLSearchParams;
  url: URL;
  /** Headers every answer on this request carries, such as the share rate-limit fields. */
  extraHeaders: Record<string, string>;
};

export function makeContext(request: IncomingMessage, response: ServerResponse): Context {
  const host = request.headers.host ?? "localhost";
  let url: URL;
  try { url = new URL(request.url ?? "/", `http://${host}`); }
  catch { url = new URL("/%", "http://localhost"); }
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* unknown encoded path */ }
  return {
    request,
    response,
    method: (request.method ?? "GET").toUpperCase(),
    path,
    segments: path.split("/").filter((segment) => segment.length > 0),
    query: url.searchParams,
    url,
    extraHeaders: {},
  };
}

export function header(context: Context, name: string): string | null {
  const value = context.request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function contentType(context: Context): string | null {
  const value = header(context, "content-type");
  return value === null ? null : value.split(";")[0].trim().toLowerCase();
}

export function sendJson(
  context: Context,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  context.response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    ...context.extraHeaders,
    ...headers,
  });
  if (context.method === "HEAD") {
    context.response.end();
    return;
  }
  context.response.end(payload);
}

export function sendError(context: Context, error: ApiError): void {
  const headers = { ...error.headers };
  if (isShareRoute(context)) {
    headers["cache-control"] = "no-store";
  }
  sendJson(context, error.status, errorBody(error), headers);
}

export function isShareRoute(context: Context): boolean {
  return (
    context.path.startsWith("/s/") ||
    context.path === "/s" ||
    context.path.startsWith("/api/share/")
  );
}

export function sendHtml(
  context: Context,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(html, "utf8");
  context.response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": payload.length,
    ...context.extraHeaders,
    ...headers,
  });
  if (context.method === "HEAD") {
    context.response.end();
    return;
  }
  context.response.end(payload);
}

/** Reads the body, discarding anything over the limit so the answer still reaches the client. */
export async function readBody(context: Context, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  for await (const chunk of context.request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      exceeded = true;
      // The unread rest of this body must not be taken for the client's next request.
      context.response.setHeader("Connection", "close");
      if (total > limit * 20) {
        break;
      }
      continue;
    }
    chunks.push(buffer);
  }
  if (exceeded) {
    throw bodyTooLarge(limit);
  }
  return Buffer.concat(chunks);
}

/** Reads an I-JSON body of the given content type; an empty body is allowed only when said. */
export async function readJsonBody(
  context: Context,
  accepted: readonly string[],
  options: { allowEmpty?: boolean } = {},
): Promise<JsonValue | undefined> {
  const body = await readBody(context, JSON_BODY_LIMIT);
  if (body.length === 0 && options.allowEmpty === true) {
    return undefined;
  }
  const type = contentType(context);
  if (type === null || !accepted.includes(type)) {
    throw unsupportedMediaType();
  }
  try {
    return parseIJson(body.toString("utf8"));
  } catch {
    throw invalidJson();
  }
}
