// The router and the error-precedence ladder (brief: API → Error-precedence ladder). Steps 1 and 2 are decided
// here before any handler runs; a handler then walks steps 3 to 13 in order by calling, in this order,
// `rateLimit` (3), `ctx.staff()` (4), its record lookups (5), `requireRole` (6) and `ctx.json()` /
// `ctx.multipart()` (7 to 9), so the body is only judged after everything ranked above it.
import type { IncomingMessage, ServerResponse } from "node:http";
import { COPY, validationAnnouncement } from "../shared/copy";
import { config } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", validationAnnouncement(Object.keys(fields).length), { fields });
}

export const notFound = (): ApiError => new ApiError(404, "not_found", COPY.notFound);

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

export interface Reply {
  status: number;
  body?: Json;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export const reply = (status: number, body?: Json, headers?: Record<string, string>): Reply => ({ status, body, headers });

interface FilePart {
  filename: string;
  contentType: string;
  data: Buffer;
}

type BodyKind = "none" | "json" | "multipart";

const JSON_LIMIT = 256_000;
const ENVELOPE = 100_000;

export class Ctx {
  constructor(
    readonly req: IncomingMessage,
    readonly url: URL,
    readonly params: Record<string, string>,
    readonly raw: Buffer,
    readonly received: number,
    private readonly fileLimit: number,
    private readonly tooLargeMessage: string,
  ) {}

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  /** The first X-Forwarded-For entry, trimmed, else the socket address. */
  clientAddress(): string {
    const forwarded = this.header("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || this.req.socket.remoteAddress || "unknown";
  }

  private mediaType(): string {
    return (this.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  }

  /** Steps 7 to 9 for a JSON body. An empty body is an empty object and needs no content type. */
  json(): Record<string, unknown> {
    if (this.received > JSON_LIMIT) throw new ApiError(413, "too_large", this.tooLargeMessage);
    if (this.received === 0) return {};
    if (this.mediaType() !== "application/json") throw new ApiError(415, "unsupported_media_type", COPY.unsupportedMediaType);
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.raw.toString("utf8"));
    } catch {
      throw new ApiError(400, "invalid_json", COPY.invalidJson);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(400, "invalid_json", COPY.invalidJson);
    return parsed as Record<string, unknown>;
  }

  /** Steps 7 and 8 for a multipart upload: the file part and the text parts. */
  multipart(wrongType: string): { file: FilePart | null; fields: Record<string, string> } {
    if (this.received > this.fileLimit + ENVELOPE) throw new ApiError(413, "too_large", this.tooLargeMessage);
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(this.header("content-type") ?? "");
    if (this.mediaType() !== "multipart/form-data" || !boundary) throw new ApiError(415, "unsupported_media_type", wrongType);
    const parts = splitMultipart(this.raw, boundary[1] ?? boundary[2].trim());
    if (!parts) throw new ApiError(415, "unsupported_media_type", wrongType);
    let file: FilePart | null = null;
    const fields: Record<string, string> = {};
    for (const part of parts) {
      if (part.name === "file" && part.filename !== null) file = { filename: part.filename, contentType: part.contentType, data: part.data };
      else if (part.name) fields[part.name] = part.data.toString("utf8");
    }
    if (file && file.data.length > this.fileLimit) throw new ApiError(413, "too_large", this.tooLargeMessage);
    return { file, fields };
  }
}

interface Part {
  name: string;
  filename: string | null;
  contentType: string;
  data: Buffer;
}

function splitMultipart(body: Buffer, boundary: string): Part[] | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let start = body.indexOf(delimiter);
  if (start < 0) return null;
  while (true) {
    start += delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") return parts;
    start += 2;
    const next = body.indexOf(delimiter, start);
    if (next < 0) return null;
    const chunk = body.subarray(start, next - 2);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd < 0) return null;
    const head = chunk.subarray(0, headerEnd).toString("utf8");
    const disposition = /content-disposition:([^\r\n]*)/i.exec(head)?.[1] ?? "";
    parts.push({
      name: /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? "",
      filename: /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null,
      contentType: /content-type:\s*([^\r\n]*)/i.exec(head)?.[1]?.trim() ?? "",
      data: chunk.subarray(headerEnd + 4),
    });
    start = next;
  }
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  body: BodyKind;
  fileLimit: number;
  tooLarge: string;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const routes: Route[] = [];

interface RouteOptions {
  fileLimit?: number;
  tooLarge?: string;
}

export function route(method: string, path: string, body: BodyKind, handler: (ctx: Ctx) => Promise<Reply>, options: RouteOptions = {}): void {
  const keys: string[] = [];
  const source = path.replace(/[.]/g, "\\.").replace(/\{(\w+)\}/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({
    method,
    pattern: new RegExp(`^${source}$`),
    keys,
    body,
    fileLimit: options.fileLimit ?? 0,
    tooLarge: options.tooLarge ?? COPY.tooLarge,
    handler,
  });
}

function matches(pathname: string): Route[] {
  return routes.filter((r) => r.pattern.test(pathname));
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Step 2: a write whose Origin names neither APP_PUBLIC_URL's origin nor its scheme with this request's Host. */
function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!WRITES.has(req.method ?? "") || !origin) return false;
  const own = new URL(config.publicUrl);
  return origin !== own.origin && origin !== `${own.protocol}//${req.headers.host ?? ""}`;
}

export function send(res: ServerResponse, result: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...result.headers };
  if (result.bytes) {
    res.writeHead(result.status, { "Content-Type": result.contentType ?? "application/octet-stream", "Content-Length": String(result.bytes.length), ...headers });
    res.end(result.bytes);
    return;
  }
  if (result.body === undefined) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  const text = Buffer.from(JSON.stringify(result.body));
  res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(text.length), ...headers });
  res.end(text);
}

