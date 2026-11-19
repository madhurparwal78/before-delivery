import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/runtime.js';
import { now } from '../domain/time.js';

const LINK_TTL_MS = 60_000;

export interface LinkTokenPayload {
  fileId: string;
  purpose: 'preview' | 'download';
  sessionId: string;
  issuedAt: number;
}

function sign(data: string): string {
  return createHmac('sha256', config.linkSecret).update(data).digest('base64url');
}

export function createLinkToken(payload: LinkTokenPayload): { url: string; expiresAt: string } {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body);
  const token = `${body}.${sig}`;
  return {
    url: `/api/content/${token}`,
    expiresAt: new Date(payload.issuedAt + LINK_TTL_MS).toISOString().replace(/\.\d{3}Z$/, '.000Z'),
  };
}

export function verifyLinkToken(token: string): LinkTokenPayload | 'expired' | 'bad' {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return 'bad';
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'bad';
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkTokenPayload;
    if (now() >= payload.issuedAt + LINK_TTL_MS) return 'expired';
    return payload;
  } catch {
    return 'bad';
  }
}
