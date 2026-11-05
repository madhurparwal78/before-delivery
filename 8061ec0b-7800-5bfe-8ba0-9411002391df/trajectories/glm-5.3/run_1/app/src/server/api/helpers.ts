// Shared helpers for API route handlers.
import type { PoolClient } from "pg";
import { ApiError } from "../errors.js";
import type { SessionUser } from "../sessions.js";
import { userFromSession } from "../sessions.js";
import type { Db } from "../db.js";
import { advisoryXactLock } from "../db.js";
import { sweepExpiredContracts } from "../domain/contractState.js";
import type { Clock } from "../clock.js";
import type { Role } from "../../shared/domain.js";

export interface AppContext {
  db: Db;
  clock: Clock;
}

export function storeToday(clock: Clock): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(clock.now());
}

export function serverNowIso(clock: Clock): string {
  const iso = clock.now().toISOString();
  return iso; // millisecond precision, e.g. 2026-11-04T22:59:10.250Z
}

// Runs fn inside a transaction, after sweeping expired holds.
export async function withSweep<T>(db: Db, clock: Clock, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return db.withTransaction(async (client) => {
    await sweepExpiredContracts(client, clock.now());
    return fn(client);
  });
}

export async function requireUser(
  db: Db,
  sessionToken: string | null,
  roles?: Role[]
): Promise<SessionUser> {
  const user = await db.withTransaction((client) => userFromSession(client, sessionToken));
  if (!user) throw ApiError.unauthenticated();
  if (roles && !roles.includes(user.role)) throw ApiError.forbidden();
  return user;
}

// Serialize money and state actions on one contract: a request that arrives
// while another is in progress waits for it to finish.
export async function lockContract(client: PoolClient, contractId: string): Promise<void> {
  await advisoryXactLock(client, "contract-action", contractId);
}

export function readBody(req: { body: unknown }): Record<string, unknown> {
  if (req.body === null || req.body === undefined) return {};
  if (typeof req.body === "object") return req.body as Record<string, unknown>;
  return {};
}

export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (typeof value === "string") return value;
  return null;
}

export function readNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function readBool(body: Record<string, unknown>, key: string): boolean | null {
  const value = body[key];
  if (typeof value === "boolean") return value;
  return null;
}

export function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function ts(iso: Date | string | null | undefined): string | null {
  if (!iso) return null;
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function ms(date: Date): string {
  return date.toISOString();
}
