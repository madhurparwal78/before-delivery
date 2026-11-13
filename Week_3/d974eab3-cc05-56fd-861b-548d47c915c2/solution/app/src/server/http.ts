import type { IncomingMessage, ServerResponse } from "node:http";
import { SHEET_UNAVAILABLE_MESSAGE } from "../shared/messages.js";

const BODY_LIMIT_BYTES = 262144;

/** Every API error is this one shape. */
function apiError(error: string, message: string): { error: string; message: string } {
  return { error, message };
}

export const NOT_FOUND = apiError("not_found", "Not found.");
export const TOO_LARGE = apiError("too_large", "The request body is too large.");
export const INVALID = apiError("invalid", "The content does not match the published shape.");
export const NO_INTERVIEW = apiError("not_found", "This interview does not exist.");
export const NO_SCENARIO = apiError("not_found", "This scenario does not exist.");
export const SHEET_UNAVAILABLE = apiError("sheet_unavailable", SHEET_UNAVAILABLE_MESSAGE);
export const UNAVAILABLE = apiError("unavailable", "The service is not available right now. Please try again in a moment.");
export const SERVER_ERROR = apiError("server_error", "Something went wrong. Please try again in a moment.");

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

export function sendBytes(response: ServerResponse, status: number, headers: Record<string, string | number>, body: Buffer): void {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers, "Content-Length": body.length });
  response.end(body);
}

/** Reads a request body up to the limit; `null` means the body was larger (the rest is drained and dropped). */
export function readBody(request: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT_BYTES) chunks.push(chunk);
    });
    request.on("end", () => resolve(size <= BODY_LIMIT_BYTES ? Buffer.concat(chunks) : null));
    request.on("error", reject);
  });
}
