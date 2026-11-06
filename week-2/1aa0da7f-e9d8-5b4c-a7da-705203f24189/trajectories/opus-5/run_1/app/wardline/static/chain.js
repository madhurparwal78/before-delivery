/** The Breaks rule, applied by the walk and the lattice alike. */

import { entryDigest } from './canon.js';

export const DASH = '-'.repeat(64);
const MISSING = '#'.repeat(64);

/**
 * Tests one link in order: seq, stored digest, stored previous digest, remembered.
 * Returns either {broken:false, digest} or {broken:true, named, value, compare}.
 */
export async function linkVerdict(link, entry, previousSeq, previousDigest, remembered) {
  const expected = previousSeq + 1;
  if (!entry || entry.seq !== expected) {
    return { broken: true, named: expected, value: DASH, compare: MISSING };
  }
  const digest = await entryDigest(previousDigest, entry);
  if (entry.digest !== digest) {
    return { broken: true, named: link, value: digest, compare: entry.digest };
  }
  if (entry.prev_digest !== previousDigest) {
    return { broken: true, named: link, value: previousDigest, compare: entry.prev_digest };
  }
  if (remembered && remembered !== digest) {
    return { broken: true, named: link, value: digest, compare: remembered };
  }
  return { broken: false, digest };
}
