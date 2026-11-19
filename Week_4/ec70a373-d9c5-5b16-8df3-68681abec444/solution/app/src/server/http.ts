// The one error type and the one writer of the error body, plus the response helpers.
import type { ServerResponse } from "node:http";
import { now } from "./clock.ts";

type ErrorCode =
  | "read_only"
  | "body_too_large"
  | "file_too_large"
  | "unsupported_media_type"
  | "cross_origin"
  | "unauthenticated"
  | "session_invalid"
  | "session_expired"
  | "csrf_failed"
  | "method_not_allowed"
  | "too_many_attempts"
  | "forbidden"
  | "not_found"
  | "link_revoked"
  | "link_expired"
  | "idempotency_in_progress"
  | "idempotency_conflict"
  | "invalid_transition"
  | "hold_expired"
  | "too_early"
  | "too_late"
  | "visit_open"
  | "unsupported_type"
  | "validation"
  | "invalid_credentials"
  | "certificate_expired"
  | "cutoff"
  | "hold_limit"
  | "insufficient_hours"
  | "document_expired"
  | "slot_taken"
  | "series_conflict"
  | "rate_exists"
  | "billing_unavailable"
  | "storage_unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  read_only: 405,
  body_too_large: 413,
  file_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  session_invalid: 401,
  session_expired: 401,
  csrf_failed: 403,
  method_not_allowed: 405,
  too_many_attempts: 429,
  forbidden: 403,
  not_found: 404,
  link_revoked: 410,
  link_expired: 410,
  idempotency_in_progress: 409,
  idempotency_conflict: 409,
  invalid_transition: 409,
  hold_expired: 409,
  too_early: 409,
  too_late: 409,
  visit_open: 409,
  unsupported_type: 415,
  validation: 422,
  invalid_credentials: 401,
  certificate_expired: 422,
  cutoff: 422,
  hold_limit: 422,
  insufficient_hours: 422,
  document_expired: 422,
  slot_taken: 409,
  series_conflict: 409,
  rate_exists: 409,
  billing_unavailable: 503,
  storage_unavailable: 503,
  internal: 500,
};

const MESSAGES: Record<ErrorCode, string> = {
  read_only: "Inspector links are read-only.",
  body_too_large: "The request body is too large.",
  file_too_large: "Files can be at most 5,000,000 bytes.",
  unsupported_media_type: "This endpoint does not accept that content type.",
  cross_origin: "Writes are accepted only from this site.",
  unauthenticated: "Sign in to continue.",
  session_invalid: "This session is no longer valid.",
  session_expired: "This session has expired.",
  csrf_failed: "The CSRF token is missing or does not match this session.",
  method_not_allowed: "This path does not accept that method.",
  too_many_attempts: "Too many sign-in attempts.",
  forbidden: "Your role cannot use this.",
  not_found: "Not found.",
  link_revoked: "This link was revoked.",
  link_expired: "This link has expired.",
  idempotency_in_progress: "A request with this Idempotency-Key is still in progress.",
  idempotency_conflict: "This Idempotency-Key was already used for a different request.",
  invalid_transition: "This change is not allowed in the record's current state.",
  hold_expired: "The hold expired and the window was released.",
  too_early: "Too early for this action.",
  too_late: "Too late for this action.",
  visit_open: "This truck already has an open visit.",
  unsupported_type: "Upload a PDF, PNG or JPEG file.",
  validation: "Some fields are missing or invalid.",
  invalid_credentials: "That email and password don't match.",
  certificate_expired: "The certificate of insurance does not cover this.",
  cutoff: "That date is closed for booking.",
  hold_limit: "Three windows are already held.",
  insufficient_hours: "Not enough pack hours.",
  document_expired: "This document's expiry date has passed.",
  slot_taken: "That window was just claimed.",
  series_conflict: "Some weeks are taken.",
  rate_exists: "A rate already starts on that date.",
  billing_unavailable: "Billing is unreachable.",
  storage_unavailable: "Document storage is unreachable.",
  internal: "Something went wrong.",
};

interface ErrorExtras {
  fields?: Record<string, string>;
  dates?: string[];
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly extras: ErrorExtras;

  constructor(code: ErrorCode, extras: ErrorExtras = {}) {
    super(MESSAGES[code]);
    this.code = code;
    this.extras = extras;
  }
}

function baseHeaders(res: ServerResponse): void {
  res.setHeader("Date", new Date(now()).toUTCString());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/** The single error writer: `{"error":{"code","message",…}}` for every error but the health 503. */
export function sendError(res: ServerResponse, error: ApiError): void {
  const body: { code: ErrorCode; message: string; fields?: Record<string, string>; dates?: string[] } = {
    code: error.code,
    message: error.message,
  };
  if (error.extras.fields) body.fields = error.extras.fields;
  if (error.extras.dates) body.dates = error.extras.dates;
  baseHeaders(res);
  for (const [name, value] of Object.entries(error.extras.headers ?? {})) res.setHeader(name, value);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(STATUS[error.code]);
  res.end(JSON.stringify({ error: body }));
}

export type ReplyHeaders = Record<string, string | string[]>;

export function statusOf(code: ErrorCode): number {
  return STATUS[code];
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: ReplyHeaders = {}): void {
  baseHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.writeHead(status);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function sendBytes(res: ServerResponse, status: number, data: Buffer | string, headers: ReplyHeaders): void {
  baseHeaders(res);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.writeHead(status);
  res.end(data);
}

export function sendEmpty(res: ServerResponse, status: number, headers: ReplyHeaders = {}): void {
  baseHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.writeHead(status);
  res.end();
}

/** The answer to a request Node could not parse as HTTP: the single error body, written on the raw socket. */
export function malformedRequestBytes(): string {
  const body = JSON.stringify({ error: { code: "not_found", message: MESSAGES.not_found } });
  return [
    "HTTP/1.1 404 Not Found",
    `Date: ${new Date(now()).toUTCString()}`,
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: no-referrer",
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
}
