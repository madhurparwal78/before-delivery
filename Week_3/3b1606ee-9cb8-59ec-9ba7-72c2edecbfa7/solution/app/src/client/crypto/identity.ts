import { fromBase64url, toBase64url } from '../lib/base64';
import { aesKey, type Sealed } from './sealing';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const encoder = new TextEncoder();
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

const RECOVERY_BYTES = 20;
export const RECOVERY_GROUPS = 8;

/** 20 random bytes as 32 Crockford base32 characters, shown as 8 groups of 4 joined by hyphens. */
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_BYTES));
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let chars = '';
  for (let at = 31; at >= 0; at -= 1) chars += CROCKFORD[Number((bits >> BigInt(at * 5)) & 31n)];
  return chars.match(/.{4}/g)!.join('-');
}

/** Uppercase, hyphens and spaces removed, I and L read as 1, O read as 0. */
function canonicalRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

export function canonicalGroup(group: string): string {
  return canonicalRecoveryCode(group);
}

export interface RecoveryKeys {
  verifier: string;
  backupKey: CryptoKey;
}

export async function recoveryKeys(code: string): Promise<RecoveryKeys> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(canonicalRecoveryCode(code)), 'HKDF', false, ['deriveBits']);
  const derive = (info: string): Promise<ArrayBuffer> =>
    crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('airfold/v1/recovery'), info: encoder.encode(info) }, material, 256);
  return {
    verifier: toBase64url(await derive('airfold/v1/recovery-verifier')),
    backupKey: await aesKey(new Uint8Array(await derive('airfold/v1/key-backup'))),
  };
}

export interface NewIdentity {
  publicKey: string;
  keyId: string;
  privateKey: CryptoKey;
  keyBackup: Sealed;
}

async function keyIdOf(publicKey: string): Promise<string> {
  return toBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64url(publicKey))).subarray(0, 12));
}

/**
 * Makes an identity key pair. The private key is exported exactly once, as PKCS#8, to seal the key backup;
 * what is kept is a non-extractable CryptoKey imported from those bytes.
 */
export async function newIdentity(backupKey: CryptoKey): Promise<NewIdentity> {
  const pair = await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const publicKey = toBase64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, backupKey, pkcs8);
  return {
    publicKey,
    keyId: await keyIdOf(publicKey),
    privateKey: await crypto.subtle.importKey('pkcs8', pkcs8, P256, false, ['deriveBits']),
    keyBackup: { iv: toBase64url(iv), ciphertext: toBase64url(sealed) },
  };
}

/** Opens an earlier key's backup into a non-extractable private key. */
export async function openKeyBackup(backupKey: CryptoKey, backup: Sealed): Promise<CryptoKey> {
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(backup.iv) }, backupKey, fromBase64url(backup.ciphertext));
  return crypto.subtle.importKey('pkcs8', pkcs8, P256, false, ['deriveBits']);
}

const conversationKeys = new Map<string, Promise<CryptoKey>>();

/**
 * ECDH between my private key and the peer's public key, then HKDF-SHA-256 to an AES-256-GCM key. The salt is the
 * SHA-256 of the two account ids, sorted and joined with a colon; the info is `airfold/v1/msg`.
 */
export function conversationKey(privateKey: CryptoKey, privateKeyId: string, peerPublicKey: string, accountIds: [string, string]): Promise<CryptoKey> {
  const salt = [...accountIds].sort().join(':');
  const cacheKey = `${privateKeyId}|${peerPublicKey}|${salt}`;
  const cached = conversationKeys.get(cacheKey);
  if (cached) return cached;
  const made = (async () => {
    const peer = await crypto.subtle.importKey('raw', fromBase64url(peerPublicKey), P256, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: await crypto.subtle.digest('SHA-256', encoder.encode(salt)), info: encoder.encode('airfold/v1/msg') },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  conversationKeys.set(cacheKey, made);
  made.catch(() => conversationKeys.delete(cacheKey));
  return made;
}

/** SHA-512 of the two raw public keys sorted bytewise and joined; twelve groups of five digits. */
export async function sealNumber(keyA: string, keyB: string): Promise<string> {
  const [first, second] = [fromBase64url(keyA), fromBase64url(keyB)].sort(compareBytes);
  const joined = new Uint8Array(first!.length + second!.length);
  joined.set(first!);
  joined.set(second!, first!.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-512', joined));
  const groups: string[] = [];
  for (let group = 0; group < 12; group += 1) {
    let value = 0n;
    for (let at = 0; at < 5; at += 1) value = value * 256n + BigInt(hash[group * 5 + at]!);
    groups.push(String(value % 100000n).padStart(5, '0'));
  }
  return groups.join(' ');
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) if (a[at] !== b[at]) return a[at]! - b[at]!;
  return a.length - b.length;
}

export function newProfileKey(): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(32)));
}
