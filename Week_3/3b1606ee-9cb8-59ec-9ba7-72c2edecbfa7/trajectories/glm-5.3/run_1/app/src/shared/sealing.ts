// The published sealing scheme, implemented once for every browser and test. DP-08, DP-45.
// Everything runs on the built-in Web Crypto interface: no third-party cryptography.
import { b64urlDecode, b64urlEncode, bytesToHex } from './b64.js';
import { BLOCK_BYTES, GCM_TAG_BYTES, IV_BYTES } from './sealing-spec.js';

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer));
}

export async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', data as unknown as ArrayBuffer));
}

async function hkdf(info: Uint8Array, secret: Uint8Array, salt: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', secret as unknown as ArrayBuffer, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as ArrayBuffer, info: info as unknown as ArrayBuffer }, key, length * 8);
  return new Uint8Array(bits);
}

/** The body is padded with 0x80 then 0x00 up to the next multiple of 160 bytes; padding is always added. */
export function padBody(bytes: Uint8Array): Uint8Array {
  const blocks = Math.floor(bytes.length / BLOCK_BYTES) + 1;
  const total = blocks * BLOCK_BYTES;
  const out = new Uint8Array(total);
  out.set(bytes);
  out[bytes.length] = 0x80;
  return out;
}

export function unpadBody(bytes: Uint8Array): Uint8Array {
  const paddedLength = bytes.lastIndexOf(0x80);
  if (paddedLength < 0) throw new Error('bad padding');
  return bytes.slice(0, paddedLength);
}

async function aesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as unknown as ArrayBuffer, 'AES-GCM', false, usages);
}

/** AES-256-GCM with a random 12-byte IV, no additional data, the 16-byte tag appended. */
export async function sealBytes(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await aesKey(key, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer, tagLength: 128 }, cryptoKey, plaintext as unknown as ArrayBuffer));
  return sealed;
}

export async function openBytes(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < GCM_TAG_BYTES) throw new Error('too short');
  const cryptoKey = await aesKey(key, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer, tagLength: 128 }, cryptoKey, sealed as unknown as ArrayBuffer);
  return new Uint8Array(plaintext);
}

/** Identity keys: ECDH P-256, raw 65-byte uncompressed points, key id from SHA-256. */
export async function generateIdentityKey(): Promise<{ publicKey: Uint8Array; keyId: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  if (raw.length !== 65) throw new Error('unexpected point length');
  return { publicKey: raw, keyId: await keyIdFor(raw), privateKey: pair.privateKey };
}

export async function keyIdFor(publicKey: Uint8Array): Promise<string> {
  const digest = await sha256(publicKey);
  return b64urlEncode(digest.slice(0, 12));
}

/** A P-256 point that is valid: 65 bytes, 0x04 prefix. Full curve validation happens on import. */
export function isWellFormedPoint(publicKey: Uint8Array): boolean {
  return publicKey.length === 65 && publicKey[0] === 0x04;
}

export async function importPeerPublicKey(publicKey: Uint8Array): Promise<CryptoKey> {
  if (!isWellFormedPoint(publicKey)) throw new Error('bad point');
  try {
    return await crypto.subtle.importKey('raw', publicKey as unknown as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  } catch {
    throw new Error('bad point');
  }
}

/** ECDH then HKDF-SHA-256 gives the conversation key. Salt: SHA-256 of the sorted ids joined with ':'. */
export async function conversationKey(
  privateKey: CryptoKey,
  peerPublicKey: Uint8Array,
  myAccountId: string,
  peerAccountId: string,
): Promise<Uint8Array> {
  const peer = await importPeerPublicKey(peerPublicKey);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256));
  const sorted = [myAccountId, peerAccountId].sort();
  const salt = await sha256(utf8(sorted.join(':')));
  const info = utf8('airfold/v1/msg');
  return hkdf(info, shared, salt, 32);
}

/** Seals a padded JSON body with a random IV. */
export async function sealBody(key: Uint8Array, bodyJson: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(IV_BYTES);
  const padded = padBody(utf8(bodyJson));
  const sealed = await sealBytes(key, iv, padded);
  return { iv: b64urlEncode(iv), ciphertext: b64urlEncode(sealed) };
}

export async function openBody(key: Uint8Array, iv: string, ciphertext: string): Promise<string> {
  const plaintext = await openBytes(key, b64urlDecode(iv), b64urlDecode(ciphertext));
  return new TextDecoder().decode(unpadBody(plaintext));
}

/** Crockford base32 recovery code: 20 random bytes as 32 characters in 8 groups of 4. */
export function generateRecoveryCode(): { bytes: Uint8Array; grouped: string; canonical: string } {
  const entropy = randomBytes(20);
  let value = 0n;
  for (const byte of entropy) value = (value << 8n) | BigInt(byte);
  // 20 bytes = 160 bits; Crockford base32 gives 32 chars.
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let chars = '';
  let v = value;
  for (let i = 0; i < 32; i++) {
    chars = alphabet[Number(v & 31n)] + chars;
    v >>= 5n;
  }
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) groups.push(chars.slice(i * 4, i * 4 + 4));
  return { bytes: entropy, grouped: groups.join('-'), canonical: chars };
}

export function canonicalRecoveryCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[-\s]/g, '');
  let out = '';
  for (const ch of stripped) {
    if (ch === 'I' || ch === 'L') out += '1';
    else if (ch === 'O') out += '0';
    else out += ch;
  }
  return out;
}

export async function recoveryVerifier(canonicalCode: string): Promise<Uint8Array> {
  return hkdf(utf8('airfold/v1/recovery-verifier'), utf8(canonicalCode), utf8('airfold/v1/recovery'), 32);
}

export async function recoveryBackupKey(canonicalCode: string): Promise<Uint8Array> {
  return hkdf(utf8('airfold/v1/key-backup'), utf8(canonicalCode), utf8('airfold/v1/recovery'), 32);
}

/** The 60-digit seal number: 12 groups of 5 from SHA-512 of the sorted raw public keys. */
export async function sealNumber(myPublicKey: Uint8Array, peerPublicKey: Uint8Array): Promise<string> {
  const pair = [myPublicKey, peerPublicKey].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  });
  const digest = await sha512(concatBytes(pair[0], pair[1]));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    let value = 0;
    for (let j = 0; j < 5; j++) value = value * 256 + digest[i * 5 + j];
    groups.push((value % 100000).toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

/** For tests and diagnostics: the hex digest of a byte array. */
export function hexOf(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}
