import type { IncomingMessage, ServerResponse } from "node:http";

import { copy } from "../src/shared/hour";
import { config } from "./config";

const BODY_LIMIT = 16_384;

/** Every error the API can answer, with its status and message. */
const ERRORS = {
  invalid_json: [400, "The request body is not valid JSON."],
  idempotency_key_required: [400, "Send an Idempotency-Key header of 8 to 64 characters."],
  signed_out: [401, "Sign in to manage your hour."],
  cross_origin: [403, "This request did not come from Stillhour."],
  not_found: [404, "Nothing is here."],
  no_plan: [404, "There is no confirmed hour for this address."],
  link_unknown: [404, "We do not recognise this link."],
  method_not_allowed: [405, "This method is not allowed here."],
  idempotency_conflict: [409, "This Idempotency-Key was already used with a different hour."],
  version_conflict: [409, "This hour changed since you loaded it."],
  link_used: [410, "This link has already been used."],
  link_expired: [410, "This link has expired."],
  too_large: [413, "The request is larger than 16,384 bytes."],
  unsupported_media_type: [415, "Send the request body as JSON."],
  invalid: [422, "Some details need another look."],
  version_required: [428, "Send the version you are editing in an If-Match header."],
  rate_limited: [429, "Too many requests for this address. Try again later."],
  internal: [500, "Something went wrong on our side. Please try again."],
  unavailable: [503, "Saving is unavailable right now. Your choices are still on this page; try again in a minute."],
} as const satisfies Record<string, readonly [number, string]>;

type ErrorCode = keyof typeof ERRORS;

/** The one error shape: {"error":{"code","message","fields"?, ...extra}}. */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly fields?: Record<string, string>,
    readonly headers: Record<string, string> = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(ERRORS[code][1]);
    this.status = ERRORS[code][0];
  }

  body() {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}), ...this.extra } };
  }
}

export const invalid = (fields?: Record<string, string>) => new ApiError("invalid", fields);

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function sendJson(response: ServerResponse, reply: Reply) {
  const headers: Record<string, string> = { "cache-control": "no-store", ...reply.headers };
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers).end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  response
    .writeHead(reply.status, { ...headers, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) })
    .end(payload);
}

const hasBody = (request: IncomingMessage) =>
  Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"] !== undefined;

/**
 * Reads a JSON body in the published order: a non-JSON content type is 415, more than 16,384 bytes is
 * 413 (by Content-Length or by what arrives), and malformed JSON is 400. No body reads as undefined.
 */
export async function readBody(request: IncomingMessage): Promise<unknown> {
  if (!hasBody(request)) return undefined;
  if (!/^application\/json\s*(;|$)/i.test(String(request.headers["content-type"] ?? ""))) {
    throw new ApiError("unsupported_media_type");
  }
  if (Number(request.headers["content-length"] ?? 0) > BODY_LIMIT) throw new ApiError("too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new ApiError("too_large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("invalid_json");
  }
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every key outside `allowed`, each with the not-accepted message. */
export function unaccepted(body: Record<string, unknown>, allowed: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.keys(body).filter((key) => !allowed.includes(key)).map((key) => [key, copy.notAccepted]));
}

export function cookie(request: IncomingMessage, name: string) {
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

/**
 * A write whose Origin is present must come from the origin it was addressed to: this server's own scheme,
 * host and port, or the public origin it is served at (behind a TLS proxy) when that names the same host.
 */
export function assertSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (origin === undefined || origin === `http://${request.headers.host}`) return;
  if (origin === config.origin && new URL(config.origin).host === request.headers.host) return;
  throw new ApiError("cross_origin");
}
