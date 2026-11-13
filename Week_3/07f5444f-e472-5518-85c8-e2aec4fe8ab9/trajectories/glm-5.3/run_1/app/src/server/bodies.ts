// Request bodies: limits, content types, JSON and multipart parsing.

import type { Request } from "express";
import { ApiError, validation } from "./errors.js";

export const JSON_LIMIT = 65536;
export const FILE_LIMIT = 20000000;
export const MULTIPART_LIMIT = 20100000;

export function readBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(new ApiError(413, "body_too_large", "The request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", () => {
      if (!settled) {
        settled = true;
        reject(new ApiError(400, "bad_request", "The request body could not be read."));
      }
    });
  });
}

/** A JSON body from the raw bytes, with the 415 and 422 of the boundary. */
export function requireJson(req: Request, raw: Buffer): Record<string, unknown> {
  const type = (req.header("Content-Type") ?? "").split(";")[0].trim();
  if (type !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
  }
  if (raw.length > JSON_LIMIT) {
    throw new ApiError(413, "body_too_large", "The JSON body is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw validation({ body: "The request body is not valid JSON." });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validation({ body: "The request body must be a JSON object." });
  }
  return parsed as Record<string, unknown>;
}

export interface ParsedFile {
  fileName: string;
  bytes: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  file: ParsedFile | null;
}

/** A small multipart/form-data reader that keeps the file's bytes exactly. */
export function parseMultipart(raw: Buffer, contentType: string): ParsedMultipart {
  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!match) throw new ApiError(400, "bad_request", "The multipart body has no boundary.");
  const boundary = Buffer.from(`--${match[1]}`);
  const fields: Record<string, string> = {};
  let file: ParsedFile | null = null;

  let start = raw.indexOf(boundary);
  while (start !== -1) {
    const next = raw.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const afterBoundary = start + boundary.length;
    if (raw[afterBoundary] === 0x2d && raw[afterBoundary + 1] === 0x2d) break;
    const headersEnd = raw.indexOf("\r\n\r\n", afterBoundary);
    if (headersEnd === -1 || headersEnd > next) break;
    const headerText = raw.slice(afterBoundary, headersEnd).toString("utf8");
    const content = raw.slice(headersEnd + 4, next);
    const trimmed = content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a
      ? content.slice(0, content.length - 2)
      : content;

    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText);
    if (disposition) {
      const nameMatch = /name="([^"]*)"/.exec(disposition[1]);
      const fileMatch = /filename="([^"]*)"/.exec(disposition[1]);
      const name = nameMatch ? nameMatch[1] : "";
      if (fileMatch) {
        file = { fileName: fileMatch[1], bytes: trimmed };
      } else if (name) {
        fields[name] = trimmed.toString("utf8");
      }
    }
    start = next;
  }
  return { fields, file };
}

/** The browser's filename decoding: exactly %22, %0D and %0A, either case. */
export function decodeFileName(raw: string): string {
  return raw.replace(/%22|%0d|%0a/gi, (token) => {
    switch (token.toLowerCase()) {
      case "%22": return '"';
      case "%0d": return "\r";
      case "%0a": return "\n";
      default: return token;
    }
  });
}

const TYPES: { contentType: string; signature: Buffer }[] = [
  { contentType: "application/pdf", signature: Buffer.from("%PDF-") },
  { contentType: "image/png", signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { contentType: "image/jpeg", signature: Buffer.from([0xff, 0xd8, 0xff]) },
];

/** The stored type, from the file's declared type and its bytes. */
export function sniffType(file: ParsedFile & { declaredType?: string }): string | null {
  for (const type of TYPES) {
    if (file.bytes.subarray(0, type.signature.length).equals(type.signature)) {
      return type.contentType;
    }
  }
  void file.declaredType;
  return null;
}

/** Content-Disposition built from the stored name, per the API rule. */
export function contentDisposition(fileName: string): string {
  const fallback = Array.from(fileName)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code <= 0x7e && ch !== '"' && ch !== "\\" ? ch : "_";
    })
    .join("");
  let encoded = "";
  for (const byte of Buffer.from(fileName, "utf8")) {
    const ch = String.fromCharCode(byte);
    encoded += /[A-Za-z0-9!#$&+.^_`|~-]/.test(ch) ? ch : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
