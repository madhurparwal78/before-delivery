// The browser's identity and sealing service. DP-08, DP-45: everything happens here with Web Crypto.
import { b64urlDecode, b64urlEncode } from '../shared/b64.js';
import {
  canonicalRecoveryCode,
  conversationKey as deriveConversationKey,
  generateRecoveryCode,
  keyIdFor,
  openBody,
  openBytes,
  recoveryBackupKey,
  recoveryVerifier,
  sealBody,
  sealBytes,
  sealNumber as deriveSealNumber,
  sha256,
} from '../shared/sealing.js';
import type { Attachment, LetterBody } from '../shared/types.js';
import { getIdentity, putIdentity, type StoredIdentity } from './store.js';

export interface Identity {
  privateKey: CryptoKey;
  publicKey: string;
  keyId: string;
  accountId: string;
  username: string;
  profileKey: Uint8Array | null;
}

export interface GeneratedPair {
  privateKey: CryptoKey; // extractable, only long enough to make the recovery backup
  publicKey: Uint8Array;
}

export async function createIdentityKeyPair(): Promise<GeneratedPair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: raw };
}

/** Stores the private key as non-extractable in the browser's own IndexedDB. */
export async function storeIdentityFromPair(pair: GeneratedPair, accountId: string, username: string, profileKey: Uint8Array | null): Promise<Identity> {
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const nonExtractable = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicKey = b64urlEncode(pair.publicKey);
  const keyId = await keyIdFor(pair.publicKey);
  const stored: StoredIdentity = { kind: 'identity', privateKey: nonExtractable, publicKey, keyId, accountId, username, profileKey };
  await putIdentity(stored);
  return { privateKey: nonExtractable, publicKey, keyId, accountId, username, profileKey };
}

export async function updateProfileKey(identity: Identity, profileKey: Uint8Array): Promise<void> {
  const stored = await getIdentity();
  if (!stored) return;
  stored.profileKey = profileKey;
  await putIdentity(stored);
  identity.profileKey = profileKey;
}

export async function currentIdentity(): Promise<Identity | null> {
  const stored = await getIdentity();
  if (!stored) return null;
  return { privateKey: stored.privateKey, publicKey: stored.publicKey, keyId: stored.keyId, accountId: stored.accountId, username: stored.username, profileKey: stored.profileKey };
}

export interface RecoveryMaterial {
  grouped: string;
  canonical: string;
  verifier: string;
  backupKey: Uint8Array;
}

export async function makeRecoveryMaterial(): Promise<RecoveryMaterial> {
  const code = generateRecoveryCode();
  const canonical = canonicalRecoveryCode(code.grouped);
  const verifier = b64urlEncode(await recoveryVerifier(canonical));
  const backupKey = await recoveryBackupKey(canonical);
  return { grouped: code.grouped, canonical, verifier, backupKey };
}

export async function verifierFor(canonical: string): Promise<string> {
  return b64urlEncode(await recoveryVerifier(canonical));
}

export async function backupKeyFor(canonical: string): Promise<Uint8Array> {
  return recoveryBackupKey(canonical);
}

/** key_backup: the PKCS#8 private key sealed with the backup key, made once at creation. */
export async function sealKeyBackup(privateKey: CryptoKey, backupKey: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await sealBytes(backupKey, iv, pkcs8);
  return { iv: b64urlEncode(iv), ciphertext: b64urlEncode(sealed) };
}

export async function openKeyBackup(iv: string, ciphertext: string, backupKey: Uint8Array): Promise<CryptoKey> {
  const pkcs8 = await openBytes(backupKey, b64urlDecode(iv), b64urlDecode(ciphertext));
  return crypto.subtle.importKey('pkcs8', pkcs8 as unknown as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

export async function conversationKeyFor(privateKey: CryptoKey, peerPublicKey: string, myAccountId: string, peerAccountId: string): Promise<Uint8Array> {
  return deriveConversationKey(privateKey, b64urlDecode(peerPublicKey), myAccountId, peerAccountId);
}

export async function sealLetterBody(key: Uint8Array, body: LetterBody): Promise<{ iv: string; ciphertext: string; bodyJson: string }> {
  const bodyJson = JSON.stringify(body);
  const sealed = await sealBody(key, bodyJson);
  return { iv: sealed.iv, ciphertext: sealed.ciphertext, bodyJson };
}

export async function openLetterBody(key: Uint8Array, iv: string, ciphertext: string): Promise<LetterBody> {
  const json = await openBody(key, iv, ciphertext);
  return JSON.parse(json) as LetterBody;
}

export async function sealAttachmentBytes(bytes: Uint8Array): Promise<{ key: Uint8Array; iv: Uint8Array; sealed: Uint8Array; digest: string }> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await sealBytes(key, iv, bytes);
  const digest = b64urlEncode(await sha256(sealed));
  return { key, iv, sealed, digest };
}

export async function openAttachmentBytes(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  return openBytes(key, iv, sealed);
}

export async function digestOf(bytes: Uint8Array): Promise<string> {
  return b64urlEncode(await sha256(bytes));
}

export async function sealNumberFor(identity: Identity, peerPublicKey: string): Promise<string> {
  return deriveSealNumber(b64urlDecode(identity.publicKey), b64urlDecode(peerPublicKey));
}

export interface ProfilePayload {
  display_name: string;
  photo: null | { blob_id: string; key: string; iv: string; digest: string; type: string };
}

/** The profile is padded like a letter and sealed with the account's profile key. */
export async function sealProfilePayload(profileKey: Uint8Array, payload: ProfilePayload): Promise<{ iv: string; ciphertext: string; json: string }> {
  const json = JSON.stringify({ v: 1, ...payload });
  const sealed = await sealBody(profileKey, json);
  return { iv: sealed.iv, ciphertext: sealed.ciphertext, json };
}

export async function openProfilePayload(profileKey: Uint8Array, iv: string, ciphertext: string): Promise<ProfilePayload> {
  const json = await openBody(profileKey, iv, ciphertext);
  return JSON.parse(json) as ProfilePayload;
}

export function attachmentOf(body: LetterBody): Attachment | null {
  if (body.kind === 'image' || body.kind === 'file') return body.attachment;
  return null;
}

export function profileKeyB64(key: Uint8Array): string {
  return b64urlEncode(key);
}

export function profileKeyFromB64(text: string): Uint8Array {
  return b64urlDecode(text);
}
