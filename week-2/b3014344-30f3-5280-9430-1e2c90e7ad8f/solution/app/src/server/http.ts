import type { IncomingMessage, ServerResponse } from "node:http";
import { COPY } from "../shared/copy";

/** Every error leaves the server as {"error","message"} plus "fields" for 422 and any extra keys. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}), ...this.extra };
  }
}

export const errors = {
  notFound: () => new HttpError(404, "not_found", COPY.notFound),
  unauthenticated: () => new HttpError(401, "unauthenticated", "Sign in to continue."),
  forbidden: () => new HttpError(403, "forbidden", "You don't have access to this."),
  accessEnded: () => new HttpError(403, "access_ended", COPY.accessEnded),
  invalidTransition: (state: string) =>
    new HttpError(409, "invalid_transition", `That move isn't allowed while this is ${state}.`),
  invalid: (fields: Record<string, string>) =>
    new HttpError(422, "validation_failed", "Some fields need attention.", fields),
  billing: () => new HttpError(503, "billing_unavailable", COPY.billingOutage),
  storage: (message: string = COPY.storageUpload) => new HttpError(503, "storage_unavailable", message),
  cms: () => new HttpError(503, "cms_unavailable", COPY.cmsOutage),
  database: () => new HttpError(503, "database_unavailable", "The ledger is unavailable right now. Try again in a moment."),
};

const JSON_LIMIT = 65_536;
const UPLOAD_REQUEST_LIMIT = 10_100_000;

export type BodyKind = "json" | "upload" | "none";

export interface Upload {
  name: string;
  declaredType: string;
  data: Buffer;
}

/** Reads the request body under its limit; refuses an oversized declared length before reading anything. */
async function readBody(req: IncomingMessage, limit: number, tooLarge: () => HttpError): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw tooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

export async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req, JSON_LIMIT, () => new HttpError(413, "payload_too_large", "That request is too large."));
  if (raw.length === 0) return {};
  if (mediaType(req) !== "application/json") throw unsupportedMedia();
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "malformed_json", "The request body is not valid JSON.");
  }
}

function unsupportedMedia(): HttpError {
  return new HttpError(415, "unsupported_media_type", "Send this request as JSON.");
}

/** Parses a multipart/form-data body and returns its `file` part. */
export async function parseUpload(req: IncomingMessage): Promise<Upload> {
  const tooLarge = () => new HttpError(413, "file_too_large", "That file is larger than 10 MB.");
  if (mediaType(req) !== "multipart/form-data") {
    await readBody(req, UPLOAD_REQUEST_LIMIT, tooLarge);
    throw unsupportedMedia();
  }
  const boundary = /boundary="?([^";]+)"?/i.exec(req.headers["content-type"] ?? "")?.[1];
  const raw = await readBody(req, UPLOAD_REQUEST_LIMIT, tooLarge);
  if (!boundary) throw errors.invalid({ file: "Attach one file." });
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = raw.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (raw.subarray(start, start + 2).toString() === "--") break;
    const next = raw.indexOf(delimiter, start);
    if (next === -1) break;
    const part = raw.subarray(start + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const headers = part.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
      const field = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename\*?="([^"]*)"/i.exec(disposition)?.[1];
      if (field === "file" && filename !== undefined) {
        const declaredType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "";
        return { name: filename, declaredType, data: Buffer.from(part.subarray(split + 4)) };
      }
    }
    cursor = next;
  }
  throw errors.invalid({ file: "Attach one file." });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (status === 204) {
    res.writeHead(204, headers).end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const index = pair.indexOf("=");
    if (index > 0) jar[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return jar;
}

/** A state-changing request whose Origin names another host is refused. */
export function crossOrigin(req: IncomingMessage): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "")) return false;
  const origin = req.headers.origin;
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

/** Pattern matching for routes like /api/orders/:id/pay. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]!;
    const actual = got[i]!;
    if (segment.startsWith(":")) {
      if (!actual) return null;
      try {
        params[segment.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (segment !== actual) return null;
  }
  return params;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A malformed id gets the same 404 as an unknown one. */
export function uuidOr404(value: string | undefined): string {
  if (!isUuid(value)) throw errors.notFound();
  return value.toLowerCase();
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
