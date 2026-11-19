import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.js';

function encryptionKey(): Buffer {
  if (config.secretKeyHex !== null) {
    if (!/^[0-9a-fA-F]{64}$/.test(config.secretKeyHex)) throw new Error('Bad configuration: LOCKSET_SECRET_KEY');
    return Buffer.from(config.secretKeyHex, 'hex');
  }
  return Buffer.from(hkdfSync('sha256', config.keycloak.clientSecret, 'lockset-secret-store', 'lockset-login-secret', 32));
}

const key = encryptionKey();

/** Login secrets are stored only in encrypted form. */
export function sealSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64');
}

export function openSecret(stored: string): string {
  const raw = Buffer.from(stored, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** The uppercase SHA-1 of a secret, computed in memory and never stored. */
export function secretHash(secret: string): { prefix: string; suffix: string } {
  const digest = createHash('sha1').update(secret, 'utf8').digest('hex').toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

export function newId(): string {
  return randomUUID();
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function hashBody(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}
