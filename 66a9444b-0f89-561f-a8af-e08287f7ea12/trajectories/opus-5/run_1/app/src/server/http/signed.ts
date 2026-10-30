import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { ApiError, notFound } from '../lib/errors.js';
import { toUtcIso } from '../lib/time.js';
import { appSecret } from './secret.js';

interface TokenPayload {
  key: string;
  expiresAt: number;
}

export interface SignedLink {
  url: string;
  expires_at: string;
}

async function tokenKey(): Promise<Buffer> {
  return createHash('sha256').update(`signed-read:${await appSecret()}`).digest();
}

/**
 * Short-lived signed links are the only way a stored private file is read. The token is sealed, so
 * the object key never reaches the browser.
 */
export async function createSignedLink(objectKey: string): Promise<SignedLink> {
  const expiresAt = Date.now() + config.times.signedReadSeconds * 1000;
  const payload: TokenPayload = { key: objectKey, expiresAt };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await tokenKey(), iv);
  const sealed = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64url');
  return { url: `/api/files/${token}`, expires_at: toUtcIso(new Date(expiresAt)) };
}

export async function readSignedToken(token: string): Promise<string> {
  const raw = Buffer.from(token, 'base64url');
  if (raw.byteLength <= 28) throw notFound();
  let payload: TokenPayload;
  try {
    const decipher = createDecipheriv('aes-256-gcm', await tokenKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const opened = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    payload = JSON.parse(opened.toString('utf8')) as TokenPayload;
  } catch {
    throw notFound();
  }
  if (typeof payload.key !== 'string' || typeof payload.expiresAt !== 'number') throw notFound();
  if (Date.now() >= payload.expiresAt) throw new ApiError(410, 'link_expired');
  return payload.key;
}
