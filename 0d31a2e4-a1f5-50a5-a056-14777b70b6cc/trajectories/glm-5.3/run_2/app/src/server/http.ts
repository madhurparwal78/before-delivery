import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool, type PoolClient } from "pg";

export type ApiErrorSpec = {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

const ERRORS = {
  unauthenticated: [401, "You need to sign in first."],
  email_unverified: [403, "Verify your email first."],
  not_found: [404, "Not found."],
  bad_origin: [403, "Request refused."],
  payload_too_large: [413, "That request is too large."],
  unsupported_media_type: [415, "Requests must be JSON."],
  invalid_transition: [409, "That can't be done in the current state."],
  rate_limited: [429, "Slow down — you can send again in a few seconds."],
  mail_unavailable: [503, "Mail is down right now. Try again in a minute."],
  server_error: [500, "Something went wrong. Try again."]
} as const;

type ErrorKey = keyof typeof ERRORS;

export function err(key: ErrorKey, fields?: Record<string, string>, extra?: Record<string, unknown>): ApiError {
  const [status, message] = ERRORS[key];
  return new ApiError(status, key, message, fields, extra);
}

export const FIELD_MESSAGES = {
  emailInvalid: "Enter a valid email address.",
  emailTaken: "That email already has an account.",
  handleInvalid: "Use 3 to 20 lowercase letters, digits or underscores.",
  handleTaken: "That handle is taken.",
  handleMissing: "No player called this.",
  passwordInvalid: "Use 10 to 128 characters.",
  bodyInvalid: "Messages are 1 to 500 characters.",
  handleSelf: "You can't add yourself."
} as const;

export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...(headers ?? {})
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  const body: { error: { code: string; message: string; fields?: Record<string, string> } & Record<string, unknown> } = {
    error: { code: error.code, message: error.message }
  };
  if (error.fields) body.error.fields = error.fields;
  if (error.extra) for (const [k, v] of Object.entries(error.extra)) body.error[k] = v;
  sendJson(res, error.status, body);
}

export async function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  const contentType = String(req.headers["content-type"] ?? "");
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw err("unsupported_media_type");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limitBytes) throw err("payload_too_large");
    chunks.push(buf);
  }
  if (chunks.length === 0) throw err("unsupported_media_type");
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw err("unsupported_media_type");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(body: unknown, field: string): string {
  if (!isRecord(body) || typeof body[field] !== "string") {
    throw new ApiError(422, "validation_failed", "Check the highlighted fields.", {
      [field]: "This field is required."
    });
  }
  return body[field];
}

export async function withTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Runs the whole SERIALIZABLE transaction, retrying when the database finds a
 * race with a concurrent writer. Unique-index losses surface as duplicate-key
 * errors before commit, so those are retried too: the second attempt sees the
 * committed row and takes the correct path.
 */
export async function serializable<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(pool, async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        return run(client);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const raced = message.includes("could not serialize access") || message.includes("duplicate key value violates unique constraint");
      if (attempt < 5 && raced) continue;
      throw e;
    }
  }
}
