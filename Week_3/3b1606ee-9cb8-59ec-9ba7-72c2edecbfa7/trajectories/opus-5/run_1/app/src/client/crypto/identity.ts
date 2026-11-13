import { base64urlEncode } from '../../shared/scheme.js';
import { keyIdFor, openBytes, sealBytes, type Sealed } from './seal.js';

const subtle = crypto.subtle;

export interface Identity {
  rawPublicKey: Uint8Array;
  publicKey: string;
  keyId: string;
  /** Kept non-extractable, exactly as the scheme requires. */
  privateKey: CryptoKey;
  keyBackup: Sealed;
}

async function importPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
}

/**
 * Makes an identity key pair. The private key is exported once, to seal the key backup
 * with the recovery code's backup key, and then kept only as a non-extractable key.
 */
export async function createIdentity(backupKey: CryptoKey): Promise<Identity> {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const rawPublicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const keyBackup = await sealBytes(backupKey, pkcs8);
  const privateKey = await importPrivateKey(pkcs8);
  pkcs8.fill(0);
  return {
    rawPublicKey,
    publicKey: base64urlEncode(rawPublicKey),
    keyId: await keyIdFor(rawPublicKey),
    privateKey,
    keyBackup,
  };
}

/** Opens a key backup from the recovery code, for letters held for an earlier key. */
export async function openKeyBackup(backupKey: CryptoKey, sealed: Sealed): Promise<CryptoKey> {
  return importPrivateKey(await openBytes(backupKey, sealed));
}
