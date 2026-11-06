/* Shared canonical form: move it out of core into its own module used by the
   walk, the lattice and the custody check. Re-exported on WL. */

WL.canonicalEscape = function (s) {
  let out = '"';
  for (const ch of s) {
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\r') out += '\\r';
    else if (ch.charCodeAt(0) < 0x20) out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
};

WL.canonical = function (value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return WL.canonicalEscape(value);
  if (Array.isArray(value)) return '[' + value.map(WL.canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => WL.canonicalEscape(String(k)) + ':' + WL.canonical(value[k])).join(',') + '}';
};

WL.entryCanonical = function (entry) {
  return WL.canonical({
    action: entry.action,
    actor_id: entry.actor_id,
    at: entry.at,
    detail: entry.detail,
    seq: entry.seq,
    session_id: entry.session_id === undefined ? null : entry.session_id,
    target: entry.target,
  });
};

WL.digestFor = async function (prevDigest, canonical) {
  const bytes = new TextEncoder().encode(prevDigest + '\n' + canonical);
  return WL.hex(await crypto.subtle.digest('SHA-256', bytes));
};

WL.hex = function (buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

WL.sha256Hex = async function (data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return WL.hex(await crypto.subtle.digest('SHA-256', buf));
};

WL.ZERO_DIGEST = '0'.repeat(64);
WL.hasCrypto = !!(window.crypto && window.crypto.subtle && crypto.subtle.digest);
