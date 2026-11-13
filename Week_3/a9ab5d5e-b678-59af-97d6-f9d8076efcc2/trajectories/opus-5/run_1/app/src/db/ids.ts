import { fail } from '../errors';

const MAX_ID = 9223372036854775807n;

/** Ids are decimal strings; anything non-numeric or past every integer range is a plain 404. */
export function knownIdOrNotFound(raw: string | undefined): string {
  if (raw === undefined || !/^\d{1,30}$/.test(raw) || BigInt(raw) > MAX_ID) fail('not_found');
  return raw;
}
