/** What a handler receives: the request, its parsed parts and the signed-in user. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { invalidJson } from "./errors.js";

export type Role = "owner" | "admin" | "member";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string;
  sessionId: string;
}

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Buffer;
  user: SessionUser;
  idempotencyKey: string | undefined;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

const PLAIN_DIGITS = /^[1-9]\d*$/;

/** An amount_cents written with a sign, point or exponent ("1.0", "1e2", "-0") is not plain digits: it parses to NaN so validation refuses it. */
function plainAmounts(key: string, value: unknown, context?: { source?: string }): unknown {
  if (key !== "amount_cents" || typeof value !== "number") return value;
  return context?.source !== undefined && PLAIN_DIGITS.test(context.source) ? value : Number.NaN;
}

/** The request body as a JSON object; anything else is invalid_json. */
export function jsonObject(ctx: Pick<Context, "body">): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(ctx.body), plainAmounts);
  } catch {
    throw invalidJson();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalidJson();
  return parsed as Record<string, unknown>;
}

/** An empty body counts as an empty object for endpoints that read no keys. */
export function optionalJsonObject(ctx: Pick<Context, "body">): Record<string, unknown> {
  return ctx.body.length === 0 ? {} : jsonObject(ctx);
}
