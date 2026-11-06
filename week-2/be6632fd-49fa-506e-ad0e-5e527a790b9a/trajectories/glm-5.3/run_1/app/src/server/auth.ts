import type { FastifyRequest } from 'fastify';
import type { AppState } from './app.js';
import { ApiError, NOT_FOUND_BODY } from '../domain/errors.js';
import type { MemberRow } from './http.js';

export interface Auth {
  member: MemberRow;
  workspaceId: string;
  workspaceName: string;
}

export function requireStaff(req: FastifyRequest): Auth {
  const session = req.session;
  if (!session) {
    if (req.sessionEnded) throw new ApiError('session_ended');
    throw new ApiError('unauthenticated');
  }
  return { member: session.member, workspaceId: session.workspace.id, workspaceName: session.workspace.name };
}

export function requireRole(req: FastifyRequest, roles: string[]): Auth {
  const auth = requireStaff(req);
  if (!roles.includes(auth.member.role)) throw new ApiError('forbidden');
  return auth;
}

export function isRemoved(req: FastifyRequest, state: AppState): boolean {
  void state;
  return req.sessionRemoved === true;
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionRemoved?: boolean;
  }
}

export function notFound(): ApiError {
  return new ApiError('not_found');
}

export const NOT_FOUND_BYTES = NOT_FOUND_BODY;
