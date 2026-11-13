import {
  base64urlEncode,
  CROCKFORD_ALPHABET,
  RECOVERY_BACKUP_INFO,
  RECOVERY_CODE_BYTES,
  RECOVERY_SALT,
  RECOVERY_VERIFIER_INFO,
} from '../../shared/scheme.js';
import { importAesKey, randomBytes } from './seal.js';

const encoder = new TextEncoder();

/** 20 random bytes as 32 Crockford base32 characters, shown in 8 groups of 4. */
export function newRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_BYTES);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return (out.match(/.{4}/g) ?? []).join('-');
}

export function canonicalRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function recoveryGroups(code: string): string[] {
  return code.split('-');
}

async function hkdf(info: string, canonical: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(canonical), 'HKDF', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(RECOVERY_SALT),
      info: encoder.encode(info),
    },
    material,
    256,
  );
  return new Uint8Array(derived);
}

export interface RecoveryMaterial {
  verifier: string;
  backupKey: CryptoKey;
}

export async function recoveryMaterial(code: string): Promise<RecoveryMaterial> {
  const canonical = canonicalRecoveryCode(code);
  const verifier = await hkdf(RECOVERY_VERIFIER_INFO, canonical);
  const backup = await hkdf(RECOVERY_BACKUP_INFO, canonical);
  return { verifier: base64urlEncode(verifier), backupKey: await importAesKey(backup) };
}
