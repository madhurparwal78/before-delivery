/** The ledger's canonical form and digest, shared by the walk, the lattice and custody. */

const SHORT = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

export function canonicalString(text) {
  let out = '"';
  for (const ch of text) {
    const short = SHORT[ch];
    if (short !== undefined) {
      out += short;
    } else if (ch < ' ') {
      out += '\\u' + ch.codePointAt(0).toString(16).padStart(4, '0');
    } else {
      out += ch;
    }
  }
  return out + '"';
}

export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys.map((key) => canonicalString(key) + ':' + canonicalJson(value[key])).join(',') +
    '}'
  );
}

export function entryCanonical(entry) {
  return canonicalJson({
    action: entry.action,
    actor_id: entry.actor_id,
    at: entry.at,
    detail: entry.detail,
    seq: entry.seq,
    session_id: entry.session_id === undefined ? null : entry.session_id,
    target: entry.target,
  });
}

export function hasCrypto() {
  return Boolean(window.crypto && window.crypto.subtle);
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function entryDigest(previousDigest, entry) {
  return sha256Hex(previousDigest + '\n' + entryCanonical(entry));
}

export const ZERO_DIGEST = '0'.repeat(64);
