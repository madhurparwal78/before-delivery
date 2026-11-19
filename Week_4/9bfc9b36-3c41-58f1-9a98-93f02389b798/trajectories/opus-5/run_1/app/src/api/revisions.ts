import { refuse } from '../http/errors';
import type { Ctx } from './types';

/** Versioned saves: a missing `If-Match` is 428, a stale one is 412. */

export function readRevision(ctx: Ctx): number {
  const header = ctx.headers['if-match'];
  if (typeof header !== 'string' || header.trim() === '') throw refuse('precondition_required');
  const match = /^"?(\d+)"?$/.exec(header.trim());
  if (match === null) throw refuse('stale_revision');
  return Number(match[1]);
}

export function requireMatch(wanted: number, stored: number): void {
  if (wanted !== stored) throw refuse('stale_revision');
}
