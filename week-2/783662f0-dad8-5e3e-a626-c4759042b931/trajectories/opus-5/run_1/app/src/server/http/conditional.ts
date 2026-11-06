import type { Request, Response } from 'express';
import { fail } from '../errors.js';
import { sha256Hex } from '../util.js';

/** A strong ETag that changes whenever the record changes. */
export const etagOf = (kind: string, id: string, revision: number | string): string =>
  `"${sha256Hex(`${kind}:${id}:${revision}`).slice(0, 32)}"`;

export const setEtag = (res: Response, etag: string): void => {
  res.setHeader('ETag', etag);
};

/**
 * Every PUT or PATCH needs If-Match: 428 with none, 412 when it does not match
 * the record as it stands.
 */
export function requireIfMatch(req: Request, current: string): void {
  const header = req.headers['if-match'];
  if (header === undefined || header === '') throw fail('precondition_required');
  const offered = Array.isArray(header) ? header : [header];
  const matches = offered
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .some((value) => value === current);
  if (!matches) throw fail('precondition_failed', { etag: current });
}
