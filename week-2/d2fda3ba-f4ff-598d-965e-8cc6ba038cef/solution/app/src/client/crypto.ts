// Client-side encryption with the platform's Web Crypto (Business rules: "Encrypted envelope").
// The vault key never leaves the browser unwrapped; the server sees only the wrapped envelope.
import type { KeyEnvelope } from "../shared/types.ts";

const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 12;
const MAGIC = new TextEncoder().encode("CRN1");

/** The plaintext of one note revision: encrypted as one JSON object. */
export interface NotePayload {
  title: string;
  aliases: string[];
  frontmatter: Record<string, string>;
  body: string;
  private: boolean;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material,
    { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

/** A fresh 256-bit vault key and its envelope, wrapped with a key derived from the passphrase. */
export async function createVaultKey(passphrase: string): Promise<{ key: CryptoKey; envelope: KeyEnvelope }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const vaultKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const kek = await passphraseKey(passphrase, salt, PBKDF2_ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey("raw", vaultKey, kek, { name: "AES-GCM", iv }));
  const envelope = { salt: toBase64(salt), iterations: PBKDF2_ITERATIONS, iv: toBase64(iv), wrapped_key: toBase64(wrapped) };
  return { key: await unwrapVaultKey(passphrase, envelope), envelope };
}

/** The vault key as a non-extractable CryptoKey; rejects when the passphrase is wrong. */
export async function unwrapVaultKey(passphrase: string, envelope: KeyEnvelope): Promise<CryptoKey> {
  const kek = await passphraseKey(passphrase, fromBase64(envelope.salt), envelope.iterations);
  return crypto.subtle.unwrapKey("raw", fromBase64(envelope.wrapped_key), kek, { name: "AES-GCM", iv: fromBase64(envelope.iv) },
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

interface SealedRevision {
  ciphertext: string;
  ciphertext_sha256: string;
}

/** CRN1 ‖ 12-byte IV ‖ AES-GCM ciphertext with its tag, base64-encoded, plus the SHA-256 of those bytes. */
export async function sealNote(key: CryptoKey, payload: NotePayload): Promise<SealedRevision> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload))));
  const blob = new Uint8Array(MAGIC.length + iv.length + sealed.length);
  blob.set(MAGIC, 0);
  blob.set(iv, MAGIC.length);
  blob.set(sealed, MAGIC.length + iv.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", blob));
  return { ciphertext: toBase64(blob), ciphertext_sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

export async function openNote(key: CryptoKey, blob: Uint8Array<ArrayBuffer>): Promise<NotePayload> {
  const iv = blob.subarray(4, 16);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, blob.subarray(16));
  return JSON.parse(new TextDecoder().decode(plain)) as NotePayload;
}
