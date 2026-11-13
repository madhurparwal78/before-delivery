import type { Request } from "express";
import { ApiError } from "./errors.js";

const FILE_LIMITS: Record<string, { limit: number; message: string }> = {
  file: { limit: 1_000_000, message: "The results file must be at most 1,000,000 bytes." },
  report: { limit: 10_000_000, message: "The report must be at most 10,000,000 bytes." },
  attachment: { limit: 5_000_000, message: "Attachments must be at most 5,000,000 bytes." },
};

export type ParsedParts = Record<string, string | Buffer | undefined>;

/**
 * Multipart parser with per-file limits enforced as the part streams.
 * A part over its own limit answers 413 before anything else is checked.
 */
export async function parseMultipart(req: Request, bodyLimit: number): Promise<void> {
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new ApiError(400, "bad_request", "That request could not be read.");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  let oversized = false;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > bodyLimit) {
        oversized = true;
        req.removeAllListeners("data");
        resolve();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("error", () => reject(new ApiError(400, "bad_request", "That request could not be read.")));
  });
  if (oversized) {
    throw new ApiError(413, "too_large", "That request is too large.");
  }
  const body = Buffer.concat(chunks);
  const parts = splitParts(body, boundary);
  const parsed: ParsedParts = {};
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString("latin1");
    const content = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const name = nameMatch?.[1] ?? "";
    if (!name) continue;
    const limit = FILE_LIMITS[name];
    if (limit && content.length > limit.limit) {
      throw new ApiError(413, "too_large", limit.message);
    }
    const isFile = /filename=/i.test(headerText);
    if (isFile || limit) {
      parsed[name] = content;
    } else {
      parsed[name] = content.toString("utf8");
    }
  }
  (req as Request & { parsedParts?: ParsedParts }).parsedParts = parsed;
}

function splitParts(body: Buffer, boundary: string): Buffer[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    let chunk = body.subarray(start + delimiter.length, next);
    if (chunk.subarray(0, 2).toString("latin1") === "\r\n") {
      chunk = chunk.subarray(2);
    }
    if (chunk.subarray(chunk.length - 2).toString("latin1") === "\r\n") {
      chunk = chunk.subarray(0, chunk.length - 2);
    }
    if (chunk.length > 0) parts.push(chunk);
    start = next;
  }
  return parts;
}
