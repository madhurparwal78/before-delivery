import {
  base64urlDecode,
  base64urlEncode,
  HKDF_MESSAGE_INFO,
  IV_BYTES,
  KEY_ID_BYTES,
  pad,
  PROFILE_KEY_BYTES,
  unpad,
} from '../../shared/scheme.js';
import type { LetterBody, ProfileBody } from '../../shared/types.js';

/** Everything here runs in the browser with the built-in Web Crypto interface. */

const subtle = crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Sealed {
  iv: string;
  ciphertext: string;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function keyIdFor(rawPublicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', rawPublicKey));
  return base64urlEncode(digest.subarray(0, KEY_ID_BYTES));
}

export async function digestOf(bytes: Uint8Array): Promise<string> {
  return base64urlEncode(new Uint8Array(await subtle.digest('SHA-256', bytes)));
}

export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

async function hkdf(
  secret: Uint8Array,
  salt: Uint8Array,
  info: string,
  bytes: number,
): Promise<Uint8Array> {
  const material = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const derived = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) },
    material,
    bytes * 8,
  );
  return new Uint8Array(derived);
}

/** ECDH between the named key pair, then HKDF over the sorted account ids. */
export async function conversationKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  myAccountId: string,
  peerAccountId: string,
): Promise<CryptoKey> {
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256),
  );
  const ids = [myAccountId, peerAccountId].sort().join(':');
  const salt = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(ids)));
  const derived = await hkdf(shared, salt, HKDF_MESSAGE_INFO, 32);
  return subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealBytes(key: CryptoKey, bytes: Uint8Array): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes),
  );
  return { iv: base64urlEncode(iv), ciphertext: base64urlEncode(ciphertext) };
}

export async function openBytes(key: CryptoKey, sealed: Sealed): Promise<Uint8Array> {
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: base64urlDecode(sealed.iv) },
    key,
    base64urlDecode(sealed.ciphertext),
  );
  return new Uint8Array(plain);
}

export async function sealLetterBody(key: CryptoKey, body: LetterBody): Promise<Sealed> {
  return sealBytes(key, pad(encoder.encode(JSON.stringify(body))));
}

export async function openLetterBody(key: CryptoKey, sealed: Sealed): Promise<LetterBody> {
  const padded = await openBytes(key, sealed);
  return JSON.parse(decoder.decode(unpad(padded))) as LetterBody;
}

export async function sealProfile(key: CryptoKey, profile: ProfileBody): Promise<Sealed> {
  return sealBytes(key, pad(encoder.encode(JSON.stringify(profile))));
}

export async function openProfile(key: CryptoKey, sealed: Sealed): Promise<ProfileBody> {
  const padded = await openBytes(key, sealed);
  return JSON.parse(decoder.decode(unpad(padded))) as ProfileBody;
}

export function newProfileKey(): Uint8Array {
  return randomBytes(PROFILE_KEY_BYTES);
}

/** Sealed attachment bytes carry no padding. */
export async function sealAttachment(
  bytes: Uint8Array,
): Promise<{ key: Uint8Array; iv: Uint8Array; sealed: Uint8Array; digest: string }> {
  const keyBytes = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const key = await importAesKey(keyBytes);
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { key: keyBytes, iv, sealed, digest: await digestOf(sealed) };
}

export async function openAttachment(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  sealed: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(keyBytes);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed);
  return new Uint8Array(plain);
}

/** The 60-digit seal number, in 12 groups of 5. */
export async function sealNumber(rawA: Uint8Array, rawB: Uint8Array): Promise<string> {
  const first = compareBytes(rawA, rawB) <= 0 ? rawA : rawB;
  const second = first === rawA ? rawB : rawA;
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  const digest = new Uint8Array(await subtle.digest('SHA-512', joined));
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    let value = 0n;
    for (const byte of digest.subarray(i * 5, i * 5 + 5)) value = (value << 8n) | BigInt(byte);
    groups.push(String(value % 100000n).padStart(5, '0'));
  }
  return groups.join(' ');
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] as number;
    const right = b[i] as number;
    if (left !== right) return left - right;
  }
  return a.length - b.length;
}

export { base64urlDecode, base64urlEncode };
