import type { IncomingMessage, ServerResponse } from "node:http";

/** Every error response in the API is one of these, written by `sendError`. */
export class HttpError extends Error {
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

export function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): never {
  throw new HttpError(status, code, message, extra, headers);
}

export type FieldErrors = Record<string, string>;

export function invalid(errors: FieldErrors): never {
  fail(422, "validation", "Some fields need attention.", { errors });
}

export function notFound(): never {
  fail(404, "not_found", "Nothing is here.");
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
  });
  res.end(payload);
}

/** The API's one error shape: {"error","message", ...extra}. */
export function errorBody(error: HttpError): Record<string, unknown> {
  return { error: error.code, message: error.message, ...error.extra };
}

export function sendError(res: ServerResponse, error: HttpError): void {
  sendJson(res, error.status, errorBody(error), error.headers);
}

export function sendBytes(
  res: ServerResponse,
  contentType: string,
  bytes: Buffer,
  headers: Record<string, string> = {},
): void {
  res.writeHead(200, { ...headers, "Content-Type": contentType, "Content-Length": String(bytes.length) });
  res.end(bytes);
}

/**
 * Reads the whole body. A body over `limit` is drained and refused with 413 before anything parses it,
 * so the client always receives the answer.
 */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number.parseInt(req.headers["content-length"] ?? "", 10);
  const chunks: Buffer[] = [];
  let total = 0;
  let over = Number.isSafeInteger(declared) && declared > limit;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > limit) over = true;
    if (!over) chunks.push(chunk);
  }
  if (over) fail(413, "payload_too_large", "The request body is larger than this endpoint accepts.");
  return Buffer.concat(chunks, total);
}

export function parseJson(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    fail(400, "malformed_json", "The request body is not valid JSON.");
  }
}

interface UploadedFile {
  filename: string;
  data: Buffer;
}

export interface Multipart {
  fields: Map<string, string>;
  files: Map<string, UploadedFile>;
}

const DISPOSITION = /^form-data(?:;\s*|$)/i;

/** Parses a multipart/form-data body held in memory. Returns null when the body is not multipart. */
export function parseMultipart(contentType: string | undefined, raw: Buffer): Multipart | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!/^multipart\/form-data/i.test(contentType ?? "") || !boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2] ?? ""}`);
  const result: Multipart = { fields: new Map(), files: new Map() };
  let cursor = raw.indexOf(delimiter);
  if (cursor < 0) return null;
  while (cursor >= 0) {
    const start = cursor + delimiter.length;
    if (raw.subarray(start, start + 2).toString() === "--") break;
    const next = raw.indexOf(delimiter, start);
    if (next < 0) return null;
    const part = raw.subarray(start + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) return null;
    const headerText = part.subarray(0, split).toString("utf8");
    const body = part.subarray(split + 4);
    const disposition = /content-disposition:\s*([^\r\n]+)/i.exec(headerText)?.[1] ?? "";
    if (!DISPOSITION.test(disposition)) return null;
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    if (name !== undefined) {
      if (filename !== undefined) result.files.set(name, { filename, data: Buffer.from(body) });
      else result.fields.set(name, body.toString("utf8"));
    }
    cursor = next;
  }
  return result;
}

export function clientIp(req: IncomingMessage): string {
  const address = req.socket.remoteAddress ?? "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function cookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const piece of (req.headers.cookie ?? "").split(";")) {
    const index = piece.indexOf("=");
    if (index > 0) jar.set(piece.slice(0, index).trim(), piece.slice(index + 1).trim());
  }
  return jar;
}
