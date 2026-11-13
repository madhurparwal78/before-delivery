import { pool } from '../../../db/pool.js';
import { activeGrants, type StaffRole } from '../../../domain/roles.js';
import { errors } from '../../errors.js';
import {
  claimIdempotencyKey,
  fingerprintJson,
  readIdempotencyKey,
} from '../../idempotency.js';
import { enforceRateLimit } from '../../ratelimit.js';
import type { Reply } from '../../reply.js';
import { loadSession, type SignedInStaff } from '../../session.js';
import type { Ctx } from '../../server.js';

export type Session = {
  readonly staff: SignedInStaff;
  readonly roles: ReadonlySet<StaffRole>;
};

export async function requireSession(ctx: Ctx): Promise<Session> {
  const staff = await loadSession(pool, ctx.headers);
  if (staff === null) throw errors.unauthenticated();
  const grants = await activeGrants(pool, staff.email);
  return { staff, roles: new Set(grants.map((grant) => grant.role)) };
}

export function requireRole(session: Session, ...roles: readonly StaffRole[]): void {
  if (!roles.some((role) => session.roles.has(role))) throw errors.forbidden();
}

export function ifMatch(ctx: Ctx): number {
  const header = ctx.headers['if-match'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === '') throw errors.versionRequired();
  const parsed = Number.parseInt(value.trim().replace(/^W\//, '').replace(/"/g, ''), 10);
  if (!Number.isFinite(parsed)) throw errors.versionRequired();
  return parsed;
}

function headerValue(ctx: Ctx, name: string): string | undefined {
  const header = ctx.headers[name];
  return Array.isArray(header) ? header[0] : header;
}

/** Runs a console write under the session, rate limit and idempotency rules. */
export async function consoleWrite(
  ctx: Ctx,
  run: (session: Session) => Promise<Reply>,
): Promise<Reply> {
  const session = await requireSession(ctx);
  const headers = await enforceRateLimit('console_writes', session.staff.email);
  Object.assign(ctx.rateHeaders, headers);

  const key = readIdempotencyKey(headerValue(ctx, 'idempotency-key'));
  if (key === null) return run(session);

  const body = ctx.body.length === 0 ? {} : ctx.json();
  const claim = await claimIdempotencyKey(
    `staff:${session.staff.email}`,
    key,
    fingerprintJson(ctx.method, ctx.path, body),
  );
  if (claim.kind === 'replay') return claim.reply;
  const reply = await run(session);
  await claim.finish(reply);
  return reply;
}

export async function consoleRead(
  ctx: Ctx,
  run: (session: Session) => Promise<Reply>,
): Promise<Reply> {
  const session = await requireSession(ctx);
  return run(session);
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.readOnlyFields(['body']);
  }
  return value as Record<string, unknown>;
}

/** Refuses the whole request when it carries a server-owned or unknown key. */
export function onlyKeys(
  payload: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const offending = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (offending.length > 0) throw errors.readOnlyFields(offending);
}

export function requireText(
  payload: Record<string, unknown>,
  key: string,
  limits: { readonly min: number; readonly max: number; readonly message: string },
): string {
  const raw = payload[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  const points = [...value].length;
  if (points < limits.min || points > limits.max) {
    throw errors.validationFailed({ [key]: limits.message });
  }
  return value;
}

export function etag(version: number): Readonly<Record<string, string>> {
  return { ETag: `"${version}"` };
}
