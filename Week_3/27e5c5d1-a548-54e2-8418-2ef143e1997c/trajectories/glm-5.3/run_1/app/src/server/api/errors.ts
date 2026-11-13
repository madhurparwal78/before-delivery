import type { FastifyReply } from 'fastify';
import type { BoardAccess, Store, SessionRow } from '../store.js';
import type { Role } from '../../shared/protocol.js';

export type ApiFailure = { status: number; body: Record<string, unknown>; allow?: string };

export const failures = {
  signedOut(): ApiFailure {
    return { status: 401, body: { error: 'signed_out' } };
  },
  invalidCredentials(): ApiFailure {
    return { status: 401, body: { error: 'invalid_credentials' } };
  },
  forbidden(): ApiFailure {
    return { status: 403, body: { error: 'forbidden' } };
  },
  crossOrigin(): ApiFailure {
    return { status: 403, body: { error: 'cross_origin' } };
  },
  notFound(): ApiFailure {
    return { status: 404, body: { error: 'not_found' } };
  },
  methodNotAllowed(allow: string): ApiFailure {
    return { status: 405, body: { error: 'method_not_allowed' }, allow };
  },
  stale(card: unknown, changedBy: { displayName: string }, change: 'moved' | 'edited'): ApiFailure {
    return { status: 409, body: { error: 'stale', card, changedBy, change } };
  },
  invalidTransition(from: string, to: string): ApiFailure {
    return { status: 409, body: { error: 'invalid_transition', from, to } };
  },
  archived(): ApiFailure {
    return { status: 409, body: { error: 'archived' } };
  },
  lastAdmin(): ApiFailure {
    return { status: 409, body: { error: 'last_admin' } };
  },
  alreadyMember(): ApiFailure {
    return { status: 409, body: { error: 'already_member' } };
  },
  noChange(): ApiFailure {
    return { status: 409, body: { error: 'no_change' } };
  },
  emailTaken(): ApiFailure {
    return { status: 409, body: { error: 'email_taken' } };
  },
  idempotencyConflict(): ApiFailure {
    return { status: 409, body: { error: 'idempotency_conflict' } };
  },
  tooLarge(): ApiFailure {
    return { status: 413, body: { error: 'too_large' } };
  },
  unsupportedMediaType(): ApiFailure {
    return { status: 415, body: { error: 'unsupported_media_type' } };
  },
  validation(fields: Record<string, string>): ApiFailure {
    return { status: 422, body: { error: 'validation', fields } };
  },
  internal(): ApiFailure {
    return { status: 500, body: { error: 'internal' } };
  },
  storageUnavailable(): ApiFailure {
    return { status: 503, body: { error: 'storage_unavailable' } };
  },
};

export class ApiError extends Error {
  readonly statusCode: number;
  constructor(public readonly failure: ApiFailure) {
    super(failure.body['error'] as string);
    this.name = 'ApiError';
    this.statusCode = failure.status;
  }
}

export function fail(failure: ApiFailure): never {
  throw new ApiError(failure);
}

export interface RequestContext {
  store: Store;
  session: SessionRow | null;
  reply: FastifyReply;
}

/** Resolve board access or answer the byte-identical 404. */
export async function requireBoardAccess(ctx: RequestContext, boardId: string): Promise<BoardAccess> {
  if (!isValidOpaqueId(boardId)) fail(failures.notFound());
  const access = await ctx.store.boardAccess(boardId, ctx.session!.userId);
  if (!access) fail(failures.notFound());
  return access;
}

export function requireRole(access: BoardAccess, minimum: Role): void {
  const order: Role[] = ['observer', 'member', 'admin'];
  if (order.indexOf(access.role) < order.indexOf(minimum)) fail(failures.forbidden());
}

export function isValidOpaqueId(value: string): boolean {
  return value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value) && value.length >= 6;
}
