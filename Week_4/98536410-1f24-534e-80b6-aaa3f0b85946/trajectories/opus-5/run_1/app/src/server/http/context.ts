import type { IncomingMessage, ServerResponse } from 'node:http';
import { forbidden, notFound, unauthenticated, validationFailed } from './errors.js';

export type Role = 'lead' | 'manager' | 'care' | 'shopper';

export type SessionUser = {
  sessionId: string;
  userId: string;
  operatorId: string;
  email: string;
  name: string;
  role: Role;
  storeIds: string[];
  expiresAt: Date;
};

export type RequestContext = {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  session: SessionUser | null;
};

export function requireSession(context: RequestContext): SessionUser {
  if (!context.session) throw unauthenticated();
  return context.session;
}

export function requireRole(context: RequestContext, ...roles: Role[]): SessionUser {
  const session = requireSession(context);
  if (!roles.includes(session.role)) throw forbidden();
  return session;
}

export function bodyObject(context: RequestContext): Record<string, unknown> {
  if (context.body === undefined || context.body === null) return {};
  if (typeof context.body !== 'object' || Array.isArray(context.body)) {
    throw validationFailed({ body: 'Send a JSON object.' });
  }
  return context.body as Record<string, unknown>;
}

export function param(context: RequestContext, name: string): string {
  const value = context.params[name];
  if (value === undefined) throw notFound();
  return value;
}

export function integerField(
  source: Record<string, unknown>,
  field: string,
  low: number,
  high: number,
  message: string,
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw validationFailed({ [field]: message });
  }
  return value;
}

export function stringField(
  source: Record<string, unknown>,
  field: string,
  low: number,
  high: number,
  message: string,
): string {
  const value = source[field];
  if (typeof value !== 'string' || value.length < low || value.length > high) {
    throw validationFailed({ [field]: message });
  }
  return value;
}
