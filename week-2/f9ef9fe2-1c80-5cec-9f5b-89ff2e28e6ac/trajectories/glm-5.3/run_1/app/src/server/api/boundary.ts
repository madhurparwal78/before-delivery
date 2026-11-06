import type { Request } from "express";
import { ApiError, crossOrigin, invalidJson, payloadTooLarge, unsupportedMediaType } from "../errors";

export const JSON_BODY_LIMIT = 64000;
export const UPLOAD_BODY_LIMIT = 5200000;
export const FILE_PART_LIMIT = 5000000;

const BLOCKED_PATH_RE = /(^|\/)(src|node_modules|\.git|\.env)(\/|$)|\/?(run\.json|package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/;

export function isBlockedPath(pathname: string): boolean {
  const normalized = pathname.replace(/^\/+/, "");
  return BLOCKED_PATH_RE.test(normalized);
}

/** Cross-origin guard: only same-origin use is supported. */
export function checkOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    return;
  }
  const host = req.headers.host;
  if (!host) {
    throw crossOrigin();
  }
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host) {
      throw crossOrigin();
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw crossOrigin();
  }
}

export function readRawBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overLimit = false;
    req.on("data", (chunk: Buffer) => {
      if (overLimit) {
        return; // drain so the response can be sent on the same connection
      }
      size += chunk.length;
      if (size > limit) {
        overLimit = true;
        reject(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!overLimit) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (error: Error) => {
      if (!overLimit) {
        reject(error);
      }
    });
  });
}

/**
 * Reads and parses a JSON request body, applying the transport checks in the
 * single error precedence: size, content type, parse.
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req, JSON_BODY_LIMIT);
  if (raw.length === 0) {
    return {};
  }
  const contentType = req.headers["content-type"] ?? "";
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime !== "application/json") {
    throw unsupportedMediaType();
  }
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw invalidJson();
  }
}
