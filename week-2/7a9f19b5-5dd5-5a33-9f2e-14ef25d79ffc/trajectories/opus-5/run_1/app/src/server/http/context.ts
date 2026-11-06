import type { IncomingMessage, ServerResponse } from "node:http";
import { LIMITS } from "../../shared/domain.js";
import type { User } from "../../shared/types.js";
import { ApiError, invalidJson, payloadTooLarge, unsupportedMediaType } from "./errors.js";

/** Multipart bodies carry an envelope on top of the file, so the raw cap has slack. */
const MULTIPART_ENVELOPE_SLACK_BYTES = 64 * 1024;

export interface Ctx {
  readonly method: string;
  readonly url: URL;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: IncomingMessage["headers"];
  readonly body: Buffer;
  readonly contentType: string;
  /** The JSON body the pipeline parsed, or `{}` when the endpoint takes none. */
  readonly parsedBody: unknown;
  /** The signed-in caller, or null. */
  user: User | null;
  readonly res: ServerResponse;
}

export function isMultipart(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("multipart/form-data");
}

function contentTypeOf(req: IncomingMessage): string {
  const raw = req.headers["content-type"];
  return typeof raw === "string" ? raw : "";
}

/**
 * Reads the request body, refusing anything past the published limits. JSON
 * bodies may be up to 100,000 bytes; a cover image file up to 5,000,000.
 */
export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const contentType = contentTypeOf(req);
  const cap = isMultipart(contentType)
    ? LIMITS.coverImageBytes + MULTIPART_ENVELOPE_SLACK_BYTES
    : LIMITS.jsonBodyBytes;

  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > cap) throw payloadTooLarge();

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > cap) throw payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Framing checks for a JSON endpoint, run by the pipeline before the origin check
 * so that 415 and `invalid_json` keep their place in the error precedence.
 */
export function parseJsonBody(body: Buffer, contentType: string): unknown {
  if (body.length === 0) return {};
  if (!contentType.toLowerCase().startsWith("application/json")) throw unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw invalidJson();
  }
  if (parsed === null || typeof parsed !== "object") throw invalidJson();
  return parsed;
}

/** The body the pipeline already parsed and framed for this request. */
export function readJson<T>(ctx: Ctx): T {
  return ctx.parsedBody as T;
}

export function makeCtx(args: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: Buffer;
  parsedBody: unknown;
  params: Record<string, string>;
}): Ctx {
  return {
    method: (args.req.method ?? "GET").toUpperCase(),
    url: args.url,
    path: args.url.pathname,
    params: args.params,
    query: args.url.searchParams,
    headers: args.req.headers,
    body: args.body,
    contentType: contentTypeOf(args.req),
    parsedBody: args.parsedBody,
    user: null,
    res: args.res,
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse, extraHeaders?: Record<string, string>): void {
  res.writeHead(204, { "cache-control": "no-store", ...extraHeaders });
  res.end();
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body());
}
