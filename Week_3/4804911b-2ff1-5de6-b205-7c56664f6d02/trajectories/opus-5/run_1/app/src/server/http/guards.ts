import { ApiError } from '../domain/errors.js';
import { waitMessage } from '../domain/sentences.js';
import { accountForSession, type AccountRecord } from '../db/repo.js';
import type { Ctx } from './server.js';

const WINDOW_MS = 60_000;

/** A fixed window counter per client. Counting happens before any await, so the limit is exact. */
class WindowLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly allowed: number) {}

  private window(client: string): { startedAt: number; count: number } {
    const now = Date.now();
    const existing = this.windows.get(client);
    if (existing === undefined || now - existing.startedAt >= WINDOW_MS) {
      const fresh = { startedAt: now, count: 0 };
      this.windows.set(client, fresh);
      return fresh;
    }
    return existing;
  }

  retryAfter(client: string): number {
    const window = this.window(client);
    const remaining = Math.ceil((window.startedAt + WINDOW_MS - Date.now()) / 1000);
    return Math.min(60, Math.max(1, remaining));
  }

  /** Counts one try and says whether it is allowed. */
  take(client: string): boolean {
    const window = this.window(client);
    window.count += 1;
    return window.count <= this.allowed;
  }

  exhausted(client: string): boolean {
    return this.window(client).count >= this.allowed;
  }

  count(client: string): void {
    this.window(client).count += 1;
  }
}

const lookupLimiter = new WindowLimiter(60);
const signInLimiter = new WindowLimiter(5);

function rateLimited(retryAfter: number): ApiError {
  return new ApiError(429, 'rate_limited', waitMessage(retryAfter), { retryAfter });
}

/** Batch lookups and batch-shaped pack searches share one counter. */
export function countLookup(ctx: Ctx): void {
  if (!lookupLimiter.take(ctx.clientAddress)) {
    throw rateLimited(lookupLimiter.retryAfter(ctx.clientAddress));
  }
}

export function guardSignIn(ctx: Ctx): void {
  if (signInLimiter.exhausted(ctx.clientAddress)) {
    throw rateLimited(signInLimiter.retryAfter(ctx.clientAddress));
  }
}

export function countFailedSignIn(ctx: Ctx): void {
  signInLimiter.count(ctx.clientAddress);
}

export async function loadAccount(ctx: Ctx): Promise<AccountRecord | null> {
  if (ctx.account !== null) return ctx.account;
  if (ctx.sessionToken === null) return null;
  ctx.account = await accountForSession(ctx.sessionToken);
  return ctx.account;
}

export async function requireRole(ctx: Ctx, role: 'editor' | 'stockist'): Promise<AccountRecord> {
  const account = await loadAccount(ctx);
  if (account === null) throw new ApiError(401, 'unauthenticated', 'Sign in to do that.');
  if (account.role !== role) throw new ApiError(403, 'forbidden', 'That screen belongs to another account.');
  return account;
}

export async function requireSignedIn(ctx: Ctx): Promise<AccountRecord> {
  const account = await loadAccount(ctx);
  if (account === null) throw new ApiError(401, 'unauthenticated', 'Sign in to do that.');
  return account;
}
