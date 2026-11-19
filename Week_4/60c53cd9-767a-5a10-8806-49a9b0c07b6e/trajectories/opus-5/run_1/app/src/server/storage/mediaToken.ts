/** Short-lived signed links: the only way the browser reaches stored objects. */

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { nowMs } from '../clock';

const signingKey = Buffer.from(
  hkdfSync('sha256', config.s3.secretAccessKey, config.s3.bucket, 'highwater-media-links', 32),
);

export interface MediaClaim {
  /** The stored object key. */
  k: string;
  /** The unit the object belongs to, when it has one. */
  u: string | null;
  /** Expiry, in app-clock epoch milliseconds. */
  e: number;
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

function sign(payload: string): string {
  return base64url(createHmac('sha256', signingKey).update(payload).digest());
}

export function mediaUrl(key: string, unitCode: string | null): string {
  const claim: MediaClaim = { k: key, u: unitCode, e: Math.floor(nowMs()) + config.mediaUrlSeconds * 1000 };
  const payload = base64url(Buffer.from(JSON.stringify(claim), 'utf8'));
  return `/media/${payload}.${sign(payload)}`;
}

export function readMediaToken(token: string): MediaClaim | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MediaClaim;
    if (typeof claim.k !== 'string' || typeof claim.e !== 'number') return null;
    if (nowMs() >= claim.e) return null;
    return { k: claim.k, u: typeof claim.u === 'string' ? claim.u : null, e: claim.e };
  } catch {
    return null;
  }
}
