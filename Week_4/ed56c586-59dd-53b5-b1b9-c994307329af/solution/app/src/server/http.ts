import { type IncomingMessage, type ServerResponse } from "node:http";
import { ENQUIRY_BODY_LIMIT_BYTES, type EnquiryFieldMessages } from "../shared/enquiry.js";

/** Response helpers. Every API error has the one shape `{"error": <code>, "message": <text>}`; the 422 adds `fields`. */

interface ApiError {
  readonly error: string;
  readonly message: string;
}

export const NOT_FOUND: ApiError = { error: "not_found", message: "Not found." };
export const METHOD_NOT_ALLOWED: ApiError = { error: "method_not_allowed", message: "Method not allowed." };
export const TOO_LARGE: ApiError = { error: "too_large", message: "The request body is too large." };
export const BAD_REQUEST: ApiError = { error: "bad_request", message: "The request body must be a JSON object." };
export const MEDIA_UNAVAILABLE: ApiError = { error: "media_unavailable", message: "The media library is unavailable." };
export const MAIL_UNAVAILABLE: ApiError = { error: "mail_unavailable", message: "The mail server is unavailable." };

export const SERVER_ERROR: ApiError = { error: "server_error", message: "Something went wrong." };

/** The 422 body: the one error shape plus the failing fields. */
export function invalidEnquiry(fields: EnquiryFieldMessages): ApiError & { readonly fields: EnquiryFieldMessages } {
  return { error: "invalid", message: "The enquiry has invalid fields.", fields };
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export function sendError(response: ServerResponse, status: number, error: ApiError): void {
  sendJson(response, status, error);
}

export function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, { "cache-control": "no-store" });
  response.end();
}

export function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  response.end(html);
}

type BodyOutcome = { readonly kind: "object"; readonly value: Record<string, unknown> } | { readonly kind: "too-large" } | { readonly kind: "not-object" };

/** Reads the body as UTF-8 JSON whatever its content type is. A body over 16,384 bytes is refused as soon as it passes the
 * limit; the rest of it is read and thrown away so the connection stays usable for the 413. */
export function readJsonObject(request: IncomingMessage): Promise<BodyOutcome> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    request.on("data", (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > ENQUIRY_BODY_LIMIT_BYTES) {
        refused = true;
        chunks.length = 0;
        resolve({ kind: "too-large" });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (refused) return;
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
        resolve(isObject ? { kind: "object", value: parsed as Record<string, unknown> } : { kind: "not-object" });
      } catch {
        resolve({ kind: "not-object" });
      }
    });
  });
}
