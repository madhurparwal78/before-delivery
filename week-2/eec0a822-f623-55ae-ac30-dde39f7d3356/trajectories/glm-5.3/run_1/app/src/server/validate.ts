import type { Ctx } from './http.js';
import { ApiError, accessRemoved, fieldErrors, forbidden, invalidJson, methodNotAllowed, notFound, pageEnded, rateLimited, sessionEnded, stateConflict, tooLarge, unauthenticated, unsupportedMediaType, yachtWithdrawn } from './errors.js';
import type { PoolClient } from 'pg';
import type { SessionInfo } from './http.js';

export interface MemberRow {
  id: string;
  workspace_slug: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  yacht_slug: string | null;
}

export interface SessionRow {
  id: string;
  ends_at: Date;
  signed_out: boolean;
}

export type Role = 'fleet_director' | 'charter_manager' | 'finance_lead' | 'captain' | 'crew_member';

export interface StaffCtx {
  member: MemberRow;
  ws: string;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function whole(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function strArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

/** Count of Unicode code points. */
export function lengthOf(s: string): number {
  return [...s].length;
}
