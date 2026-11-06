// The one API error shape, JSON replies and request bodies with the brief's byte limits.
import type { IncomingMessage, ServerResponse } from "node:http";

const JSON_LIMIT = 100_000;
const ENVELOPE_ALLOWANCE = 100_000;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

/** Every refusal the API gives: a status, the body and optional headers. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Json,
    readonly headers: Record<string, string> = {},
  ) {
    super(`${status} ${JSON.stringify(body)}`);
  }
}

export const notFound = (): ApiError => new ApiError(404, { error: "not_found" });
export const forbidden = (): ApiError => new ApiError(403, { error: "forbidden" });
export const conflict = (error: string, extra: Record<string, Json> = {}): ApiError => new ApiError(409, { error, ...extra });
export const invalid = (errors: Record<string, string>): ApiError => new ApiError(422, { errors });
const tooLarge = (limitBytes: number): ApiError => new ApiError(413, { error: "too_large", limitBytes });
export const unavailable = (error: "billing_unavailable" | "storage_unavailable" | "mail_unavailable"): ApiError =>
  new ApiError(503, { error });

export interface Reply {
  status: number;
  body?: Json;
  headers?: Record<string, string>;
}

export function sendJson(res: ServerResponse, status: number, body: Json | undefined, headers: Record<string, string> = {}): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}

function declaredLength(req: IncomingMessage): number | null {
  const raw = req.headers["content-length"];
  return raw === undefined ? null : Number(raw);
}

/** Reads the raw body, refusing with 413 once it passes `limit` bytes. */
async function readRaw(req: IncomingMessage, limit: number, limitBytes: number): Promise<Buffer> {
  const declared = declaredLength(req);
  if (declared !== null && declared > limit) {
    req.resume();
    throw tooLarge(limitBytes);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw tooLarge(limitBytes);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/** A JSON body: 413 over 100,000 bytes, 415 for another content type, 400 when it does not parse. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(req, JSON_LIMIT, JSON_LIMIT);
  if (mediaType(req) !== "application/json") throw new ApiError(415, { error: "unsupported_media_type" });
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(400, { error: "invalid_json" });
  }
}

interface UploadedFile {
  fileName: string;
  contentType: string;
  data: Buffer;
}

/**
 * One file field of a multipart form. The file may be up to `fileLimit` bytes; the whole request up to
 * `fileLimit` + the envelope allowance. Returns null when the field is missing.
 */
export async function readUpload(req: IncomingMessage, field: string, fileLimit: number): Promise<UploadedFile | null> {
  const declared = declaredLength(req);
  if (declared !== null && declared > fileLimit + ENVELOPE_ALLOWANCE) {
    req.resume();
    throw tooLarge(fileLimit);
  }
  const header = req.headers["content-type"] ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(header);
  if (mediaType(req) !== "multipart/form-data" || !boundary) {
    req.resume();
    throw new ApiError(415, { error: "unsupported_media_type" });
  }
  const raw = await readRaw(req, fileLimit + ENVELOPE_ALLOWANCE, fileLimit);
  const file = multipartField(raw, boundary[1] ?? boundary[2], field);
  if (file && file.data.length > fileLimit) throw tooLarge(fileLimit);
  return file;
}

function multipartField(raw: Buffer, boundary: string, field: string): UploadedFile | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = raw.indexOf(delimiter);
  while (cursor !== -1) {
    const headerStart = cursor + delimiter.length;
    if (raw.subarray(headerStart, headerStart + 2).toString() === "--") return null;
    const headerEnd = raw.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) return null;
    const next = raw.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (next === -1) return null;
    const headers = raw.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    if (name === field) {
      return {
        fileName: /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? "",
        contentType: (/content-type:\s*([^\r\n]*)/i.exec(headers)?.[1] ?? "").trim(),
        data: raw.subarray(headerEnd + 4, next),
      };
    }
    cursor = next + 2;
  }
  return null;
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}
