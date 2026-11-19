/** Session reading and the role gates every endpoint shares. */

import { pool } from '../db';
import { ApiError } from '../errors';
import { accountForSession, type AccountRecord } from '../domain/accounts';
import { cookies, SESSION_COOKIE, type Wire } from './wire';

export function sessionToken(wire: Wire): string | null {
  return cookies(wire).get(SESSION_COOKIE) ?? null;
}

export async function currentAccount(wire: Wire): Promise<AccountRecord | null> {
  return accountForSession(pool, sessionToken(wire));
}

export async function requireAccount(wire: Wire): Promise<AccountRecord> {
  const account = await currentAccount(wire);
  if (!account) throw new ApiError('unauthenticated');
  return account;
}

export function requireRole(account: AccountRecord, role: AccountRecord['role']): AccountRecord {
  if (account.role !== role) throw new ApiError('forbidden');
  return account;
}
