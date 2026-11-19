import { randomBytes, createHash } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// Opaque ids issued by the server: a prefix, a dot, and 26 base36 characters.
export function issueId(prefix) {
  const bytes = randomBytes(26);
  let out = '';
  for (let i = 0; i < 26; i++) out += ALPHABET[bytes[i] % 36];
  return `${prefix}_${out}`;
}

const ID_RE = /^[a-z]+_[0-9a-z]{26}$/;

// A well-formed id of the shape the server issues. Anything else is malformed
// and answers 404 exactly like an unknown id.
export function isWellFormedId(value) {
  return typeof value === 'string' && value.length <= 64 && ID_RE.test(value);
}

export function token() {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
