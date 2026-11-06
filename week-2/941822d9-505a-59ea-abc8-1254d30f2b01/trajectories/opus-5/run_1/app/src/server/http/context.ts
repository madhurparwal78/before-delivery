import type { IncomingMessage } from 'node:http';
import type { Role } from '../domain/courseLifecycle.js';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly organisationId: string | null;
  readonly organisationName: string | null;
  readonly organisationSlug: string | null;
  readonly organisationKind: 'provider' | 'hospital' | null;
  readonly licenceNumber: string | null;
  readonly dateOfBirth: string | null;
}

export interface RequestContext {
  readonly request: IncomingMessage;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly params: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown> | null;
  readonly origin: string;
  readonly user: AuthUser | null;
  readonly at: Date;
}

export interface Reply {
  readonly status: number;
  readonly json?: unknown;
  readonly body?: Buffer;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly setSessionCookie?: string;
  readonly clearSessionCookie?: boolean;
}

export function requireUser(ctx: RequestContext): AuthUser {
  if (ctx.user === null) throw new Error('This route is authenticated');
  return ctx.user;
}

export function param(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (value === undefined) throw new Error(`Route parameter ${name} is not declared`);
  return value;
}
