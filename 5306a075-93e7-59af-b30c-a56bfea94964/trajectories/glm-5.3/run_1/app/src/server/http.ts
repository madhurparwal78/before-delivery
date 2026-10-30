import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, errors } from "./errors.js";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const MAX_JSON_BYTES = 1_000_000;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  /** Path segments after /api. */
  segments: string[];
  query: URLSearchParams;
  body: unknown;
  rawBody: Buffer | null;
}

export interface ParsedMultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  bytes: Buffer;
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": JSON_CONTENT_TYPE,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, err.body());
}

/** Read the whole request body with a size cap. */
export async function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string);
    size += buf.length;
    if (size > limit) {
      tooLarge = true;
      req.resume();
      break;
    }
    chunks.push(buf);
  }
  return { bytes: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge };
}

/**
 * Parse a JSON body for a write request. A write with a body that is not
 * JSON gets 415; a write with no body is read as an empty object.
 */
export function parseJsonBody(
  method: string,
  bytes: Buffer,
  hasBody: boolean,
  contentType: string | null,
): unknown {
  if (!hasBody || bytes.length === 0) return {};
  const isJson =
    contentType !== null &&
    contentType.toLowerCase().split(";")[0]?.trim() === "application/json";
  if (!isJson) throw errors.unsupportedMediaType();
  const text = bytes.toString("utf-8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw errors.validationFailed({});
  }
}

/** Parse multipart/form-data into parts. */
export function parseMultipart(
  bytes: Buffer,
  contentType: string,
): ParsedMultipartPart[] {
  const match = /^multipart\/form-data\s*;\s*boundary=(.*)$/i.exec(contentType.trim());
  if (match === null) throw errors.unsupportedMediaType();
  let boundary = match[1]!.trim();
  if (boundary.startsWith('"') && boundary.endsWith('"')) boundary = boundary.slice(1, -1);
  const delimiter = `--${boundary}`;
  const parts: ParsedMultipartPart[] = [];
  const text = bytes;
  const delimBuf = Buffer.from(delimiter);
  let positions: number[] = [];
  let idx = 0;
  while (true) {
    const found = text.indexOf(delimBuf, idx);
    if (found === -1) break;
    positions.push(found);
    idx = found + delimBuf.length;
  }
  for (let i = 0; i + 1 < positions.length; i++) {
    const start = positions[i]! + delimBuf.length;
    const end = positions[i + 1]!;
    let seg = text.subarray(start, end);
    // Strip the leading CRLF after the boundary and the trailing CRLF before
    // the next boundary.
    if (seg.subarray(0, 2).toString("latin1") === "\r\n") seg = seg.subarray(2);
    else if (seg.subarray(0, 1).toString("latin1") === "\n") seg = seg.subarray(1);
    if (seg.subarray(seg.length - 2).toString("latin1") === "\r\n") {
      seg = seg.subarray(0, seg.length - 2);
    }
    const headerEnd = seg.indexOf("\r\n\r\n");
    const headerBlock =
      headerEnd === -1 ? seg.toString("utf-8") : seg.subarray(0, headerEnd).toString("utf-8");
    const content =
      headerEnd === -1 ? Buffer.alloc(0) : seg.subarray(headerEnd + 4);
    let name = "";
    let filename: string | null = null;
    let partType: string | null = null;
    for (const line of headerBlock.split("\r\n")) {
      const lower = line.toLowerCase();
      if (lower.startsWith("content-disposition:")) {
        const nameMatch = /name="((?:[^"\\]|\\.)*)"/.exec(line);
        if (nameMatch !== null) {
          name = nameMatch[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        }
        const fileMatch = /filename="((?:[^"\\]|\\.)*)"/.exec(line);
        if (fileMatch !== null) {
          filename = fileMatch[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        }
      } else if (lower.startsWith("content-type:")) {
        partType = line.slice(line.indexOf(":") + 1).trim();
      }
    }
    parts.push({ name, filename, contentType: partType, bytes: content });
  }
  return parts;
}
