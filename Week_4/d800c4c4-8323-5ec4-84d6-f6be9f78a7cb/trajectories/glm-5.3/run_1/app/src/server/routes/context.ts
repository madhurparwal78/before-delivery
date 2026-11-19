// Shared context for route handlers: dependencies plus the request's auth.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from '../db';
import type { KillBillClient, KillBillDown } from '../killbill';
import type { Storage } from '../storage';
import type { StorageDown } from '../storageErrors';
import type { Mailer } from '../mail';
import type { Config } from '../config';
import type { User } from '../../shared/api';
import { sessionEnded, needsSignIn, staffOnly, coordinatorOnly, membersOnly, ApiError, providerDown, COPY } from '../errors';
import { authenticate } from '../sessions';

export interface AuthContext {
  user: User | null;
  sessionEnded: boolean;
  token: string | null;
}

export interface RouteContext {
  db: Db;
  config: Config;
  killbill: KillBillClient;
  storage: Storage;
  mailer: Mailer;
  status: { storage: 'up' | 'down'; billing: 'up' | 'down' };
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  auth: AuthContext;
  route: RouteContext;
  pathname: string;
  query: URLSearchParams;
}

export async function authenticateRequest(db: Db, config: Config, req: IncomingMessage): Promise<AuthContext> {
  const isWrite = (req.method ?? 'GET') !== 'GET' && (req.method ?? '') !== 'HEAD';
  return authenticate(db, req, config.sessionIdleSeconds, isWrite);
}

export function requireUser(ctx: Ctx): User {
  if (ctx.auth.user === null) throw ctx.auth.sessionEnded ? sessionEnded() : needsSignIn();
  return ctx.auth.user;
}

export function requireStaff(ctx: Ctx): User {
  const user = requireUser(ctx);
  if (user.role === 'member') throw staffOnly();
  return user;
}

export function requireCoordinator(ctx: Ctx): User {
  const user = requireUser(ctx);
  if (user.role !== 'coordinator') throw coordinatorOnly();
  return user;
}

export function requireMember(ctx: Ctx): User {
  const user = requireUser(ctx);
  if (user.role !== 'member') throw membersOnly();
  return user;
}

export function killBillDown(): ApiError {
  return providerDown(COPY.billingDownJoin);
}

export { KillBillDown, StorageDown };
