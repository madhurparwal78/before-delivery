// Request boundary checks in the published precedence order (DP-52, DP-53).

import type { IncomingMessage } from 'node:http';
import { problems, type Problem } from '../shared/problems.js';

export const JSON_BODY_LIMIT = 1_000_000;
export const PHOTO_BODY_LIMIT = 40_000_000;
export const IDEMPOTENCY_KEY_MAX = 128;

// A state-changing request whose Origin is present and is not the app's own RFC 6454
// origin, null included, is refused; a request with no Origin passes.
export function checkOrigin(req: IncomingMessage, ownOrigin: string): Problem | null {
  const origin = req.headers.origin;
  if (origin === undefined) return null;
  if (origin === 'null') return problems.originRefused();
  const candidates = [origin, origin.replace(/\/$/, '')];
  if (candidates.includes(ownOrigin)) return null;
  try {
    const url = new URL(origin);
    if (`${url.protocol}//${url.host}` === ownOrigin) return null;
  } catch {
    // an unparsable Origin is a foreign one
  }
  return problems.originRefused();
}

// Idempotency-Key is 1 to 128 printable ASCII characters.
export function checkIdempotencyKey(header: string | undefined): { ok: true; key: string } | { ok: false; problem: Problem } {
  if (header === undefined || header.length < 1 || header.length > IDEMPOTENCY_KEY_MAX) {
    return { ok: false, problem: problems.idempotencyKeyRequired() };
  }
  if (!/^[\x20-\x7e]+$/.test(header)) {
    return { ok: false, problem: problems.idempotencyKeyRequired() };
  }
  return { ok: true, key: header };
}

// If-Match on the layout's strong entity tag; '*' counts as missing.
export function checkIfMatch(req: IncomingMessage, etag: string): Problem | null {
  const header = req.headers['if-match'];
  if (header === undefined) return problems.preconditionRequired();
  const values = header.split(',').map((v) => v.trim());
  if (values.includes('*')) return problems.preconditionRequired();
  const strong = values.find((v) => v === `"${etag}"`);
  if (strong === undefined) return problems.layoutChanged();
  return null;
}

export function etagOf(version: number, hash: string): string {
  return `"${version}-${hash}"`;
}

export function parseEtag(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^"(.+)"$/.exec(value.trim());
  return match === null ? null : match[1]!;
}
