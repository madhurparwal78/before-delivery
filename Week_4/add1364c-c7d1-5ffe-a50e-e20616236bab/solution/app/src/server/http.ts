import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";

/** Every error the API answers is built here, in the one published shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

const NO_FIELD = "Lockset does not accept this field.";
const CHECK_FIELDS = "Check the highlighted fields.";

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "That is not in this drawer.");
}
export function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "Your role cannot do this.");
}
export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}
export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError(422, "invalid", CHECK_FIELDS, fields);
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function ok(body: unknown, status = 200): Reply {
  return { status, body };
}

export const STREAMING = Symbol("streaming");

function errorBody(error: ApiError): unknown {
  const body = { error: { code: error.code, message: error.message } };
  return error.fields ? { ...body, fields: error.fields } : body;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, errorBody(error), error.headers);
}

export const BODY_LIMIT = 16_384;
export const IMPORT_BODY_LIMIT = 1_000_000;

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new ApiError(413, "too_large", "That request is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) throw new ApiError(413, "too_large", "That request is too large.");
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const found: Record<string, string> = {};
  for (const piece of (header ?? "").split(";")) {
    const index = piece.indexOf("=");
    if (index > 0) found[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  return found;
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ---- published-field checking: one place for every write body ----

export type FieldKind = "string" | "boolean" | "integer" | "string_array" | "object" | "string_or_null" | "object_or_null" | "any";
export type Spec = Record<string, { kind: FieldKind; optional?: boolean }>;

const KIND_WORDS: Record<FieldKind, string> = {
  string: "text",
  boolean: "true or false",
  integer: "a whole number",
  string_array: "a list of text",
  object: "an object",
  string_or_null: "text or null",
  object_or_null: "an object or null",
  any: "a value",
};

function matches(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string_array":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string_or_null":
      return value === null || typeof value === "string";
    case "object_or_null":
      return value === null || (typeof value === "object" && !Array.isArray(value));
    case "any":
      return true;
  }
}

export class Fields {
  readonly errors: Record<string, string> = {};
  add(name: string, message: string): void {
    if (!(name in this.errors)) this.errors[name] = message;
  }
  get any(): boolean {
    return Object.keys(this.errors).length > 0;
  }
  throwIfAny(): void {
    if (this.any) throw invalid(this.errors);
  }
}

/**
 * Checks a parsed body against the keys an endpoint publishes. Unknown keys and wrongly typed keys
 * are collected on the Fields; missing required keys are reported as such. Returns the typed values.
 */
export function checkBody(body: unknown, spec: Spec, fields: Fields): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    fields.add("body", "Send a JSON object.");
    return {};
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(key in spec)) fields.add(key, NO_FIELD);
  }
  const values: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(spec)) {
    if (!(key in record) || (record[key] === undefined)) {
      if (!rule.optional) fields.add(key, "This is required.");
      continue;
    }
    if (!matches(rule.kind, record[key])) {
      fields.add(key, `Send ${KIND_WORDS[rule.kind]}.`);
      continue;
    }
    values[key] = record[key];
  }
  return values;
}

export function parseJson(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalid({ body: "Send valid JSON." });
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function fingerprint(method: string, path: string, raw: Buffer): string {
  let body: string;
  try {
    body = canonical(JSON.parse(raw.toString("utf8") || "{}"));
  } catch {
    body = raw.toString("utf8");
  }
  return createHash("sha256").update(`${method}\n${path}\n${body}`).digest("hex");
}
