import { createHmac, timingSafeEqual } from 'node:crypto';
import { LINK_TTL_SECONDS, config } from '../config.js';
import { serverNow } from './clock.js';

export interface LinkClaims {
  fileId: string;
  purpose: 'preview' | 'download';
  sessionId: string;
  issuedAt: number;
}

const sign = (payload: string): string =>
  createHmac('sha256', config.linkKey).update(payload).digest('base64url');

export const issueLink = (
  claims: Omit<LinkClaims, 'issuedAt'>,
): { token: string; expiresAt: string } => {
  const issuedAt = serverNow().getTime();
  const payload = Buffer.from(
    JSON.stringify({ ...claims, issuedAt } satisfies LinkClaims),
    'utf8',
  ).toString('base64url');
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: new Date(issuedAt + LINK_TTL_SECONDS * 1000).toISOString(),
  };
};

export const readLink = (token: string): LinkClaims | null => {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const wanted = Buffer.from(sign(payload));
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LinkClaims;
    if (typeof claims.fileId !== 'string' || typeof claims.sessionId !== 'string') return null;
    if (claims.purpose !== 'preview' && claims.purpose !== 'download') return null;
    if (typeof claims.issuedAt !== 'number') return null;
    return claims;
  } catch {
    return null;
  }
};

export const linkHasExpired = (claims: LinkClaims): boolean =>
  serverNow().getTime() - claims.issuedAt >= LINK_TTL_SECONDS * 1000;
