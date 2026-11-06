// The ledger's canonical form and digest, shared by the walk, the lattice and the custody check.

export const ZERO_DIGEST = '0'.repeat(64);
export const NO_WEB_CRYPTO = 'Cannot verify in this browser. Open Wardline over HTTPS or on this machine.';

export function hasWebCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

function canonicalEntry(entry) {
  const { action, actor_id, at, detail, seq, session_id, target } = entry;
  return JSON.stringify(sorted({ action, actor_id, at, detail, seq, session_id: session_id ?? null, target }));
}

const encoder = new TextEncoder();

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The digest of a link: previous digest, one line feed, the canonical form.
export function linkDigest(previous, entry) {
  return sha256Hex(encoder.encode(`${previous}\n${canonicalEntry(entry)}`));
}
