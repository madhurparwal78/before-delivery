// Request bodies: size limits and content types (precedence step 2), JSON and multipart parsing.
import type { IncomingMessage } from "node:http";
import { attachmentKind, displayFilename, MAX_ATTACHMENT_BYTES, type AttachmentKind } from "../domain/attachmentRules.js";
import { ApiError, invalid } from "./errors.js";
import { asObject, type JsonObject } from "./validate.js";

const MAX_JSON_BYTES = 1_000_000;
const MULTIPART_OVERHEAD = 64 * 1024;

export type BodyKind = "json" | "multipart" | "none";

export interface Upload {
  filename: string;
  kind: AttachmentKind;
  bytes: Buffer;
}

export interface ParsedBody {
  json: JsonObject;
  upload: Upload | null;
}

const tooLarge = (): ApiError => new ApiError(413, "payload_too_large", "The request body is too large.");
const unsupported = (message: string): ApiError => new ApiError(415, "unsupported_media_type", message);

/** Reads the whole body, keeping at most `limit` bytes; always drains the stream so the reply reaches the client. */
async function readCapped(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) over = true;
    else chunks.push(chunk);
  }
  return over ? null : Buffer.concat(chunks);
}

function hasBody(req: IncomingMessage): boolean {
  const length = Number(req.headers["content-length"] ?? "0");
  return length > 0 || req.headers["transfer-encoding"] !== undefined;
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function readBody(req: IncomingMessage, kind: BodyKind): Promise<ParsedBody> {
  if (kind === "none" || !hasBody(req)) {
    await readCapped(req, 0);
    return { json: {}, upload: null };
  }
  if (kind === "multipart") {
    const boundary = /boundary="?([^";]+)"?/i.exec(req.headers["content-type"] ?? "")?.[1];
    if (mediaType(req) !== "multipart/form-data" || !boundary) {
      await readCapped(req, 0);
      throw unsupported("Send the file as multipart/form-data.");
    }
    const raw = await readCapped(req, MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD);
    if (raw === null) throw tooLarge();
    return { json: {}, upload: parseUpload(raw, boundary) };
  }
  if (mediaType(req) !== "application/json") {
    await readCapped(req, 0);
    throw unsupported("Send the request body as application/json.");
  }
  const raw = await readCapped(req, MAX_JSON_BYTES);
  if (raw === null) throw tooLarge();
  if (raw.length === 0) return { json: {}, upload: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalid({ request: "Send a JSON object." });
  }
  const json = asObject(parsed);
  if (json === null) throw invalid({ request: "Send a JSON object." });
  return { json, upload: null };
}

// HTML form encoding escapes quotes, CR and LF in a part's filename; undo it.
function unescapeFormName(value: string): string {
  return value.replace(/%22/g, '"').replace(/%0D/gi, "\r").replace(/%0A/gi, "\n").replace(/\\\\/g, "\\");
}

function decodeExtended(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalid({ file: "The file name could not be read." });
  }
}

function parseUpload(raw: Buffer, boundary: string): Upload | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let position = raw.indexOf(delimiter);
  while (position >= 0) {
    const start = position + delimiter.length + 2;
    const next = raw.indexOf(delimiter, start);
    if (next < 0) break;
    const part = raw.subarray(start, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const headers = part.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
      if (/\bname="file"/i.test(disposition)) {
        const quoted = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
        const extended = /\bfilename\*=UTF-8''([^;\s]+)/i.exec(disposition)?.[1];
        const clientName = extended !== undefined ? decodeExtended(extended) : unescapeFormName(quoted ?? "");
        const filename = displayFilename(clientName);
        const kind = attachmentKind(filename);
        if (kind === null) throw unsupported("Attach a .txt, .vtt, .pdf, .png or .jpg file.");
        const bytes = Buffer.from(part.subarray(split + 4));
        if (bytes.length > MAX_ATTACHMENT_BYTES) throw tooLarge();
        return { filename, kind, bytes };
      }
    }
    position = next;
  }
  return null;
}
