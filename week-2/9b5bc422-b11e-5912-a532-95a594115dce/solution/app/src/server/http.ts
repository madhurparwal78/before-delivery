import type { IncomingMessage, ServerResponse } from "node:http";
import { JSON_LIMIT_BYTES } from "../shared/limits.ts";

/** An API answer other than success; the one place error bodies are built. */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string>;

  constructor(status: number, errors: Record<string, string>) {
    super(Object.values(errors).join(" "));
    this.status = status;
    this.errors = errors;
  }
}

export const signInAgain = (): ApiError => new ApiError(401, { form: "Sign in again." });
export const notFound = (): ApiError => new ApiError(404, { form: "Not found." });
export const unavailable = (): ApiError => new ApiError(503, { form: "The server is unavailable." });
export const deadLink = (): ApiError => new ApiError(404, { form: "This link no longer works." });

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, { errors: error.errors });
}

export function sendEmpty(res: ServerResponse, headers: Record<string, string> = {}): void {
  res.writeHead(204, headers);
  res.end();
}

/** Reads a body up to `limit` bytes; a longer body is drained and answers `null`. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export type JsonObject = Record<string, unknown>;

export async function readJson(req: IncomingMessage): Promise<JsonObject> {
  const body = await readBody(req, JSON_LIMIT_BYTES);
  if (!body) throw new ApiError(413, { form: "That request is too large." });
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

export function cookieValue(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
