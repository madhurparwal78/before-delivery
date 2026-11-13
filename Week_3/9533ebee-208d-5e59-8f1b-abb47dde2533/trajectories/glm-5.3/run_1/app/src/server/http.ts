import type { IncomingMessage, ServerResponse } from 'node:http';
import { problem, ProblemError } from './problems.js';
import type { Role } from '../shared/types.js';

export interface Body {
  [key: string]: unknown;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  actor?: Actor;
  body?: Body;
  idempotencyKey?: string;
  ifMatch?: string;
}

export interface Actor {
  actor_id: string;
  name: string;
  email: string;
  role: Role;
}

export const MAX_BODY_BYTES = 16_384;

export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function sendProblem(res: ServerResponse, err: ProblemError): void {
  const body = {
    type: `urn:quillmoor:problem:${err.code}`,
    status: err.status,
    code: err.code,
    detail: err.detail,
    ...(err.errors !== undefined && Object.keys(err.errors).length > 0 ? { errors: err.errors } : {}),
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/problem+json',
    'Content-Length': String(Buffer.byteLength(JSON.stringify(body))),
  };
  if (err.code === 'unauthenticated') headers['WWW-Authenticate'] = 'Bearer';
  if (err.headers !== undefined) Object.assign(headers, err.headers);
  res.writeHead(err.status, headers);
  res.end(JSON.stringify(body));
}

export function invalidJson(): ProblemError {
  return problem(400, 'invalid_json', 'The request body is not valid JSON.');
}

export function requireRole(ctx: Ctx, roles: Role[]): Actor {
  if (ctx.actor === undefined) {
    throw problem(401, 'unauthenticated', 'Choose who you are acting as.', undefined, { 'WWW-Authenticate': 'Bearer' });
  }
  if (!roles.includes(ctx.actor.role)) {
    throw problem(403, 'forbidden', 'Your role can\u2019t do this.');
  }
  return ctx.actor;
}

export function requireActor(ctx: Ctx): Actor {
  if (ctx.actor === undefined) {
    throw problem(401, 'unauthenticated', 'Choose who you are acting as.', undefined, { 'WWW-Authenticate': 'Bearer' });
  }
  return ctx.actor;
}

export function notFound(): ProblemError {
  return problem(404, 'not_found', 'Nothing here by that name.');
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export interface FieldRules {
  required: string[];
  optional: string[];
  types: Record<string, 'string' | 'number' | 'boolean'>;
}

/** Strict body parsing: object only, unknown keys rejected, control characters refused. */
export function validateBody(body: unknown, rules: FieldRules): Body {
  const errors: Record<string, string> = {};
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw problem(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      errors[key] = 'Unknown field.';
    }
  }
  const allowed = new Set([...rules.required, ...rules.optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors[key] = 'Unknown field.';
  }
  for (const key of Object.keys(errors)) {
    throw problem(422, 'validation_failed', 'Check the highlighted fields.', { [key]: errors[key] });
  }
  for (const key of rules.required) {
    if (!(key in record)) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', { [key]: firstMessage(key) });
    }
  }
  for (const key of rules.optional) {
    if (!(key in record)) continue;
  }
  for (const [key, type] of Object.entries(rules.types)) {
    if (!(key in record)) continue;
    const value = record[key];
    if (typeof value !== type) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', { [key]: firstMessage(key) });
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && CONTROL_CHARS.test(value)) {
      throw problem(422, 'validation_failed', 'Check the highlighted fields.', { [key]: 'Remove control characters.' });
    }
  }
  return record as Body;
}

function firstMessage(key: string): string {
  return firstMessages[key] ?? 'Enter digits with a comma before the decimals.';
}

const firstMessages: Record<string, string> = {
  amount: 'Enter a whole number of minor units above zero.',
  collateral_amount: 'Enter a whole number of minor units above zero.',
  amount_in: 'Enter a whole number of minor units above zero.',
  repay_amount: 'Enter a whole number of minor units above zero.',
  asset: 'Choose a listed asset.',
  from_asset: 'Choose a listed asset.',
  to_asset: 'Choose a listed asset.',
  collateral_asset: 'Choose a listed asset.',
  debt_asset: 'Choose a listed asset.',
  price: 'Enter a price above zero with at most 8 decimal places.',
  confirm_large_move: 'Send true or false.',
  quote_id: 'Send the quote id.',
  round: 'Send the round shown for this position.',
  name: 'Enter a name of 1 to 80 characters.',
  email: 'Enter a valid email address.',
  role: 'Choose a role.',
  actor_id: 'Choose an existing member.',
  from: 'Send an RFC 3339 time with an offset.',
  to: 'Send an RFC 3339 time with an offset.',
  ltv_bps: 'Loan-to-value must be above 0% and below the liquidation threshold.',
  liquidation_threshold_bps: 'Liquidation threshold must be above 0% and at most 95,00%.',
  liquidation_bonus_bps: 'Bonus must be from 0% to 20,00%, and the threshold times one plus the bonus must stay below 100%.',
  reserve_factor_bps: 'Reserve factor must be from 0% to 50,00%.',
};
