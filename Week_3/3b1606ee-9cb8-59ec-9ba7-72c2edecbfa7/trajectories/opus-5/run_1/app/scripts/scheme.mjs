/**
 * A second, independent implementation of the published Airfold sealing scheme,
 * used by scripts/smoke.mjs to seal and open letters through the same API.
 */
const { subtle } = globalThis.crypto;
const getRandomValues = (array) => globalThis.crypto.getRandomValues(array);

export const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
export const unb64u = (text) => new Uint8Array(Buffer.from(text, 'base64url'));

export async function makeIdentity() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const digest = new Uint8Array(await subtle.digest('SHA-256', raw));
  return { pair, raw, pkcs8, keyId: b64u(digest.subarray(0, 12)) };
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeRecoveryCode() {
  const bytes = getRandomValues(new Uint8Array(20));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g).join('-');
}

export function canonicalRecoveryCode(code) {
  return code
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

async function hkdf(secret, salt, info, bytes) {
  const key = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) },
      key,
      bytes * 8,
    ),
  );
}

export async function recoveryMaterial(code) {
  const canonical = new TextEncoder().encode(canonicalRecoveryCode(code));
  const salt = new TextEncoder().encode('airfold/v1/recovery');
  return {
    verifier: await hkdf(canonical, salt, 'airfold/v1/recovery-verifier', 32),
    backupKey: await hkdf(canonical, salt, 'airfold/v1/key-backup', 32),
  };
}

export async function sealBytes(keyBytes, bytes) {
  const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes),
  );
  return { iv: b64u(iv), ciphertext: b64u(ciphertext) };
}

export async function openBytes(keyBytes, iv, ciphertext) {
  const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, key, unb64u(ciphertext)),
  );
}

export function pad(body) {
  const out = new Uint8Array((Math.floor(body.length / 160) + 1) * 160);
  out.set(body, 0);
  out[body.length] = 0x80;
  return out;
}

export function unpad(padded) {
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end -= 1;
  if (padded[end - 1] !== 0x80) throw new Error('bad padding');
  return padded.subarray(0, end - 1);
}

export async function conversationKey(privateKey, peerRawPublic, myId, peerId) {
  const peerKey = await subtle.importKey(
    'raw',
    peerRawPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: peerKey }, privateKey, 256),
  );
  const ids = [myId, peerId].sort().join(':');
  const salt = new Uint8Array(
    await subtle.digest('SHA-256', new TextEncoder().encode(ids)),
  );
  return hkdf(shared, salt, 'airfold/v1/msg', 32);
}

export async function sealLetter(key, body) {
  return sealBytes(key, pad(new TextEncoder().encode(JSON.stringify(body))));
}

export async function openLetter(key, iv, ciphertext) {
  const padded = await openBytes(key, iv, ciphertext);
  return JSON.parse(new TextDecoder().decode(unpad(padded)));
}

export async function sealNumber(rawA, rawB) {
  const [first, second] = [Buffer.from(rawA), Buffer.from(rawB)].sort(Buffer.compare);
  const digest = new Uint8Array(
    await subtle.digest('SHA-512', Buffer.concat([first, second])),
  );
  const groups = [];
  for (let i = 0; i < 12; i += 1) {
    let value = 0n;
    for (const byte of digest.subarray(i * 5, i * 5 + 5)) value = (value << 8n) | BigInt(byte);
    groups.push(String(value % 100000n).padStart(5, '0'));
  }
  return groups.join(' ');
}
