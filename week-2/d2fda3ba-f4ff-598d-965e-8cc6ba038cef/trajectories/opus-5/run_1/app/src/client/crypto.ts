import {
  ENVELOPE_IV_BYTES,
  ENVELOPE_MAGIC,
  VAULT_KEY_ITERATIONS,
  VAULT_SALT_BYTES,
  type NotePlaintext,
} from '../shared/envelope';

export interface KeyEnvelope {
  salt: string;
  iterations: number;
  iv: string;
  wrapped_key: string;
}

export interface SealedNote {
  ciphertext: string;
  ciphertext_sha256: string;
}

const MAGIC = new TextEncoder().encode(ENVELOPE_MAGIC);

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function passphraseKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** Creates a vault key in the browser and wraps it with a key derived from the passphrase. */
export async function createVaultKey(passphrase: string): Promise<{ key: CryptoKey; envelope: KeyEnvelope }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = crypto.getRandomValues(new Uint8Array(VAULT_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(ENVELOPE_IV_BYTES));
  const wrapping = await passphraseKey(passphrase, salt, VAULT_KEY_ITERATIONS);
  const wrapped = await crypto.subtle.wrapKey('raw', key, wrapping, {
    name: 'AES-GCM',
    iv: iv as unknown as ArrayBuffer,
  });
  return {
    key,
    envelope: {
      salt: toBase64(salt),
      iterations: VAULT_KEY_ITERATIONS,
      iv: toBase64(iv),
      wrapped_key: toBase64(new Uint8Array(wrapped)),
    },
  };
}

/** Unwraps a vault key with the vault passphrase. Rejects when the passphrase is wrong. */
export async function unwrapVaultKey(envelope: KeyEnvelope, passphrase: string): Promise<CryptoKey> {
  const wrapping = await passphraseKey(passphrase, fromBase64(envelope.salt), envelope.iterations);
  return crypto.subtle.unwrapKey(
    'raw',
    fromBase64(envelope.wrapped_key) as unknown as ArrayBuffer,
    wrapping,
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) as unknown as ArrayBuffer },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** `CRN1` + a fresh 12-byte IV + AES-GCM ciphertext with its tag. */
export async function sealNote(key: CryptoKey, plaintext: NotePlaintext): Promise<SealedNote> {
  const iv = crypto.getRandomValues(new Uint8Array(ENVELOPE_IV_BYTES));
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    encoded as unknown as ArrayBuffer,
  );
  const blob = new Uint8Array(MAGIC.length + iv.length + sealed.byteLength);
  blob.set(MAGIC, 0);
  blob.set(iv, MAGIC.length);
  blob.set(new Uint8Array(sealed), MAGIC.length + iv.length);
  return { ciphertext: toBase64(blob), ciphertext_sha256: await sha256Hex(blob) };
}

export async function openNote(key: CryptoKey, blob: ArrayBuffer): Promise<NotePlaintext> {
  const bytes = new Uint8Array(blob);
  const iv = bytes.slice(MAGIC.length, MAGIC.length + ENVELOPE_IV_BYTES);
  const payload = bytes.slice(MAGIC.length + ENVELOPE_IV_BYTES);
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    payload as unknown as ArrayBuffer,
  );
  return JSON.parse(new TextDecoder().decode(opened)) as NotePlaintext;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function newIdempotencyKey(): string {
  return `cairn-${crypto.randomUUID().replace(/-/g, '')}`;
}
