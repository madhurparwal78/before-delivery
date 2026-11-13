import { IV_BYTES, PAD_BLOCK } from '../../shared/sealing';
import { fromBase64url, toBase64url } from '../lib/base64';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Sealed {
  iv: string;
  ciphertext: string;
}

/** Every body is padded with 0x80 then zeros to the next multiple of 160 bytes, always adding at least one byte. */
function pad(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const padded = new Uint8Array((Math.floor(bytes.length / PAD_BLOCK) + 1) * PAD_BLOCK);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  return padded;
}

function unpad(bytes: Uint8Array): Uint8Array {
  let end = bytes.length - 1;
  while (end >= 0 && bytes[end] === 0) end -= 1;
  if (end < 0 || bytes[end] !== 0x80) throw new Error('sealed body is not padded as published');
  return bytes.subarray(0, end);
}

export function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Seals a JSON body: UTF-8, padded, AES-256-GCM with a random 12-byte IV, no additional data. */
export async function sealBody(key: CryptoKey, body: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pad(encoder.encode(JSON.stringify(body))));
  return { iv: toBase64url(iv), ciphertext: toBase64url(sealed) };
}

export async function openBody<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(sealed.iv) }, key, fromBase64url(sealed.ciphertext));
  return JSON.parse(decoder.decode(unpad(new Uint8Array(plain)))) as T;
}

interface SealedFile {
  key: string;
  iv: string;
  sealed: Uint8Array<ArrayBuffer>;
  digest: string;
}

/** An attachment is the raw bytes sealed with its own random key and IV, unpadded; the digest is of the sealed bytes. */
export async function sealFile(plain: Uint8Array<ArrayBuffer>): Promise<SealedFile> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), plain));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', sealed));
  return { key: toBase64url(key), iv: toBase64url(iv), sealed, digest: toBase64url(digest) };
}

type FileOpening = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false };

/** Checks the sealed bytes against the digest sealed in the letter, then unseals. A mismatch discards the bytes. */
export async function openFile(sealed: ArrayBuffer, attachment: { key: string; iv: string; digest: string }): Promise<FileOpening> {
  const digest = toBase64url(await crypto.subtle.digest('SHA-256', sealed));
  if (digest !== attachment.digest) return { ok: false };
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(attachment.iv) }, await aesKey(fromBase64url(attachment.key)), sealed);
    return { ok: true, bytes: new Uint8Array(plain) };
  } catch {
    return { ok: false };
  }
}
