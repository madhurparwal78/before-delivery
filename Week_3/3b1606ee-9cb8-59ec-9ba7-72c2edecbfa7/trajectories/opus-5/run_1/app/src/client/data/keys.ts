import { base64urlDecode } from '../../shared/scheme.js';
import { conversationKey, importPublicKey } from '../crypto/seal.js';
import { api } from './api.js';
import { idbGet, idbPut, STORES } from './idb.js';

interface StoredIdentity {
  accountId: string;
  keyId: string;
}

interface Identity {
  accountId: string;
  keyId: string;
  privateKeys: Map<string, CryptoKey>;
  profileKey: Uint8Array;
}

let identity: Identity | null = null;

const peerPublicKeys = new Map<string, CryptoKey>();
const conversationKeys = new Map<string, CryptoKey>();

export function currentIdentity(): Identity | null {
  return identity;
}

export function requireIdentity(): Identity {
  if (identity === null) throw new Error('no identity in this browser');
  return identity;
}

export async function loadIdentity(): Promise<Identity | null> {
  const stored = await idbGet<StoredIdentity>(STORES.identity, 'account');
  if (stored === undefined) return null;
  const keys = new Map<string, CryptoKey>();
  const privateKeys = await idbGet<Record<string, CryptoKey>>(STORES.privateKeys, stored.accountId);
  for (const [keyId, key] of Object.entries(privateKeys ?? {})) keys.set(keyId, key);
  const profileKey = await idbGet<Uint8Array>(STORES.profileKeys, 'me');
  if (profileKey === undefined || keys.size === 0) return null;
  identity = { accountId: stored.accountId, keyId: stored.keyId, privateKeys: keys, profileKey };
  return identity;
}

async function persistPrivateKeys(current: Identity): Promise<void> {
  const record: Record<string, CryptoKey> = {};
  for (const [keyId, key] of current.privateKeys) record[keyId] = key;
  await idbPut(STORES.privateKeys, record, current.accountId);
  await idbPut(STORES.identity, { accountId: current.accountId, keyId: current.keyId }, 'account');
  await idbPut(STORES.profileKeys, current.profileKey, 'me');
}

export async function saveIdentity(
  accountId: string,
  keyId: string,
  privateKey: CryptoKey,
  profileKey: Uint8Array,
  earlierKeys: Map<string, CryptoKey> = new Map(),
): Promise<void> {
  const keys = new Map(earlierKeys);
  keys.set(keyId, privateKey);
  identity = { accountId, keyId, privateKeys: keys, profileKey };
  conversationKeys.clear();
  await persistPrivateKeys(identity);
}

export async function savePeerProfileKey(accountId: string, key: Uint8Array): Promise<void> {
  await idbPut(STORES.profileKeys, key, accountId);
}

export async function peerProfileKey(accountId: string): Promise<Uint8Array | null> {
  return (await idbGet<Uint8Array>(STORES.profileKeys, accountId)) ?? null;
}

/** Caches each account's public keys by key id so earlier keys keep opening letters. */
export async function publicKeyFor(accountId: string, keyId: string): Promise<CryptoKey | null> {
  const cached = peerPublicKeys.get(keyId);
  if (cached !== undefined) return cached;
  const { keys } = await api.keys(accountId);
  for (const key of keys) {
    peerPublicKeys.set(key.key_id, await importPublicKey(base64urlDecode(key.public_key)));
  }
  return peerPublicKeys.get(keyId) ?? null;
}

export async function rememberPublicKey(keyId: string, publicKey: string): Promise<void> {
  if (peerPublicKeys.has(keyId)) return;
  peerPublicKeys.set(keyId, await importPublicKey(base64urlDecode(publicKey)));
}

/** The conversation key for the named pair of identity keys. */
export async function keyFor(
  peerId: string,
  peerKeyId: string,
  myKeyId: string,
): Promise<CryptoKey | null> {
  const me = requireIdentity();
  const cacheKey = `${peerKeyId}|${myKeyId}`;
  const cached = conversationKeys.get(cacheKey);
  if (cached !== undefined) return cached;

  const privateKey = me.privateKeys.get(myKeyId);
  const peerPublic = await publicKeyFor(peerId, peerKeyId);
  if (privateKey === undefined || peerPublic === null) return null;
  const derived = await conversationKey(privateKey, peerPublic, me.accountId, peerId);
  conversationKeys.set(cacheKey, derived);
  return derived;
}
