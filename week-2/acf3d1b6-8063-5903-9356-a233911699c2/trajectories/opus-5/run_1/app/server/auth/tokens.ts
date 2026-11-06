import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const KEY = createHash('sha256')
  .update(`kinora-session:${process.env.DATABASE_URL ?? ''}`)
  .digest();

export const SESSION_COOKIE = 'kinora_session';

export interface SessionClaims {
  uid: string;
  v: number;
}

function sign(body: string): string {
  return createHmac('sha256', KEY).update(body).digest('base64url');
}

export function signSession(claims: SessionClaims): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readSession(token: string | undefined | null): SessionClaims | null {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
    return typeof claims.uid === 'string' && typeof claims.v === 'number' ? claims : null;
  } catch {
    return null;
  }
}

export function invitationToken(): string {
  return randomBytes(24).toString('base64url');
}
