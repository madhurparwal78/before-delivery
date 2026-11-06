import type { IncomingMessage } from "node:http";

export const JSON_LIMIT = 65_536;
export const MULTIPART_LIMIT = 5_100_000;
const DRAIN_LIMIT = 64 * 1024 * 1024;

export type JsonObject = Record<string, unknown>;

interface RawBody {
  bytes: Buffer;
  tooLarge: boolean;
}

/** Reads the body up to `limit` bytes; an oversized body is drained (so the client reads the 413) but not kept. */
export function readBody(req: IncomingMessage, limit: number): Promise<RawBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > DRAIN_LIMIT) {
        req.destroy();
        return;
      }
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve({ bytes: Buffer.concat(chunks), tooLarge: size > limit }));
    req.on("error", reject);
    req.on("close", () => resolve({ bytes: Buffer.concat(chunks), tooLarge: size > limit }));
  });
}

export function parseJsonObject(bytes: Buffer): JsonObject | null {
  if (!bytes.length) return {};
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
  } catch {
    return null;
  }
}
