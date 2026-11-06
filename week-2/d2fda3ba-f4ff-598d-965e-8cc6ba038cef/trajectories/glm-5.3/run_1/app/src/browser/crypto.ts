/** Client-side vault cryptography: the server never sees a vault key or passphrase. */

const ENVELOPE_MAGIC = 'CRN1';
const PBKDF2_ITERATIONS = 600_000;

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const stringToRaw = (s: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export interface KeyEnvelope {
  salt: string;
  iterations: number;
  iv: string;
  wrapped_key: string;
}

export const deriveWrappingKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> => {
  const base = await crypto.subtle.importKey('raw', stringToRaw(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  );
};

/** Create a fresh vault key and wrap it with a key derived from the passphrase. */
export const createVaultKey = async (passphrase: string): Promise<{ envelope: KeyEnvelope; rawKey: string }> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapping = await deriveWrappingKey(passphrase, salt);
  const wrapped = await crypto.subtle.wrapKey('raw', key, wrapping, { name: 'AES-GCM', iv: iv as BufferSource });
  const raw = await crypto.subtle.exportKey('raw', key);
  return {
    envelope: { salt: b64(salt), iterations: PBKDF2_ITERATIONS, iv: b64(iv), wrapped_key: b64(wrapped) },
    rawKey: b64(raw),
  };
};

export const unwrapVaultKey = async (passphrase: string, envelope: KeyEnvelope): Promise<CryptoKey | null> => {
  try {
    const wrapping = await deriveWrappingKey(passphrase, unb64(envelope.salt));
    const key = await crypto.subtle.unwrapKey(
      'raw',
      unb64(envelope.wrapped_key) as BufferSource,
      wrapping,
      { name: 'AES-GCM', iv: unb64(envelope.iv) as BufferSource },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return key;
  } catch {
    return null;
  }
};

export const importRawKey = async (rawB64: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', unb64(rawB64) as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export interface NotePlain {
  id: string;
  title: string;
  aliases: string[];
  frontmatter: Record<string, string>;
  body: string;
  private: boolean;
  createdAt: number;
}

const MAGIC_BYTES = stringToRaw(ENVELOPE_MAGIC);

/** Encrypt a note to the CRN1 envelope: magic, IV, ciphertext+tag. */
export const encryptNote = async (key: CryptoKey, note: NotePlain): Promise<Uint8Array> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(note));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC_BYTES, 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
};

export const decryptNote = async (key: CryptoKey, blob: Uint8Array): Promise<NotePlain | null> => {
  try {
    const iv = blob.slice(4, 16);
    const ct = blob.slice(16);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain)) as NotePlain;
  } catch {
    return null;
  }
};

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

export const rawKeyToString = (key: CryptoKey): Promise<string> =>
  crypto.subtle.exportKey('raw', key).then((raw) => b64(raw));

