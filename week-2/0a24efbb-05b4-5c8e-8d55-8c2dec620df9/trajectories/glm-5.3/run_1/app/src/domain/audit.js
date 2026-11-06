import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);
const US = '\u001f';

/**
 * The canonical string of an audit entry: eight values joined with U+001F.
 * Whole numbers in decimal; nulls as the empty string.
 */
export function canonicalString(entry) {
  return [
    String(entry.seq),
    entry.at,
    String(entry.actor_id),
    entry.action,
    entry.subject_type,
    String(entry.subject_id),
    entry.detail ?? '',
    entry.prev_hash,
  ].join(US);
}

export function entryHash(entry) {
  return createHash('sha256').update(canonicalString(entry), 'utf8').digest('hex');
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
