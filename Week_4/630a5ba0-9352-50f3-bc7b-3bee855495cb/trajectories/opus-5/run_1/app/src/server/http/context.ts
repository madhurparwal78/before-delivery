import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MemberRow, WorkspaceRow } from '../db/records.js';
import type { WorkspaceState } from '../../shared/types.js';
import { ApiError, forbidden, unauthenticated, workspaceReadOnly } from './errors.js';
import { isWritable } from '../domain/subscription.js';

export const SESSION_COOKIE = 'tidemark_session';

export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  rawBody: Buffer;
  origin: string;
  member: MemberRow | null;
  workspace: WorkspaceRow | null;
  workspaceState: WorkspaceState | null;
  billedSeats: number | null;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals < 0) continue;
    jar.set(part.slice(0, equals).trim(), decodeURIComponent(part.slice(equals + 1).trim()));
  }
  return jar;
}

export function requireMember(context: RequestContext): MemberRow {
  if (!context.member) throw unauthenticated();
  return context.member;
}

export function requirePlanner(context: RequestContext): { member: MemberRow; workspace: WorkspaceRow } {
  const member = requireMember(context);
  if (member.role === 'operator' || !context.workspace) throw forbidden();
  return { member, workspace: context.workspace };
}

export function requireOwner(context: RequestContext): { member: MemberRow; workspace: WorkspaceRow } {
  const planner = requirePlanner(context);
  if (planner.member.role !== 'owner') throw forbidden();
  return planner;
}

export function requireOperator(context: RequestContext): MemberRow {
  const member = requireMember(context);
  if (member.role !== 'operator') throw forbidden();
  return member;
}

export function requireWritable(context: RequestContext): void {
  if (context.workspaceState !== null && !isWritable(context.workspaceState)) {
    throw workspaceReadOnly();
  }
}

export function jsonBody(context: RequestContext): Record<string, unknown> {
  if (context.rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(context.rawBody.toString('utf8'));
  } catch {
    throw new ApiError(422, 'validation_failed', 'That body is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(422, 'validation_failed', 'That body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
