// Media tokens: short-lived signed links that name an object and, where there is
// one, its unit (DP-46). Tokens are HMAC-signed; withdrawn units stop resolving.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MediaTokenPayload {
  key: string;
  unitCode: string | null;
  contentType: string;
  expires: number;
}

export class MediaTokens {
  constructor(private readonly secret: string) {}

  issue(payload: Omit<MediaTokenPayload, 'expires'>, mediaUrlSeconds: number, now: number): string {
    const full: MediaTokenPayload = { ...payload, expires: now + mediaUrlSeconds * 1000 };
    const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  verify(token: string, now: number): MediaTokenPayload | null {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MediaTokenPayload;
      if (payload.expires <= now) return null;
      if (typeof payload.key !== 'string') return null;
      return payload;
    } catch {
      return null;
    }
  }
}

export function mediaSecret(seed: string): string {
  return `highwater-media-${seed}`;
}
