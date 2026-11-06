import type { IncomingMessage, ServerResponse } from "node:http";

export const JSON_LIMIT = 65_536;
export const REQUEST_LIMIT = 10_100_000;
const FILE_LIMIT = 10_000_000;
const DRAIN_LIMIT = 64_000_000;

/** The one error shape: {"error","message"} plus optional errors, missing or waitlist. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function validation(errors: Record<string, string>): ApiError {
  return new ApiError(422, "validation", "Some fields need attention.", { errors });
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "Nothing was found at this address.");
}

export function conflict(code: string, message: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, code, message, extra);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = status === 204 ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...(status === 204 ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, { error: error.code, message: error.message, ...error.extra });
}

/** Reads the whole body; a body over `limit` is drained and answered 413 payload_too_large. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > DRAIN_LIMIT) {
      req.destroy();
      break;
    }
    if (total <= limit) chunks.push(chunk);
  }
  if (total > limit || declared > limit) throw new ApiError(413, "payload_too_large", "The request body is too large.");
  return Buffer.concat(chunks);
}

export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function parseJson(req: IncomingMessage, raw: Buffer): unknown {
  if (raw.length === 0) return {};
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(400, "malformed_json", "The request body is not valid JSON.");
  }
}

interface UploadedFile {
  bytes: Buffer;
  tooLarge: boolean;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedFile[];
}

/** Splits a buffered multipart/form-data body into its text fields and file parts. */
export function parseMultipart(req: IncomingMessage, raw: Buffer): MultipartBody {
  const type = req.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw new ApiError(415, "unsupported_media_type", "Send the upload as multipart/form-data.");
  }
  const unreadable = new ApiError(400, "malformed_json", "The upload could not be read.");
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type);
  if (!boundary) throw unreadable;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  let at = raw.indexOf(delimiter);
  if (at < 0) throw unreadable;
  for (;;) {
    at += delimiter.length;
    if (raw.subarray(at, at + 2).toString("latin1") === "--") break;
    const headerEnd = raw.indexOf("\r\n\r\n", at);
    const next = raw.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), at);
    if (headerEnd < 0 || next < 0 || headerEnd > next) throw unreadable;
    const headers = raw.subarray(at, headerEnd).toString("utf8");
    const body = raw.subarray(headerEnd + 4, next);
    const disposition = /^content-disposition:[^\r\n]*/im.exec(headers)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) throw unreadable;
    if (/\bfilename\*?=/i.test(disposition)) {
      files.push({ bytes: Buffer.from(body), tooLarge: body.length > FILE_LIMIT });
    } else {
      fields[name] = body.toString("utf8");
    }
    at = next + 2;
  }
  return { fields, files };
}

type FileKind = { ext: "pdf" | "jpg" | "png"; contentType: string };

/** File type from the leading bytes only; extension and declared type are ignored. */
export function sniff(bytes: Buffer): FileKind | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", contentType: "application/pdf" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", contentType: "image/png" };
  }
  return null;
}
