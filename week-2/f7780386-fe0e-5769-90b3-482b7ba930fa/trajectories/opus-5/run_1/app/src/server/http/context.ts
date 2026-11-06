import type { Request, Response } from 'express';

import type { Role } from '../../shared/api.js';
import type { ServerClock } from '../clock.js';
import type { Config } from '../config.js';
import type { Database } from '../db/pool.js';
import type { BillingMonitor } from '../services/billing-monitor.js';
import type { KillBillClient } from '../services/killbill.js';
import type { Mailer } from '../services/mailer.js';
import type { ObjectStorage } from '../services/storage.js';

export interface AppContext {
  config: Config;
  clock: ServerClock;
  db: Database;
  killBill: KillBillClient;
  storage: ObjectStorage;
  mailer: Mailer;
  billing: BillingMonitor;
}

export interface SessionUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  member_id: string | null;
  business_name: string | null;
}

export interface RequestContext {
  app: AppContext;
  req: Request;
  res: Response;
  now: Date;
  today: string;
  user: SessionUser | null;
  body: Record<string, unknown>;
  rawBody: Buffer;
}

export function requireUser(ctx: RequestContext): SessionUser {
  if (ctx.user === null) {
    throw new Error('route reached without a session');
  }
  return ctx.user;
}

export function requireMemberId(ctx: RequestContext): string {
  const user = requireUser(ctx);
  if (user.member_id === null) {
    throw new Error('route reached without a member');
  }
  return user.member_id;
}
