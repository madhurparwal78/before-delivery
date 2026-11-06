import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { SessionUser } from '../http/context.js';
import { errors } from '../http/errors.js';
import {
  createSession,
  deleteSession,
  findUserByEmail,
  findUserBySessionToken,
} from '../db/repo/users.js';
import { findTenant } from '../db/repo/tenants.js';

const SCRYPT_KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEY_LENGTH);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  role: SessionUser['role'];
  tenantId: string | null;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  };
}

export async function userForSessionToken(token: string): Promise<SessionUser | null> {
  const user = await findUserBySessionToken(token);
  if (!user) return null;
  if (user.tenantId) {
    const tenant = await findTenant(user.tenantId);
    if (!tenant || tenant.storedStatus === 'offboarded') return null;
  }
  return toSessionUser(user);
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ user: SessionUser; token: string }> {
  const found = await findUserByEmail(email);
  if (!found || !verifyPassword(password, found.passwordHash)) throw errors.invalidCredentials();
  if (found.user.tenantId) {
    const tenant = await findTenant(found.user.tenantId);
    if (tenant?.storedStatus === 'offboarded') throw errors.tenantOffboarded();
  }
  const token = randomBytes(32).toString('base64url');
  await createSession(token, found.user.id);
  return { user: toSessionUser(found.user), token };
}

export async function signOut(token: string): Promise<void> {
  await deleteSession(token);
}