export function errorReply(error: ApiError): Reply {
  return { status: error.status, body: { error: { code: error.code, message: error.message, ...(error.extra as Record<string, Json>) } }, headers: error.headers };
}

async function readBody(req: IncomingMessage, cap: number): Promise<{ raw: Buffer; received: number }> {
  const chunks: Buffer[] = [];
  let kept = 0;
  let received = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    received += piece.length;
    if (kept + piece.length <= cap) {
      chunks.push(piece);
      kept += piece.length;
    }
  }
  return { raw: Buffer.concat(chunks), received };
}

/** A decoded path segment; a malformed escape or a control character (NUL included) matches no record, so 404. */
function pathParam(segment: string): string {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    throw notFound();
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) throw notFound();
  return value;
}

/** Dispatches an /api path or the sitemap through steps 1 and 2 and into its handler. */
export async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const candidates = matches(url.pathname);
  const found = candidates.find((r) => r.method === method || (method === "HEAD" && r.method === "GET"));
  try {
    if (!candidates.length) throw notFound();
    if (!found) {
      const allow = [...new Set(candidates.map((r) => r.method))].join(", ");
      throw new ApiError(405, "method_not_allowed", COPY.methodNotAllowed, {}, { Allow: allow });
    }
    if (crossOrigin(req)) throw new ApiError(403, "cross_origin", COPY.crossOrigin);
    const params: Record<string, string> = {};
    const m = found.pattern.exec(url.pathname);
    found.keys.forEach((key, i) => {
      params[key] = pathParam(m?.[i + 1] ?? "");
    });
    const cap = found.body === "multipart" ? found.fileLimit + ENVELOPE + 1 : JSON_LIMIT + 1;
    const { raw, received } = await readBody(req, cap);
    const ctx = new Ctx(req, url, params, raw, received, found.fileLimit, found.tooLarge);
    send(res, await found.handler(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      req.resume();
      send(res, errorReply(error));
      return;
    }
    console.error(error);
    send(res, errorReply(new ApiError(500, "internal_error", COPY.unreachable)));
  }
}
